"""Parquet record reader with ``row:N`` locators and schema-aware, exact conversion.

Every row becomes one ``RawRecord`` whose payload is a JSON-typed dict keyed by
column name. Values are converted from the Arrow *schema*, never through
``Scalar.as_py()`` alone, so nanosecond timestamps, unsigned 64-bit integers,
wide decimals, duplicate map keys and non-finite floats all survive intact.
Values that JSON cannot express directly are wrapped in small objects with an
``_arrow`` discriminator whose keys are plain identifiers, so DSL v1 paths can
reach them (``$.latency.value``); see ``docs/mapping/README.md``.

Budgets are checked from the footer before any row is decoded; oversize rows
become records with an ``error`` rather than exceptions.
"""

from __future__ import annotations

import base64
import math
import uuid
from collections.abc import Iterator, Sequence
from decimal import Decimal
from typing import Any, BinaryIO, Final

import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq

from agentscope_app.application.dto import MAX_DECODED_BYTES, MAX_RECORDS_PER_FILE, RawRecord
from agentscope_app.application.errors import InvalidInputError, LimitExceededError
from agentscope_app.domain.jsonx import dumps_exact

PARQUET_MAGIC: Final = b"PAR1"
WRAPPER_KEY: Final = "_arrow"
DEFAULT_BATCH_ROWS: Final = 1_000
DEFAULT_MAX_RECORD_BYTES: Final = 4 * 1024 * 1024  # same ceiling as a JSONL line
MAX_COLUMNS: Final = 64
MAX_DEPTH: Final = 8
SUPPORTED_EXTENSIONS: Final = frozenset({"arrow.uuid", "arrow.json"})
_UNIT_DIGITS: Final = {"s": 0, "ms": 3, "us": 6, "ns": 9}


class ParquetRecordReader:
    def __init__(
        self,
        *,
        batch_rows: int = DEFAULT_BATCH_ROWS,
        max_record_bytes: int = DEFAULT_MAX_RECORD_BYTES,
        max_records: int = MAX_RECORDS_PER_FILE,
        max_decoded_bytes: int = MAX_DECODED_BYTES,
    ) -> None:
        self._batch_rows = batch_rows
        self._max_record_bytes = max_record_bytes
        self._max_records = max_records
        self._max_decoded_bytes = max_decoded_bytes

    def sniff(self, filename: str, head: bytes) -> str:
        if head.startswith(PARQUET_MAGIC) or filename.lower().endswith(".parquet"):
            return "parquet"
        raise InvalidInputError(f"{filename!r} is not a Parquet file")

    def read(self, stream: BinaryIO, fmt: str) -> Iterator[RawRecord]:
        if fmt != "parquet":
            raise InvalidInputError(f"This reader only handles parquet, not {fmt!r}")
        try:
            parquet = pq.ParquetFile(stream)
        except (pa.ArrowException, ValueError, OSError) as exc:
            raise InvalidInputError(f"Not a readable Parquet file: {exc}") from exc
        metadata = parquet.metadata
        if metadata.num_rows > self._max_records:
            raise LimitExceededError(
                f"File has {metadata.num_rows} records; the limit is {self._max_records}"
            )
        decoded = sum(metadata.row_group(i).total_byte_size for i in range(metadata.num_row_groups))
        if decoded > self._max_decoded_bytes:
            raise LimitExceededError(
                f"File decodes to about {decoded} bytes; the limit is {self._max_decoded_bytes}"
            )
        validate_schema(parquet.schema_arrow)
        index = 0
        decoded_so_far = 0
        try:
            batches = parquet.iter_batches(batch_size=self._batch_rows)
            for batch in batches:
                # Dictionary encoding hides repetition from the footer sizes and from
                # the encoded buffers. The logical size is computed from the dictionary
                # and its indices *before* anything is expanded, so an oversize batch
                # is refused without the allocation it would have needed.
                decoded_so_far += sum(
                    _logical_nbytes(batch.column(i)) for i in range(batch.num_columns)
                )
                if decoded_so_far > self._max_decoded_bytes:
                    raise LimitExceededError(
                        f"File decodes to more than {self._max_decoded_bytes} bytes "
                        f"(exceeded at row {index})"
                    )
                columns = [_convert_array(batch.column(i)) for i in range(batch.num_columns)]
                names = batch.schema.names
                for row_index in range(batch.num_rows):
                    locator = f"row:{index}"
                    index += 1
                    payload = {
                        name: column[row_index] for name, column in zip(names, columns, strict=True)
                    }
                    size = len(dumps_exact(payload).encode("utf-8"))
                    if size > self._max_record_bytes:
                        yield RawRecord(
                            locator,
                            None,
                            f"row {index - 1} decodes to {size} bytes; "
                            f"the limit is {self._max_record_bytes}",
                        )
                        continue
                    yield RawRecord(locator, payload)
        except (pa.ArrowException, OSError) as exc:
            raise InvalidInputError(f"Parquet read failed at row {index}: {exc}") from exc


