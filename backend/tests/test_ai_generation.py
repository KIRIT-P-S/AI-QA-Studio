import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from models import Project, Requirement
from test_generation import generate_tests
from validation import test_schema, validate_steps
from google.genai import types

def project():
    return Project(id="p", name="Shop", description="", url="http://127.0.0.1:4180/", environment="Local", owner="QA",
                   members=[], createdAt="", updatedAt="", requirements=[Requirement(id="r", title="Mouse details",
                   description="Mouse details open at /products/mouse", acceptanceCriteria=["URL /products/mouse"], source="PRD")])

def plan():
    return {"tests": [{"title": "Mouse details", "expected": "Mouse details open at /products/mouse", "requirementIds": ["r"],
                       "steps": [{"action": "navigate", "target": "/"}, {"action": "click", "target": "#view-mouse"},
                                 {"action": "assertURL", "target": "/products/mouse", "expected": "/products/mouse"}]}]}

class GenerationTests(unittest.TestCase):
    def test_schema_requires_expected_only_for_assertions(self):
        schema = test_schema(["r"])
        types.GenerateContentConfig(response_schema=schema)
        branches = schema["properties"]["tests"]["items"]["properties"]["steps"]["items"]["anyOf"]
        assertion = next(b for b in branches if "assertURL" in b["properties"]["action"]["enum"])
        self.assertIn("expected", assertion["required"])
        visible = next(b for b in branches if "assertVisible" in b["properties"]["action"]["enum"])
        self.assertNotIn("expected", visible["properties"])

    def test_valid_plan_does_not_retry(self):
        calls = []
        def generate(*args):
            calls.append(args)
            return plan()
        self.assertEqual(generate_tests(project(), {}, generate)[0]["steps"][-1].expected, "/products/mouse")
        self.assertEqual(len(calls), 1)

    def test_missing_or_blank_assert_url_expected_is_corrected(self):
        for expected in (None, "", "  "):
            with self.subTest(expected=expected):
                draft = plan()
                if expected is None:
                    del draft["tests"][0]["steps"][-1]["expected"]
                else:
                    draft["tests"][0]["steps"][-1]["expected"] = expected
                calls = []
                def generate(instruction, data, schema):
                    calls.append(data)
                    return draft if len(calls) == 1 else plan()
                validated = generate_tests(project(), {"discovery": []}, generate)
                self.assertEqual(validated[0]["steps"][-1].expected, "/products/mouse")
                self.assertIn("assertURL needs an expected outcome", calls[1]["validationError"])
                self.assertEqual(len(calls), 2)
                self.assertEqual(draft["tests"][0]["steps"][-1].get("expected"), expected)

    def test_failed_correction_remains_invalid_and_does_not_retry_forever(self):
        calls = []
        def generate(*args):
            calls.append(args)
            draft = plan(); del draft["tests"][0]["steps"][-1]["expected"]
            return draft
        with self.assertRaisesRegex(ValueError, "after correction.*assertURL.*No draft tests were saved"):
            generate_tests(project(), {}, generate)
        self.assertEqual(len(calls), 2)

    def test_correction_cannot_change_plan_or_known_assertion_expectations(self):
        for change in ("title", "outcome", "url", "drop-step", "drop-test", "human"):
            with self.subTest(change=change):
                draft = plan()
                draft["tests"][0]["steps"].append({"action": "assertText", "target": "#product-title"})
                fixed = copy.deepcopy(draft)
                fixed["tests"][0]["steps"][-1]["expected"] = "Wireless Mouse"
                if change == "title": fixed["tests"][0]["title"] = "Different scenario"
                if change == "outcome": fixed["tests"][0]["expected"] = "Anything loads"
                if change == "url": fixed["tests"][0]["steps"][2]["expected"] = "/"
                if change == "drop-step": del fixed["tests"][0]["steps"][2]
                if change == "drop-test": fixed["tests"].append(copy.deepcopy(fixed["tests"][0]))
                if change == "human": fixed["tests"][0]["steps"][-1]["humanApproval"] = True
                responses = iter([draft, fixed])
                with self.assertRaisesRegex(ValueError, "No draft tests were saved"):
                    generate_tests(project(), {}, lambda *args: next(responses))

    def test_manual_url_assertion_stays_strict(self):
        with self.assertRaisesRegex(ValueError, "assertURL needs an expected outcome"):
            validate_steps([{"action": "assertURL", "target": "/products/mouse"}])

if __name__ == "__main__":
    unittest.main(verbosity=2)
