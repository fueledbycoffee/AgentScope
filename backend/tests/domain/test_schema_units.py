from datetime import UTC, datetime
from decimal import Decimal

import pytest

from agentscope_app.domain.errors import ConversionError
from agentscope_app.domain.schema import TARGET_SCHEMA, TARGET_SCHEMA_VERSION, FieldType
from agentscope_app.domain.units import coerce, convert_duration, parse_timestamp


def test_schema_has_three_entities_with_required_identity_fields() -> None:
    assert TARGET_SCHEMA_VERSION == 1
    assert set(TARGET_SCHEMA) == {"session", "model_call", "tool_call"}
    assert TARGET_SCHEMA["session"].fields["external_id"].required
    assert TARGET_SCHEMA["model_call"].fields["session_external_id"].required
    assert TARGET_SCHEMA["tool_call"].fields["tool_name"].required
    assert TARGET_SCHEMA["tool_call"].fields["wall_latency_ms"].unit == "ms"
    assert TARGET_SCHEMA["model_call"].fields["input_tokens"].unit == "tokens"
    for entity in TARGET_SCHEMA.values():
        assert entity.description
        for name, field in entity.fields.items():
            assert field.name == name and field.description


def test_parse_timestamp_formats() -> None:
    expected = datetime(2026, 5, 11, 6, 40, 30, 637000, tzinfo=UTC)
    assert parse_timestamp("2026-05-11T06:40:30.637Z", "iso8601") == expected
    assert parse_timestamp("2026-05-11T08:40:30.637+02:00", "iso8601") == expected
    assert parse_timestamp("2026-05-11T06:40:30.637", "iso8601") == expected  # naive = UTC
    assert parse_timestamp(1778481630.637, "epoch_s") == expected
    assert parse_timestamp(1778481630637, "epoch_ms") == expected
    for bad, fmt in [
        ("yesterday", "iso8601"),
        ("x", "epoch_s"),
        (True, "epoch_ms"),
        (None, "iso8601"),
        (12, "iso8601"),
        ("2026-05-11T06:40:30Z", "unix"),
    ]:
        with pytest.raises(ConversionError):
            parse_timestamp(bad, fmt)


def test_convert_duration_between_units() -> None:
    assert convert_duration(1.5, "s", "ms") == 1500
    assert convert_duration(1500, "ms", "s") == Decimal("1.5")
    assert convert_duration(2, "min", "ms") == 120000
    assert convert_duration(3, "ms", "ms") == 3
    assert convert_duration(2500, "us", "ms") == Decimal("2.5")
    with pytest.raises(ConversionError):
        convert_duration(1, "furlong", "ms")


@pytest.mark.parametrize(
    ("value", "field_type", "expected"),
    [
        ("abc", FieldType.STRING, "abc"),
        (12, FieldType.STRING, "12"),
        (12, FieldType.INTEGER, 12),
        ("12", FieldType.INTEGER, 12),
        ("-3", FieldType.INTEGER, -3),
        (12.0, FieldType.INTEGER, 12),
        (1.5, FieldType.NUMBER, 1.5),
        (2, FieldType.NUMBER, 2),
        ("1.5", FieldType.NUMBER, 1.5),
        (True, FieldType.BOOLEAN, True),
        ("false", FieldType.BOOLEAN, False),
        ("YES", FieldType.BOOLEAN, True),
        ("0", FieldType.BOOLEAN, False),
    ],
)
def test_coerce_accepts_strict_conversions(
    value: object, field_type: FieldType, expected: object
) -> None:
    assert coerce(value, field_type) == expected


@pytest.mark.parametrize(
    ("value", "field_type"),
    [
        (True, FieldType.INTEGER),
        (12.5, FieldType.INTEGER),
        ("12.5", FieldType.INTEGER),
        ("twelve", FieldType.INTEGER),
        (None, FieldType.INTEGER),
        (True, FieldType.STRING),
        ({"a": 1}, FieldType.STRING),
        ("maybe", FieldType.BOOLEAN),
        (2, FieldType.BOOLEAN),
        ("not-a-date", FieldType.TIMESTAMP),
    ],
)
def test_coerce_rejects_lossy_or_ambiguous_conversions(
    value: object, field_type: FieldType
) -> None:
    fmt = "iso8601" if field_type is FieldType.TIMESTAMP else None
    with pytest.raises(ConversionError):
        coerce(value, field_type, timestamp_format=fmt)


