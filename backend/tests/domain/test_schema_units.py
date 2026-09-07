from datetime import UTC, datetime

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
    assert convert_duration(1500, "ms", "s") == 1.5
    assert convert_duration(2, "min", "ms") == 120000
    assert convert_duration(3, "ms", "ms") == 3
    assert convert_duration(2500, "us", "ms") == 2.5
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


@pytest.mark.parametrize("value", ["--1", "+1", "1_000", "9" * 19, " - 1"])
def test_coerce_integer_rejects_malformed_strings(value: str) -> None:
    with pytest.raises(ConversionError):
        coerce(value, FieldType.INTEGER)


def test_convert_duration_is_exact() -> None:
    assert convert_duration(1.001, "s", "ms") == 1001
    assert convert_duration(0.1, "s", "ms") == 100
    assert convert_duration(9007199254740993, "ms", "ms") == 9007199254740993
    assert convert_duration(1, "ns", "ms") == 0.000001
    with pytest.raises(ConversionError):
        convert_duration(True, "ms", "ms")


def test_convert_duration_parses_numeric_strings_exactly() -> None:
    assert convert_duration("1.001", "s", "ms") == 1001
    assert convert_duration("1.0000000000000001", "s", "ms") == 1000.0000000000001
    for bad in ("1e-400", "inf", "nan", "1e309x", "", "abc", float("inf"), float("nan"), None):
        with pytest.raises(ConversionError):
            convert_duration(bad, "s", "ms")
    assert convert_duration("1e309", "ms", "ms") == 10**309