def validate_schema(schema: pa.Schema) -> None:
    """Refuse schemas the converter cannot represent faithfully.

    Duplicate names at any level would collapse into one dict key; a struct
    field literally named ``_arrow`` would be indistinguishable from a wrapper;
    unknown extension types have no defined conversion; and the width and
    depth limits are documented product limits like the JSONL line limit.
    """
    if len(schema.names) > MAX_COLUMNS:
        raise InvalidInputError(f"File has {len(schema.names)} columns; the limit is {MAX_COLUMNS}")
    _check_names(schema.names, "top level")
    for field in schema:
        _check_field(field, field.name, 1)


def _check_field(field: pa.Field, path: str, depth: int) -> None:
    # A producer's extension type that is not registered here arrives as its storage
    # type plus this metadata; the logical meaning would be silently lost.
    name = (field.metadata or {}).get(b"ARROW:extension:name")
    if name is not None and name.decode() not in SUPPORTED_EXTENSIONS:
        raise InvalidInputError(f"Column {path!r} has unsupported extension type {name.decode()!r}")
    _check_type(field.type, path, depth)


def _check_names(names: Sequence[str], where: str) -> None:
    seen: set[str] = set()
    for name in names:
        if name in seen:
            raise InvalidInputError(f"Duplicate column name {name!r} at {where}")
        seen.add(name)
        if name == WRAPPER_KEY:
            raise InvalidInputError(
                f"Column {name!r} at {where} collides with the reader's wrapper key"
            )


def _check_type(typ: pa.DataType, path: str, depth: int) -> None:
    if depth > MAX_DEPTH:
        raise InvalidInputError(f"Column {path!r} is nested deeper than {MAX_DEPTH} levels")
    if isinstance(typ, pa.BaseExtensionType):
        if typ.extension_name not in SUPPORTED_EXTENSIONS:
            raise InvalidInputError(
                f"Column {path!r} has unsupported extension type {typ.extension_name!r}"
            )
        return
    if pa.types.is_dictionary(typ):
        _check_type(typ.value_type, path, depth)
    elif pa.types.is_struct(typ):
        _check_names([typ.field(i).name for i in range(typ.num_fields)], path)
        for i in range(typ.num_fields):
            child = typ.field(i)
            _check_field(child, f"{path}.{child.name}", depth + 1)
    elif pa.types.is_map(typ):
        _check_type(typ.key_type, f"{path}[key]", depth + 1)
        _check_type(typ.item_type, f"{path}[value]", depth + 1)
    elif _is_list(typ):
        _check_type(typ.value_type, f"{path}[]", depth + 1)
    elif not _is_scalar(typ):
        raise InvalidInputError(f"Column {path!r} has unsupported type {typ}")


def _is_list(typ: pa.DataType) -> bool:
    return bool(
        pa.types.is_list(typ)
        or pa.types.is_large_list(typ)
        or pa.types.is_fixed_size_list(typ)
        or pa.types.is_list_view(typ)
        or pa.types.is_large_list_view(typ)
    )


def _is_scalar(typ: pa.DataType) -> bool:
    checks = (
        pa.types.is_null,
        pa.types.is_boolean,
        pa.types.is_integer,
        pa.types.is_floating,
        pa.types.is_decimal,
        pa.types.is_string,
        pa.types.is_large_string,
        pa.types.is_string_view,
        pa.types.is_binary,
        pa.types.is_large_binary,
        pa.types.is_binary_view,
        pa.types.is_fixed_size_binary,
        pa.types.is_timestamp,
        pa.types.is_date,
        pa.types.is_time,
        pa.types.is_duration,
    )
    return any(check(typ) for check in checks)


# ---------------------------------------------------------------- conversion


