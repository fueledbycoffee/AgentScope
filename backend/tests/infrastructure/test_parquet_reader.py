import io
import uuid
from decimal import Decimal
from typing import Any

import pyarrow as pa
import pyarrow.parquet as pq
import pytest

from agentscope_app.application.errors import InvalidInputError, LimitExceededError
from agentscope_app.infrastructure.jsonx import dumps_exact, loads_exact
from agentscope_app.infrastructure.readers.parquet import ParquetRecordReader
from agentscope_app.infrastructure.readers.router import FormatRouter


def parquet_bytes(table: pa.Table, **kwargs: Any) -> bytes:
    buf = io.BytesIO()
    pq.write_table(table, buf, **kwargs)
    return buf.getvalue()


def read_all(data: bytes, **kwargs: Any) -> list[Any]:
    return list(ParquetRecordReader(**kwargs).read(io.BytesIO(data), "parquet"))


def test_every_supported_type_converts_exactly() -> None:
    table = pa.table(
        {
            "i64": pa.array([-(2**63), 2**63 - 1], pa.int64()),
            "u64": pa.array([2**64 - 1, 0], pa.uint64()),
            "f64": pa.array([0.1, float("nan")], pa.float64()),
            "f32": pa.array([0.5, float("inf")], pa.float32()),
            "f16": pa.array([1.5, -2.0], pa.float16()),
            "d128": pa.array([Decimal("12345.678901"), None], pa.decimal128(20, 6)),
            "d256": pa.array([Decimal("1." + "9" * 40), Decimal("0")], pa.decimal256(76, 40)),
            "b": pa.array([True, None], pa.bool_()),
            "s": pa.array(["x", None], pa.string()),
            "ls": pa.array(["large", "strings"], pa.large_string()),
            "bin": pa.array([b"\x00\xff", None], pa.binary()),
            "fbin": pa.array([b"ab", b"cd"], pa.binary(2)),
            "ts_ns": pa.array([1_700_000_000_123_456_789, None], pa.timestamp("ns", tz="UTC")),
            "ts_naive": pa.array([1_700_000_000_123_456, -1], pa.timestamp("us")),
            "ts_s_tz": pa.array([0, 86_400], pa.timestamp("s", tz="Europe/Paris")),
            "date": pa.array([19_000, None], pa.date32()),
            "t64": pa.array([12_345_678, None], pa.time64("us")),
            "dur": pa.array([1_500, None], pa.duration("ms")),
            "lst": pa.array([[1, None], None], pa.list_(pa.int64())),
            "empty": pa.array([[], [None]], pa.list_(pa.int64())),
            "fsl": pa.array([[1, 2], [3, None]], pa.list_(pa.int64(), 2)),
            "st": pa.array([{"x": None}, None], pa.struct([("x", pa.int64())])),
            "m": pa.array([[("a", 1), ("a", 2)], []], pa.map_(pa.string(), pa.int64())),
            "dict": pa.array(["k", "k"]).dictionary_encode(),
            "nul": pa.array([None, None], pa.null()),
        }
    )
    rows = read_all(parquet_bytes(table))
    assert [r.locator for r in rows] == ["row:0", "row:1"] and all(r.error is None for r in rows)
    a, b = rows[0].payload, rows[1].payload
    assert a["i64"] == -(2**63) and b["i64"] == 2**63 - 1
    assert a["u64"] == 2**64 - 1 and isinstance(a["u64"], int)
    assert a["f64"] == Decimal("0.1") and b["f64"] == {"_arrow": "float", "value": "NaN"}
    assert a["f32"] == Decimal("0.5") and b["f32"] == {"_arrow": "float", "value": "Infinity"}
    assert a["f16"] == Decimal("1.5") and b["f16"] == Decimal("-2.0")
    assert a["d128"] == Decimal("12345.678901") and b["d128"] is None
    assert a["d256"] == Decimal("1." + "9" * 40)
    assert a["b"] is True and b["b"] is None
    assert a["s"] == "x" and b["s"] is None and a["ls"] == "large"
    assert a["bin"] == {"_arrow": "binary", "base64": "AP8="}
    assert b["bin"] == {"_arrow": "binary", "base64": None}  # null keeps the wrapper shape
    assert a["fbin"] == {"_arrow": "binary", "base64": "YWI="}
    assert a["ts_ns"] == {
        "_arrow": "timestamp",
        "iso": "2023-11-14T22:13:20.123456789Z",
        "unit": "ns",
        "tz": "UTC",
        "value": 1_700_000_000_123_456_789,
    }
    assert b["ts_ns"] == {
        "_arrow": "timestamp",
        "iso": None,
        "unit": "ns",
        "tz": "UTC",
        "value": None,
    }
    assert a["ts_naive"]["iso"] == "2023-11-14T22:13:20.123456" and a["ts_naive"]["tz"] is None
    assert b["ts_naive"]["iso"] == "1969-12-31T23:59:59.999999"  # negative epoch, no offset
    # Parquet has no seconds unit: the file stores milliseconds and the reader reports the file.
    assert a["ts_s_tz"] == {
        "_arrow": "timestamp",
        "iso": "1970-01-01T00:00:00.000Z",
        "unit": "ms",
        "tz": "Europe/Paris",
        "value": 0,
    }
    assert a["date"] == "2022-01-08" and b["date"] is None
    assert a["t64"] == {"_arrow": "time", "seconds": Decimal("12.345678"), "unit": "us"}
    assert b["t64"] == {"_arrow": "time", "seconds": None, "unit": "us"}
    assert a["dur"] == {"_arrow": "duration", "seconds": Decimal("1.500"), "unit": "ms"}
    assert b["dur"] == {"_arrow": "duration", "seconds": None, "unit": "ms"}
    assert a["lst"] == [1, None] and b["lst"] is None
    assert a["empty"] == [] and b["empty"] == [None]
    assert a["fsl"] == [1, 2] and b["fsl"] == [3, None]
    assert a["st"] == {"x": None} and b["st"] is None  # null struct is None, not a dict of nulls
    assert a["m"] == [{"key": "a", "value": 1}, {"key": "a", "value": 2}] and b["m"] == []
    assert a["dict"] == "k"
    assert a["nul"] is None
    for r in rows:
        assert loads_exact(dumps_exact(r.payload)) == loads_exact(dumps_exact(r.payload))


