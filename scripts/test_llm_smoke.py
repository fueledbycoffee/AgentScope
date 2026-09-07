import unittest

import llm_smoke


class ScrubTests(unittest.TestCase):
    def test_key_is_replaced_everywhere_including_escaped_forms(self) -> None:
        key = "sk-or-v1-" + "k" * 40
        payload = {
            "choices": [{"message": {"content": f"said {key}", "reasoning": [key, {"k": key}]}}],
            key: "as a key",
            "escaped": key.replace("-", "\\u002d"),
        }
        scrubbed = llm_smoke.scrub(payload, key)
        text = str(scrubbed)
        self.assertNotIn(key, text)
        self.assertEqual(scrubbed["choices"][0]["message"]["content"], "said <key>")
        self.assertEqual(scrubbed["escaped"], "<key>")  # the \u002d-encoded form too
        self.assertEqual(scrubbed["choices"][0]["message"]["reasoning"], ["<key>", {"k": "<key>"}])
        self.assertIn("<key>", scrubbed)
        self.assertFalse(llm_smoke.still_contains(scrubbed, key))
        self.assertTrue(llm_smoke.still_contains({"x": key.replace("-", "\\u002d")}, key))
        self.assertEqual(llm_smoke.scrub({"a": 1}, ""), {"a": 1})


if __name__ == "__main__":
    unittest.main()
