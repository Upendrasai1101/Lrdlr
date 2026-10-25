"""
Tests for the AI server. The real Groq call is replaced with a fake, so
these run offline, cost nothing and give the same result every time.

Run from the ai-server folder:   python -m unittest -v
"""

import unittest

import app as server


class FakeGroq:
    """Stands in for call_groq(): returns whatever answer the test sets."""

    def __init__(self):
        self.answer = {}

    def __call__(self, system_prompt, user_text):
        return self.answer


class HelperTests(unittest.TestCase):
    def test_phone_rules_match_the_website(self):
        self.assertEqual(server.normalize_phone("+91 90000 12345"), "9000012345")
        self.assertIsNone(server.normalize_phone("12345"))
        self.assertIsNone(server.normalize_phone("5000012345"))

    def test_only_our_own_values_are_allowed(self):
        self.assertEqual(server.match_allowed("home battery 5kwh", server.PRODUCT_VALUES), "Home Battery 5kWh")
        self.assertIsNone(server.match_allowed("Solar Panel", server.PRODUCT_VALUES))


class EndpointTests(unittest.TestCase):
    def setUp(self):
        server.GROQ_API_KEY = "test-key"
        server._hits.clear()
        self.fake = FakeGroq()
        self._real_call = server.call_groq
        server.call_groq = self.fake
        self.client = server.app.test_client()

    def tearDown(self):
        server.call_groq = self._real_call

    # --- /extract (Smart paste) ---------------------------------------

    def test_extract_cleans_what_the_ai_returns(self):
        self.fake.answer = {"name": " Ravi ", "phone": "+91 90000 12345", "pincode": "560 034",
                            "product": "home battery 5kwh", "source": "whatsapp"}
        data = self.client.post("/extract", json={"text": "Hi naa peru Ravi..."}).get_json()
        self.assertEqual(data["fields"], {"name": "Ravi", "phone": "9000012345", "pincode": "560034",
                                          "product": "Home Battery 5kWh", "source": "WhatsApp"})
        self.assertEqual(data["missing"], [])

    def test_extract_drops_bad_ai_values_instead_of_trusting_them(self):
        self.fake.answer = {"name": "X", "phone": "12345", "pincode": "5600",
                            "product": "Solar Panel", "source": "email"}
        data = self.client.post("/extract", json={"text": "anything"}).get_json()
        self.assertEqual(sorted(data["missing"]), ["phone", "pincode", "product", "source"])

    def test_extract_input_limits(self):
        self.assertEqual(self.client.post("/extract", json={"text": ""}).status_code, 400)
        self.assertEqual(self.client.post("/extract", json={"text": "a" * 1001}).status_code, 400)

    # --- /suggest (Import fix) ----------------------------------------

    def test_suggest_never_returns_a_value_outside_our_list(self):
        self.fake.answer = {"suggestion": "Solar Panel 2kW", "reason": "made up"}
        data = self.client.post("/suggest", json={"field": "product", "value": "Solar Panel 2kW"}).get_json()
        self.assertIsNone(data["suggestion"])

    def test_suggest_only_for_product_and_source(self):
        res = self.client.post("/suggest", json={"field": "phone", "value": "12345"})
        self.assertEqual(res.status_code, 400)

    # --- /summary (AI briefing) ---------------------------------------

    def test_summary_needs_numbers(self):
        self.assertEqual(self.client.post("/summary", json={}).status_code, 400)
        self.fake.answer = {"summary": "37 leads. Next step: call them."}
        data = self.client.post("/summary", json={"stats": {"total_leads": 37}}).get_json()
        self.assertTrue(data["summary"].startswith("37 leads"))

    # --- safety -------------------------------------------------------

    def test_other_websites_are_not_allowed(self):
        res = self.client.post("/extract", json={"text": "x"}, headers={"Origin": "https://evil.example"})
        self.assertIsNone(res.headers.get("Access-Control-Allow-Origin"))
        res = self.client.post("/extract", json={"text": "x"}, headers={"Origin": "https://lrdlr-demo.web.app"})
        self.assertEqual(res.headers.get("Access-Control-Allow-Origin"), "https://lrdlr-demo.web.app")

    def test_rate_limit(self):
        self.fake.answer = {}
        codes = [self.client.post("/extract", json={"text": "x"}).status_code for _ in range(server.RATE_LIMIT + 1)]
        self.assertEqual(codes[-1], 429)


if __name__ == "__main__":
    unittest.main()