def test_extension_types_uuid_and_json_convert_and_others_are_refused() -> None:
    u = uuid.uuid4()
    table = pa.table(
        {
            "id": pa.array([u.bytes], pa.binary(16)).cast(pa.uuid()),
            "doc": pa.array(['{"a": 1}']).cast(pa.json_(pa.string())),
        }
    )
    rows = read_all(parquet_bytes(table))
    assert rows[0].payload == {"id": str(u), "doc": '{"a": 1}'}

    class Odd(pa.ExtensionType):
        def __init__(self) -> None:
            super().__init__(pa.int64(), "test.odd")

        def __arrow_ext_serialize__(self) -> bytes:
            return b""

        @classmethod
        def __arrow_ext_deserialize__(cls, storage_type: Any, serialized: bytes) -> "Odd":
            return cls()

    pa.register_extension_type(Odd())
    try:
        odd = pa.table({"o": pa.ExtensionArray.from_storage(Odd(), pa.array([1], pa.int64()))})
        with pytest.raises(InvalidInputError, match="unsupported extension"):
            read_all(parquet_bytes(odd))
    finally:
        pa.unregister_extension_type("test.odd")


def test_schema_validation_refuses_ambiguous_shapes() -> None:
    dup = pa.Table.from_arrays([pa.array([1]), pa.array([2])], names=["a", "a"])
    with pytest.raises(InvalidInputError, match="Duplicate column name 'a'"):
        read_all(parquet_bytes(dup))
    nested_dup = pa.table(
        {"s": pa.StructArray.from_arrays([pa.array([1]), pa.array([2])], names=["x", "x"])}
    )
    with pytest.raises(InvalidInputError, match="Duplicate column name 'x' at s"):
        read_all(parquet_bytes(nested_dup))
    wrapper = pa.table({"s": pa.array([{"_arrow": "x"}], pa.struct([("_arrow", pa.string())]))})
    with pytest.raises(InvalidInputError, match="wrapper key"):
        read_all(parquet_bytes(wrapper))
    wide = pa.table({f"c{i}": pa.array([1]) for i in range(65)})
    with pytest.raises(InvalidInputError, match="65 columns"):
        read_all(parquet_bytes(wide))
    typ: pa.DataType = pa.int64()
    for _ in range(9):
        typ = pa.list_(typ)
    deep = pa.table({"d": pa.array([None], typ)})
    with pytest.raises(InvalidInputError, match="deeper than 8"):
        read_all(parquet_bytes(deep))


