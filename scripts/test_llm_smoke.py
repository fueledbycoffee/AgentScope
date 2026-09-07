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
        self.assertIn("<key>", scrubbed)
        self.assertEqual(llm_smoke.scrub({"a": 1}, ""), {"a": 1})


if __name__ == "__main__":
    unittest.main()