def test_coerce_timestamp_uses_format() -> None:
    assert coerce(
        "2026-05-11T06:40:30Z", FieldType.TIMESTAMP, timestamp_format="iso8601"
    ) == datetime(2026, 5, 11, 6, 40, 30, tzinfo=UTC)
    assert coerce(0, FieldType.TIMESTAMP, timestamp_format="epoch_s") == datetime(
        1970, 1, 1, tzinfo=UTC
    )


@pytest.mark.parametrize("value", ["--1", "+1", "1_000", "9" * 20, " - 1"])
def test_coerce_integer_rejects_malformed_strings(value: str) -> None:
    with pytest.raises(ConversionError):
        coerce(value, FieldType.INTEGER)


def test_convert_duration_is_exact() -> None:
    assert convert_duration(1.001, "s", "ms") == 1001
    assert convert_duration(0.1, "s", "ms") == 100
    assert convert_duration(9007199254740993, "ms", "ms") == 9007199254740993
    assert convert_duration(1, "ns", "ms") == Decimal("0.000001")
    with pytest.raises(ConversionError):
        convert_duration(True, "ms", "ms")


def test_convert_duration_parses_numeric_strings_exactly() -> None:
    assert convert_duration("1.001", "s", "ms") == 1001
    assert convert_duration("1.0000000000000001", "s", "ms") == Decimal("1000.0000000000001")
    assert convert_duration("1.00000000000000001", "s", "ms") == Decimal("1000.00000000000001")
    assert convert_duration("1e-400", "s", "ms") == Decimal("1e-397")
    for bad in ("1e-9999999", "1e9999999", "inf", "nan", "", "abc", float("inf"), None):
        with pytest.raises(ConversionError):
            convert_duration(bad, "s", "ms")
    assert convert_duration("1e18", "ms", "ms") == 10**18
    for huge in ("1e19", "1e309", "1e999999", "-1e999999"):
        with pytest.raises(ConversionError, match="range"):
            convert_duration(huge, "ms", "ms")


def test_coerce_handles_exact_decimals() -> None:
    assert coerce(Decimal("1500"), FieldType.INTEGER) == 1500
    assert coerce(Decimal("2.5"), FieldType.NUMBER) == 2.5
    with pytest.raises(ConversionError):
        coerce(Decimal("1000.00000000000001"), FieldType.INTEGER)


def test_integer_coercion_is_bounded_before_expansion() -> None:
    for huge in (Decimal("1e10000000"), Decimal("1e50000"), Decimal("1e19"), 10**19):
        with pytest.raises(ConversionError, match="range|64-bit"):
            coerce(huge, FieldType.INTEGER)
    assert coerce("9" * 18, FieldType.INTEGER) == int("9" * 18)
    assert coerce(Decimal("1e18"), FieldType.INTEGER) == 10**18
    assert coerce(10**18, FieldType.INTEGER) == 10**18
    with pytest.raises(ConversionError):
        coerce(Decimal("1e10000000"), FieldType.NUMBER)


def test_convert_duration_accepts_exact_decimals() -> None:
    assert convert_duration(Decimal("1.5"), "s", "ms") == 1500
    assert convert_duration(Decimal("1.0"), "s", "ms") == 1000


def test_integers_must_fit_signed_64_bits() -> None:
    assert coerce(2**63 - 1, FieldType.INTEGER) == 2**63 - 1
    assert coerce(-(2**63), FieldType.INTEGER) == -(2**63)
    for out in (2**63, -(2**63) - 1, Decimal(2**63), str(2**63), float(2**63)):
        with pytest.raises(ConversionError, match="64-bit"):
            coerce(out, FieldType.INTEGER)
    with pytest.raises(ConversionError, match="64-bit"):
        convert_duration(2**63, "ms", "ms")


def test_scientific_zero_is_zero_not_out_of_range() -> None:
    assert coerce(Decimal("0e19"), FieldType.INTEGER) == 0
    assert coerce(Decimal("0e99999"), FieldType.INTEGER) == 0
    assert coerce(Decimal("0e19"), FieldType.NUMBER) == 0.0


def test_duration_bound_check_is_context_independent() -> None:
    from decimal import Inexact, localcontext

    with localcontext() as ctx:
        ctx.traps[Inexact] = True
        assert convert_duration("1.00000000000000000000000000001", "ms", "ms") == Decimal(
            "1.00000000000000000000000000001"
        )
        assert convert_duration("2.5", "ms", "ms") == Decimal("2.5")
        with pytest.raises(ConversionError):
            convert_duration("1e19", "ms", "ms")
