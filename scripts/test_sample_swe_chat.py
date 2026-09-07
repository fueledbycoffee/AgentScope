import json
import tempfile
import unittest
from pathlib import Path

try:
    import pyarrow as pa
    import pyarrow.parquet as pq
except ImportError:  # the scripts suite also runs where pyarrow is absent
    pa = pq = None

import sample_swe_chat as sampler


def _sessions(spec):
    return [{"session_id": sid, "agent": agent, "turn_count": 1} for sid, agent in spec]


class SelectionTests(unittest.TestCase):
    def test_round_robin_is_deterministic_and_stratified(self):
        rows = _sessions([("a1", "x"), ("a2", "x"), ("a3", "x"), ("b1", "y"), ("c1", "z")])
        first = sampler.select_sessions(rows, seed="s", per_agent=None)
        second = sampler.select_sessions(list(reversed(rows)), seed="s", per_agent=None)
        self.assertEqual([r["session_id"] for r in first], [r["session_id"] for r in second])
        agents = [r["agent"] for r in first]
        self.assertEqual(agents[:3], ["x", "y", "z"])  # one per agent before any second
        self.assertEqual(len(first), 5)
        capped = sampler.select_sessions(rows, seed="s", per_agent=1)
        self.assertEqual(sorted(r["agent"] for r in capped), ["x", "y", "z"])
        other_seed = sampler.select_sessions(rows, seed="t", per_agent=None)
        self.assertEqual(len(other_seed), 5)


@unittest.skipIf(pa is None, "pyarrow not installed")
class ExcerptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.sessions = root / "sessions.parquet"
        self.conversations = root / "conversations.parquet"
        self.out = root / "out"
        pq.write_table(
            pa.Table.from_pylist(_sessions([("s1", "x"), ("s2", "x"), ("s3", "y")])),
            self.sessions,
        )
        # non-contiguous conversation rows per session
        conv = [
            {"session_id": s, "turn_number": i, "content": "c" * 10}
            for i in range(4)
            for s in ("s1", "s3", "s2")
        ]
        pq.write_table(pa.Table.from_pylist(conv), self.conversations)

    def tearDown(self):
        self.tmp.cleanup()

    def test_whole_sessions_are_kept_and_manifest_is_written(self):
        manifest = sampler.build_excerpt(self.sessions, self.conversations, self.out, seed="s")
        self.assertEqual(manifest["outputs"]["sessions.parquet"]["rows"], 3)
        self.assertEqual(manifest["outputs"]["conversations.parquet"]["rows"], 12)
        self.assertEqual(manifest["sessions_per_agent"], {"x": 2, "y": 1})
        again = sampler.build_excerpt(self.sessions, self.conversations, self.out, seed="s")
        self.assertEqual(
            again["outputs"]["sessions.parquet"]["sha256"],
            manifest["outputs"]["sessions.parquet"]["sha256"],
        )
        written = json.loads((self.out / "manifest.json").read_text())
        self.assertEqual(written["limits"]["max_total_rows"], sampler.MAX_TOTAL_ROWS)

    def test_combined_row_limit_drops_whole_sessions_from_the_bottom(self):
        original = sampler.MAX_TOTAL_ROWS
        sampler.MAX_TOTAL_ROWS = 10  # 3 sessions + 12 turns = 15 > 10; 2 sessions + 8 turns = 10
        try:
            manifest = sampler.build_excerpt(self.sessions, self.conversations, self.out, seed="s")
        finally:
            sampler.MAX_TOTAL_ROWS = original
        self.assertEqual(manifest["outputs"]["sessions.parquet"]["rows"], 2)
        self.assertEqual(manifest["outputs"]["conversations.parquet"]["rows"], 8)
        kept = set(
            pq.read_table(self.out / "conversations.parquet").column("session_id").to_pylist()
        )
        self.assertEqual(len(kept), 2)

    def test_single_oversized_session_fails_explicitly(self):
        original = sampler.MAX_TOTAL_ROWS
        sampler.MAX_TOTAL_ROWS = 2
        try:
            with self.assertRaises(SystemExit):
                sampler.build_excerpt(self.sessions, self.conversations, self.out, seed="s")
        finally:
            sampler.MAX_TOTAL_ROWS = original


if __name__ == "__main__":
    unittest.main()
