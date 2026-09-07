"""Offline contract checks: python3 -m unittest discover -s scripts -p 'test_*.py'."""

from contextlib import redirect_stdout
import gzip
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import sample_tracelab as sampler
import scan_tracelab as scanner


class SamplerTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "source.gz"
        self.lines = []
        # Interleaved sessions; duplicate native IDs; varying project/session_file
        # for the same session; CRLF, whitespace and a final unterminated row.
        for i, (provider, sid) in enumerate([
                ("claude", "a"), ("codex", "x"), ("claude", "b"), ("codex", "y"),
                ("claude", "a"), ("codex", "x"), ("claude", "b"), ("codex", "y")]):
            row = {"session_id": sid, "provider": provider, "round_id": "duplicate",
                   "project": "p%d" % (i // 4), "session_file": "f%d" % i,
                   "tools": [{"name": "test", "value": "accent: é"}]}
            self.lines.append(("  " + json.dumps(row, ensure_ascii=False) +
                               ("\r\n" if i < 7 else "")).encode("utf-8"))
        self.source.write_bytes(gzip.compress(b"".join(self.lines)))

    def run_sample(self, name, count=1):
        output = self.root / (name + ".gz")
        digest, size = sampler.file_digest(self.source)
        with redirect_stdout(io.StringIO()):
            manifest = sampler.sample(self.source, output, self.root / (name + ".json"),
                                      {"sha256": digest, "bytes": size, "retrieved_at": None},
                                      42, count)
        return output, manifest

    def test_whole_sessions_exact_bytes_locators_and_deterministic_gzip(self):
        first, manifest = self.run_sample("first")
        second, _ = self.run_sample("second")
        self.assertEqual(first.read_bytes(), second.read_bytes())
        ids = {sid for values in manifest["selected_session_ids_per_provider"].values()
               for sid in values}
        expected = b"".join(line for line in self.lines if json.loads(line)["session_id"] in ids)
        self.assertEqual(gzip.decompress(first.read_bytes()), expected)
        self.assertEqual(manifest["output"]["rows_per_provider"], {"claude": 2, "codex": 2})
        for info in manifest["sessions"]:
            ordinal_list = [n for lo, hi in info["source_line_ranges"] for n in range(lo, hi + 1)]
            self.assertEqual(ordinal_list, [n for n, line in enumerate(self.lines, 1)
                                           if json.loads(line)["session_id"] == info["session_id"]])
            self.assertEqual(len(info["source_files"]), 2)

    def test_all_sessions_keep_final_line_and_order(self):
        output, manifest = self.run_sample("all", count=2)
        self.assertEqual(gzip.decompress(output.read_bytes()), b"".join(self.lines))
        self.assertEqual(manifest["output"]["rows"], 8)

    def test_missing_metadata_is_retained_as_absent(self):
        rows = [json.loads(line) for line in self.lines]
        for row in rows:
            del row["session_file"]
            del row["project"]
        self.source.write_bytes(gzip.compress(b"".join(
            json.dumps(row).encode() + b"\n" for row in rows)))
        _, manifest = self.run_sample("absent")
        for info in manifest["sessions"]:
            for entry in info["source_files"]:
                self.assertIsNone(entry["session_file"])
                self.assertFalse(entry["session_file_present"])
                self.assertIsNone(entry["project"])
                self.assertFalse(entry["project_present"])

    def test_ranking_contract_is_stable_and_seeded(self):
        sessions, _ = sampler.index_sessions(self.source)
        expected = {"claude": ["a"], "codex": ["y"]}
        self.assertEqual(sampler.select_sessions(sessions, 42, 1), expected)
        self.assertEqual(sampler.select_sessions(dict(reversed(list(sessions.items()))), 42, 1), expected)
        selections = {json.dumps(sampler.select_sessions(sessions, seed, 1)) for seed in range(10)}
        self.assertGreater(len(selections), 1)

    def test_truncated_gzip_does_not_publish_output(self):
        self.source.write_bytes(self.source.read_bytes()[:-8])
        with self.assertRaises(EOFError):
            self.run_sample("truncated")
        self.assertFalse((self.root / "truncated.gz").exists())

    def test_invalid_counts_and_input_fail(self):
        for count in (0, 3):
            with self.assertRaises(ValueError):
                self.run_sample("invalid", count)
        self.source.write_bytes(gzip.compress(b'{"session_id": null}\n'))
        with self.assertRaises(ValueError):
            self.run_sample("malformed")
        self.source.write_bytes(b"not gzip")
        with self.assertRaises(OSError):
            self.run_sample("corrupt")

    def test_cross_provider_identity_fails(self):
        changed = json.loads(self.lines[1])
        changed["session_id"] = "a"
        self.source.write_bytes(gzip.compress(self.lines[0] + json.dumps(changed).encode() + b"\n"))
        with self.assertRaisesRegex(ValueError, "crosses provider"):
            sampler.index_sessions(self.source)

    def test_bad_cache_is_not_reused_or_replaced(self):
        before = self.source.read_bytes()
        with self.assertRaisesRegex(ValueError, "SHA-256/size mismatch"):
            sampler.ensure_source(self.source)
        self.assertEqual(before, self.source.read_bytes())

    def test_download_receipt_reuse_and_bad_download_cleanup(self):
        payload = self.source.read_bytes()
        digest, size = sampler.file_digest(self.source)
        cache = self.root / "download.gz"
        with patch.object(sampler, "UPSTREAM_SHA256", digest), patch.object(
                sampler, "UPSTREAM_BYTES", size), patch.object(
                    sampler.urllib.request, "urlopen", return_value=io.BytesIO(payload)) as request:
            with redirect_stdout(io.StringIO()):
                first = sampler.ensure_source(cache)
                second = sampler.ensure_source(cache)
            self.assertEqual(first, second)
            self.assertIsNotNone(first["retrieved_at"])
            self.assertEqual(request.call_count, 1)
        bad_cache = self.root / "bad.gz"
        before = set(self.root.iterdir())
        with patch.object(sampler.urllib.request, "urlopen", return_value=io.BytesIO(b"bad")):
            with self.assertRaises(ValueError), redirect_stdout(io.StringIO()):
                sampler.ensure_source(bad_cache)
        self.assertEqual(before, set(self.root.iterdir()))

    def test_existing_cache_does_not_invent_retrieval_time(self):
        digest, size = sampler.file_digest(self.source)
        with patch.object(sampler, "UPSTREAM_SHA256", digest), patch.object(sampler, "UPSTREAM_BYTES", size):
            self.assertIsNone(sampler.ensure_source(self.source)["retrieved_at"])

    def test_scanner_checks_nested_decoded_strings_without_printing_values(self):
        row = {"tools": [{"email": "person@example.org", "path": "/home/synthetic/file",
                          "windows": "C:\\Users\\synthetic\\file", "api_key": "synthetic-only",
                          "url": "https://user:pass@example.org", "key": "sk-" + "x" * 30}]}
        self.source.write_bytes(gzip.compress(json.dumps(row).encode()))
        report = scanner.scan(self.source)
        for category in ("email", "absolute_home_path", "secret_field", "credential_url", "known_token"):
            self.assertGreater(report["candidate_counts"][category], 0)
        self.assertNotIn("person@example.org", json.dumps(report))


if __name__ == "__main__":
    unittest.main()
