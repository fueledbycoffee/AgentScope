def test_timestamp_notes_flag_naive_and_over_precise_strings() -> None:
    from agentscope_app.domain.units import timestamp_notes

    assert timestamp_notes("2026-09-07T12:00:00Z", "iso8601") == ()
    assert timestamp_notes("2026-09-07T12:00:00.123456+02:00", "iso8601") == ()
    assert timestamp_notes("2026-09-07T12:00:00", "iso8601") == ("naive_timestamp",)
    assert timestamp_notes("2026-09-07T12:00:00.123456789Z", "iso8601") == ("precision_reduced",)
    assert timestamp_notes("2026-09-07 12:00:00.1234567", "iso8601") == (
        "naive_timestamp",
        "precision_reduced",
    )
    assert timestamp_notes("2026-09-07T12:00:00.123456789-05:00", "iso8601") == (
        "precision_reduced",
    )
    assert timestamp_notes(1_700_000_000, "epoch_s") == ()
    assert timestamp_notes(None, "iso8601") == ()