def test_locators_are_absolute_across_row_groups_and_batch_sizes() -> None:
    table = pa.table({"n": pa.array(range(2_503)), "s": pa.array([str(i) for i in range(2_503)])})
    data = parquet_bytes(table, row_group_size=700)  # uneven groups crossing the 1,000 boundary
    assert pq.ParquetFile(io.BytesIO(data)).metadata.num_row_groups == 4
    small = read_all(data, batch_rows=333)
    large = read_all(data, batch_rows=1_000)
    assert [r.locator for r in small] == [f"row:{i}" for i in range(2_503)]
    assert [(r.locator, r.payload) for r in small] == [(r.locator, r.payload) for r in large]
    assert small[2_502].payload == {"n": 2_502, "s": "2502"}


def test_zero_rows_corrupt_footer_and_budgets() -> None:
    assert read_all(parquet_bytes(pa.table({"a": pa.array([], pa.int64())}))) == []
    with pytest.raises(InvalidInputError, match="Not a readable Parquet"):
        read_all(b"PAR1 this is not parquet PAR1")
    with pytest.raises(InvalidInputError):
        read_all(parquet_bytes(pa.table({"a": pa.array([1])}))[:-10])
    data = parquet_bytes(pa.table({"a": pa.array(range(10))}))
    with pytest.raises(LimitExceededError, match="10 records"):
        read_all(data, max_records=9)
    with pytest.raises(LimitExceededError, match="decodes to about"):
        read_all(data, max_decoded_bytes=10)
    # Dictionary encoding stores a repeated value once: the footer size stays tiny while
    # the decoded batches do not, so the budget is enforced on the decoded buffers too.
    wide = pa.table({"s": pa.array(["x" * 32_768] * 10_000)})
    encoded = parquet_bytes(wide, use_dictionary=True, compression="zstd")
    assert len(encoded) < 10_000
    footer = pq.ParquetFile(io.BytesIO(encoded)).metadata
    assert (
        sum(footer.row_group(i).total_byte_size for i in range(footer.num_row_groups)) < 1_000_000
    )
    with pytest.raises(LimitExceededError, match="decodes to more than"):
        read_all(encoded, max_decoded_bytes=1_000_000)
    # pyarrow itself cannot restore a fixed-size list with null rows from Parquet
    fsl_nulls = pa.table({"f": pa.array([[1, 2], None], pa.list_(pa.int64(), 2))})
    with pytest.raises(InvalidInputError, match="Parquet read failed"):
        read_all(parquet_bytes(fsl_nulls))
    # a single oversize row becomes a record error, later rows keep their locators
    rows = read_all(
        parquet_bytes(pa.table({"s": pa.array(["ok", "y" * 5_000, "ok"])})), max_record_bytes=1_000
    )
    assert [r.locator for r in rows] == ["row:0", "row:1", "row:2"]
    assert rows[1].payload is None and "decodes to" in (rows[1].error or "")
    assert rows[2].payload == {"s": "ok"}


def test_router_sniffs_by_magic_before_extension() -> None:
    router = FormatRouter()
    data = parquet_bytes(pa.table({"a": pa.array([1])}))
    assert router.sniff("traces.jsonl", data[:8]) == "parquet"
    assert router.sniff("traces.parquet", b"{}") == "parquet"
    assert router.sniff("traces.jsonl", b'{"a": 1}') == "jsonl"
    assert [r.payload for r in router.read(io.BytesIO(data), "parquet")] == [{"a": 1}]
    assert [r.payload for r in router.read(io.BytesIO(b'{"a": 1}\n'), "jsonl")] == [{"a": 1}]
    with pytest.raises(InvalidInputError, match="Not a readable Parquet"):
        list(router.read(io.BytesIO(b"{}"), "parquet"))
    with pytest.raises(InvalidInputError):
        list(router.read(io.BytesIO(b""), "csv"))