def _convert_array(array: pa.Array) -> list[Any]:
    """Convert a whole array to JSON-typed Python values, ``None`` for nulls."""
    typ = array.type
    if isinstance(typ, pa.BaseExtensionType):
        return _convert_extension(array)
    if pa.types.is_dictionary(typ):
        return _convert_array(array.dictionary_decode())
    if pa.types.is_null(typ):
        return [None] * len(array)
    if pa.types.is_boolean(typ) or pa.types.is_integer(typ) or pa.types.is_decimal(typ):
        return list(array.to_pylist())
    if pa.types.is_string(typ) or pa.types.is_large_string(typ) or pa.types.is_string_view(typ):
        return list(array.to_pylist())
    if pa.types.is_floating(typ):
        values = array.cast(pa.float64()).to_pylist() if typ != pa.float64() else array.to_pylist()
        return [_convert_float(v) for v in values]
    if pa.types.is_binary(typ) or pa.types.is_large_binary(typ) or pa.types.is_binary_view(typ):
        return [_wrap_bytes(v) for v in array.to_pylist()]
    if pa.types.is_fixed_size_binary(typ):
        return [_wrap_bytes(v) for v in array.to_pylist()]
    if pa.types.is_timestamp(typ):
        raw = array.cast(pa.int64()).to_pylist()
        return [_wrap_timestamp(v, typ.unit, typ.tz) for v in raw]
    if pa.types.is_date(typ):
        days = array.cast(pa.date32()).cast(pa.int32()).to_pylist()
        return [None if v is None else _civil_date(v) for v in days]
    if pa.types.is_time(typ):
        storage = pa.int32() if typ.bit_width == 32 else pa.int64()
        raw = array.cast(storage).to_pylist()
        return [_wrap_seconds("time", v, typ.unit) for v in raw]
    if pa.types.is_duration(typ):
        raw = array.cast(pa.int64()).to_pylist()
        return [_wrap_seconds("duration", v, typ.unit) for v in raw]
    if pa.types.is_map(typ):
        return _convert_map(array)
    if pa.types.is_struct(typ):
        return _convert_struct(array)
    if _is_list(typ):
        return _convert_list(array)
    raise InvalidInputError(f"Unsupported Arrow type {typ}")


def _convert_float(value: float | None) -> Any:
    if value is None:
        return None
    if math.isnan(value):
        return {WRAPPER_KEY: "float", "value": "NaN"}
    if math.isinf(value):
        return {WRAPPER_KEY: "float", "value": "Infinity" if value > 0 else "-Infinity"}
    return Decimal(repr(value))


def _wrap_bytes(value: bytes | None) -> Any:
    # A null keeps the wrapper shape so ``$.col.base64`` reads as null, not absent.
    encoded = None if value is None else base64.b64encode(value).decode("ascii")
    return {WRAPPER_KEY: "binary", "base64": encoded}


def _wrap_seconds(kind: str, value: int | None, unit: str) -> Any:
    """Durations and times of day as exact decimal seconds plus the file's unit.

    A mapping converts with a static ``unit: {from: "s", ...}`` whatever unit the
    file used, so a unit mismatch cannot silently scale a value; the ``_arrow``
    kind keeps elapsed time distinguishable from time of day.
    """
    seconds = None if value is None else Decimal(value).scaleb(-_UNIT_DIGITS[unit])
    return {WRAPPER_KEY: kind, "seconds": seconds, "unit": unit}


def _wrap_timestamp(value: int | None, unit: str, tz: str | None) -> Any:
    if value is None:
        return {WRAPPER_KEY: "timestamp", "iso": None, "unit": unit, "tz": tz, "value": None}
    digits = _UNIT_DIGITS[unit]
    seconds, fraction = divmod(value, 10**digits)
    days, secs = divmod(seconds, 86_400)
    hh, rem = divmod(secs, 3_600)
    mm, ss = divmod(rem, 60)
    iso = f"{_civil_date(days)}T{hh:02d}:{mm:02d}:{ss:02d}"
    if digits:
        iso += "." + str(fraction).rjust(digits, "0")
    if tz is not None:
        # Arrow stores tz-aware instants as UTC; the tz name is display metadata.
        iso += "Z"
    return {WRAPPER_KEY: "timestamp", "iso": iso, "unit": unit, "tz": tz, "value": value}


