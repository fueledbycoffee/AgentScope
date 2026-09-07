from agentscope_app.domain.errors import MappingValidationError, Severity, ValidationIssue
from agentscope_app.domain.identity import SourceOccurrence


def test_occurrence_key_is_stable_and_distinct_per_emission_path() -> None:
    a = SourceOccurrence("abc", "line:12", "model_call")
    b = SourceOccurrence("abc", "line:12", "tool_call[0]")
    assert a.key == "abc:line:12:model_call"
    assert a.key != b.key
    assert a == SourceOccurrence("abc", "line:12", "model_call")


def test_validation_error_carries_issues_and_message() -> None:
    issue = ValidationIssue("schema", "rules[0].entity", "unknown_entity", "Unknown entity 'foo'")
    err = MappingValidationError([issue])
    assert err.issues == (issue,)
    assert "unknown_entity" in str(err) and "rules[0].entity" in str(err)
    assert issue.severity is Severity.ERROR
