"""Validate AI proposals before persisting drafts, with one bounded correction."""
from copy import deepcopy
import ai
from validation import TEST_PROMPT, test_input, test_schema

def validate_proposals(response, project):
    raw_tests = response.get("tests") if isinstance(response, dict) else None
    if not isinstance(raw_tests, list) or not 1 <= len(raw_tests) <= 100:
        raise ValueError("AI must return between 1 and 100 executable test cases.")
    validated = []
    for index, item in enumerate(raw_tests, 1):
        try:
            validated.append(test_input(item, project))
        except (ValueError, TypeError, AttributeError) as error:
            title = item.get("title", "Untitled") if isinstance(item, dict) else "Invalid test"
            raise ValueError(f"Test {index} ({str(title)[:200]}): {error}") from error
    return validated

def generate_tests(project, data, generator=None):
    generate = generator or ai.generate_json
    schema = test_schema([r.id for r in project.requirements])
    response = generate(TEST_PROMPT, data, schema)
    try:
        return validate_proposals(response, project)
    except ValueError as error:
        correction_data = {
            "source": data, "draft": deepcopy(response), "validationError": str(error),
        }
        correction_prompt = TEST_PROMPT + '''
Correct the supplied draft using the validation error. Return the complete corrected test plan.
Preserve requirement links, scenario intent and every existing expected outcome.
For assertURL, explicitly provide expected using the intended destination supported by the source requirements
and observed links. Do not use the current page or an arbitrary URL just to satisfy validation.
Never delete a scenario or remove a failing assertion to make a draft valid. If the intended expected outcome
is unsupported, do not guess it. Assertions must run automatically and must retain their expected behavior.'''
        corrected = generate(correction_prompt, correction_data, schema)
        try:
            valid = validate_proposals(corrected, project)
            # Repair is for malformed steps, not changing the plan or its test oracle.
            original = response.get("tests") if isinstance(response, dict) else None
            if isinstance(original, list) and len(original) == len(valid):
                for before, after in zip(original, valid):
                    if not isinstance(before, dict):
                        continue
                    for key in ("title", "expected", "requirementIds"):
                        if key in before and before[key] != after[key]:
                            raise ValueError("AI correction changed a scenario or its expected outcome.")
                    old_steps = before.get("steps")
                    if isinstance(old_steps, list):
                        if len(old_steps) != len(after["steps"]):
                            raise ValueError("AI correction changed the test steps instead of repairing their fields.")
                        for old, new in zip(old_steps, after["steps"]):
                            if not isinstance(old, dict):
                                continue
                            if any(key in old and old[key] != getattr(new, key) for key in ("action", "target", "value")) or ("humanApproval" in old and bool(old["humanApproval"]) != bool(new.humanApproval)):
                                raise ValueError("AI correction changed an existing action or input.")
                            missing_expected = old.get("expected") is None or (
                                old.get("action") in {"assertText", "assertURL", "api", "database"}
                                and isinstance(old.get("expected"), str) and not old["expected"].strip())
                            if not missing_expected and old["expected"] != new.expected:
                                raise ValueError("AI correction changed an existing assertion expectation.")
            elif isinstance(original, list):
                raise ValueError("AI correction changed the number of proposed test cases.")
            return valid
        except ValueError as final_error:
            raise ValueError(f"AI could not produce valid test cases after correction. {final_error} No draft tests were saved.") from final_error
