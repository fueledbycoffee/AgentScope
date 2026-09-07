import pytest

from agentscope_app.domain.errors import ConversionError
from agentscope_app.domain.mapping.transforms import TRANSFORM_NAMES, Transform, apply_transform


def test_string_transforms() -> None:
    assert apply_transform(Transform("trim", {}), "  a b ") == "a b"
    assert apply_transform(Transform("lower", {}), "MiXed") == "mixed"
    assert apply_transform(Transform("upper", {}), "MiXed") == "MIXED"
    with pytest.raises(ConversionError):
        apply_transform(Transform("trim", {}), 12)


def test_enum_map_policies() -> None:
    t = Transform("enum_map", {"mapping": {"claude": "claude-code"}, "unmapped": "reject"})
    assert apply_transform(t, "claude") == "claude-code"
    with pytest.raises(ConversionError, match="unmapped"):
        apply_transform(t, "gemini")
    keep = Transform("enum_map", {"mapping": {"1": "one"}, "unmapped": "keep"})
    assert apply_transform(keep, 1) == "one"
    assert apply_transform(keep, 2) == 2
    null = Transform("enum_map", {"mapping": {}, "unmapped": "null"})
    assert apply_transform(null, "x") is None
    default_policy = Transform("enum_map", {"mapping": {}})
    with pytest.raises(ConversionError):
        apply_transform(default_policy, "x")


def test_json_decode_is_bounded() -> None:
    t = Transform("json_decode", {})
    assert apply_transform(t, '{"a": [1, 2]}') == {"a": [1, 2]}
    with pytest.raises(ConversionError):
        apply_transform(t, "{not json")
    with pytest.raises(ConversionError, match="65536"):
        apply_transform(t, "[" + "1," * 40000 + "1]")
    with pytest.raises(ConversionError):
        apply_transform(t, {"already": "decoded"})


def test_unknown_transform_is_refused() -> None:
    assert "eval" not in TRANSFORM_NAMES
    with pytest.raises(ConversionError):
        apply_transform(Transform("eval", {}), "1+1")


def test_json_decode_too_deep_is_a_conversion_error() -> None:
    with pytest.raises(ConversionError, match="deep"):
        apply_transform(Transform("json_decode", {}), "[" * 20000 + "0" + "]" * 20000)