def _civil_date(days: int) -> str:
    """Proleptic Gregorian date for a day count from 1970-01-01, any range.

    Python's ``date`` stops at year 9999; Arrow does not. Years outside 0001 to
    9999 render with their full digits (and a sign), which ISO 8601 parsers
    refuse, so a mapping sees an invalid timestamp rather than a wrong one.
    """
    z = days + 719_468
    era = z // 146_097  # floor division: no separate negative branch needed
    doe = z - era * 146_097
    yoe = (doe - doe // 1_460 + doe // 36_524 - doe // 146_096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = mp + 3 if mp < 10 else mp - 9
    if m <= 2:
        y += 1
    year = f"{y:04d}" if y >= 0 else f"-{-y:04d}"
    return f"{year}-{m:02d}-{d:02d}"


def _logical_nbytes(array: pa.Array) -> int:
    """Bytes the array occupies once every dictionary in it is expanded.

    Computed from the dictionary and the indices, never by expanding: for a
    dictionary array it is the sum of the referenced values' sizes plus the
    dense offsets; nested children are visited the same way.
    """
    typ = array.type
    if pa.types.is_dictionary(typ):
        values = array.dictionary
        per_value = _value_sizes(values)
        indices = array.indices
        if per_value is None:  # fixed-width values: width times the number of rows
            return int(values.type.bit_width) // 8 * len(array) + len(array) // 8 + 1
        referenced = pc.take(per_value, indices.fill_null(0))
        total = pc.sum(referenced).as_py() or 0
        return int(total) + 8 * (len(array) + 1)
    if pa.types.is_struct(typ):
        return sum(_logical_nbytes(array.field(i)) for i in range(typ.num_fields)) + len(array) // 8
    if pa.types.is_map(typ):
        return _logical_nbytes(array.keys) + _logical_nbytes(array.items) + 4 * (len(array) + 1)
    if _is_list(typ):
        return _logical_nbytes(array.values) + 8 * (len(array) + 1)
    return int(array.nbytes)


def _value_sizes(values: pa.Array) -> pa.Array | None:
    typ = values.type
    if pa.types.is_string(typ) or pa.types.is_large_string(typ) or pa.types.is_string_view(typ):
        return pc.binary_length(values.cast(pa.large_binary())).cast(pa.int64())
    if pa.types.is_binary(typ) or pa.types.is_large_binary(typ) or pa.types.is_binary_view(typ):
        return pc.binary_length(values.cast(pa.large_binary())).cast(pa.int64())
    if _is_list(typ) or pa.types.is_struct(typ) or pa.types.is_map(typ):
        # nested dictionary values: expand only the (small) dictionary itself
        return pa.array(
            [_logical_nbytes(values.slice(i, 1)) for i in range(len(values))], pa.int64()
        )
    return None


def _dense_schema(schema: pa.Schema) -> pa.Schema:
    return pa.schema([pa.field(f.name, _dense_type(f.type), f.nullable) for f in schema])


def _dense_type(typ: pa.DataType) -> pa.DataType:
    if pa.types.is_dictionary(typ):
        return _dense_type(typ.value_type)
    if pa.types.is_struct(typ):
        return pa.struct(
            [
                pa.field(typ.field(i).name, _dense_type(typ.field(i).type), typ.field(i).nullable)
                for i in range(typ.num_fields)
            ]
        )
    if pa.types.is_map(typ):
        return pa.map_(_dense_type(typ.key_type), _dense_type(typ.item_type))
    if pa.types.is_large_list(typ):
        return pa.large_list(_dense_type(typ.value_type))
    if pa.types.is_fixed_size_list(typ):
        return pa.list_(_dense_type(typ.value_type), typ.list_size)
    if _is_list(typ):
        return pa.list_(_dense_type(typ.value_type))
    return typ


def _convert_extension(array: pa.Array) -> list[Any]:
    typ = array.type
    storage = _convert_array(array.storage)
    if typ.extension_name == "arrow.uuid":
        return [
            None if v["base64"] is None else str(uuid.UUID(bytes=base64.b64decode(v["base64"])))
            for v in storage
        ]
    # arrow.json: the storage is already the JSON text.
    return storage


def _convert_list(array: pa.Array) -> list[Any]:
    typ = array.type
    if pa.types.is_fixed_size_list(typ):
        size = typ.list_size
        values = _convert_array(array.values)
        nulls = array.is_null().to_pylist()
        return [None if nulls[i] else values[i * size : (i + 1) * size] for i in range(len(array))]
    if pa.types.is_list_view(typ) or pa.types.is_large_list_view(typ):
        array = array.cast(pa.list_(typ.value_type))
    values = _convert_array(array.values)
    offsets = array.offsets.to_pylist()
    nulls = array.is_null().to_pylist()
    return [None if nulls[i] else values[offsets[i] : offsets[i + 1]] for i in range(len(array))]


def _convert_struct(array: pa.Array) -> list[Any]:
    typ = array.type
    names = [typ.field(i).name for i in range(typ.num_fields)]
    children = [_convert_array(array.field(i)) for i in range(typ.num_fields)]
    nulls = array.is_null().to_pylist()
    return [
        None if nulls[i] else {name: child[i] for name, child in zip(names, children, strict=True)}
        for i in range(len(array))
    ]


def _convert_map(array: pa.Array) -> list[Any]:
    keys = _convert_array(array.keys)
    items = _convert_array(array.items)
    offsets = array.offsets.to_pylist()
    nulls = array.is_null().to_pylist()
    return [
        None
        if nulls[i]
        else [{"key": keys[j], "value": items[j]} for j in range(offsets[i], offsets[i + 1])]
        for i in range(len(array))
    ]


__all__ = ["ParquetRecordReader", "validate_schema"]