# ---------------------------------------------------------------- property test
from hypothesis import given, settings  # noqa: E402
from hypothesis import strategies as st  # noqa: E402

_scalars = st.sampled_from(
    [
        pa.int64(),
        pa.uint64(),
        pa.float64(),
        pa.string(),
        pa.bool_(),
        pa.timestamp("ns", tz="UTC"),
        pa.timestamp("ms"),
        pa.duration("us"),
        pa.date32(),
        pa.decimal128(20, 4),
        pa.binary(),
    ]
)


def _types(depth: int = 0) -> st.SearchStrategy[Any]:
    if depth >= 2:
        return _scalars
    return st.one_of(
        _scalars,
        st.builds(pa.list_, _types(depth + 1)),
        st.lists(
            st.tuples(st.from_regex(r"[a-z]{1,4}", fullmatch=True), _types(depth + 1)),
            min_size=1,
            max_size=3,
            unique_by=lambda f: f[0],
        ).map(pa.struct),
        st.builds(pa.map_, st.just(pa.string()), _types(depth + 1)),
    )


def _value(typ: pa.DataType) -> st.SearchStrategy[Any]:
    if pa.types.is_integer(typ):
        return st.none() | st.integers(0, 2**32)
    if pa.types.is_floating(typ):
        return st.none() | st.floats(allow_nan=True, allow_infinity=True, width=64)
    if pa.types.is_string(typ):
        return st.none() | st.text(max_size=12)
    if pa.types.is_boolean(typ):
        return st.none() | st.booleans()
    if pa.types.is_timestamp(typ) or pa.types.is_duration(typ):
        return st.none() | st.integers(-(2**40), 2**40)
    if pa.types.is_date(typ):
        return st.none() | st.integers(-100_000, 100_000)
    if pa.types.is_decimal(typ):
        return st.none() | st.decimals(min_value=-(10**15), max_value=10**15, places=4)
    if pa.types.is_binary(typ):
        return st.none() | st.binary(max_size=8)
    if pa.types.is_list(typ):
        return st.none() | st.lists(_value(typ.value_type), max_size=3)
    if pa.types.is_struct(typ):
        return st.none() | st.fixed_dictionaries(
            {typ.field(i).name: _value(typ.field(i).type) for i in range(typ.num_fields)}
        )
    if pa.types.is_map(typ):
        return st.none() | st.lists(
            st.tuples(st.text(max_size=4), _value(typ.item_type)), max_size=3
        )
    raise AssertionError(typ)


@st.composite
def _tables(draw: Any) -> pa.Table:
    names = draw(
        st.lists(st.from_regex(r"[a-z]{1,5}", fullmatch=True), min_size=1, max_size=4, unique=True)
    )
    columns = {}
    rows = draw(st.integers(0, 6))
    for name in names:
        typ = draw(_types())
        values = draw(st.lists(_value(typ), min_size=rows, max_size=rows))
        columns[name] = pa.array(values, typ)
    return pa.table(columns)


def _json_typed(value: Any) -> bool:
    if value is None or isinstance(value, bool | int | str | Decimal):
        return True
    if isinstance(value, list):
        return all(_json_typed(v) for v in value)
    if isinstance(value, dict):
        return all(isinstance(k, str) and _json_typed(v) for k, v in value.items())
    return False


@settings(max_examples=150, deadline=None)
@given(_tables())
def test_reader_never_raises_on_supported_schemas_and_stays_json_typed(table: pa.Table) -> None:
    rows = read_all(parquet_bytes(table))
    assert [r.locator for r in rows] == [f"row:{i}" for i in range(table.num_rows)]
    for r in rows:
        assert (
            r.error is None and _json_typed(r.payload) and set(r.payload) == set(table.schema.names)
        )
        assert loads_exact(dumps_exact(r.payload)) == loads_exact(dumps_exact(r.payload))
