import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
(ROOT / "verification-data").mkdir(exist_ok=True)
TEMP = tempfile.TemporaryDirectory(prefix="workflow-unit-", dir=ROOT / "verification-data")
os.environ["STUDIO_DATA_DIR"] = TEMP.name
sys.path.insert(0, str(ROOT / "backend"))
import store
from models import Project, Requirement, TestCase, Result, Run
from validation import validate_steps, test_input, test_schema
from domain import metrics, fingerprint

def project():
    return Project(id="p", name="Portal", description="", url="http://127.0.0.1:4173", environment="Local", owner="QA",
                   members=[], createdAt="", updatedAt="", requirements=[Requirement(id="r", title="Search", description="Find items",
                   acceptanceCriteria=["Matching item appears"], source="fixture")], tests=[TestCase(id="t", title="Search", expected="Match",
                   requirementIds=["r"], steps=[{"action": "assertText", "target": "#results", "expected": "Match"}],
                   approved=True, kind="Functional", version=1)])

class WorkflowTests(unittest.TestCase):
    def test_invalid_assertions_are_rejected(self):
        for steps in ([], [{"action": "click", "target": "button"}],
                      [{"action": "assertText", "target": "body"}],
                      [{"action": "assertText", "target": "body", "expected": "OK", "humanApproval": True}],
                      [{"action": "assertVisible", "target": "body", "expected": "OK"}],
                      [{"action": "api", "target": "/", "expected": "success"}]):
            with self.subTest(steps=steps), self.assertRaises(ValueError):
                validate_steps(steps)
        validate_steps([{"action": "assertValue", "target": "#query", "expected": ""}])

    def test_unknown_requirement_links_are_rejected(self):
        p = project()
        value = p.tests[0].model_dump()
        value["requirementIds"] = ["made-up"]
        with self.assertRaises(ValueError):
            test_input(value, p)
        self.assertEqual(test_schema(["r"])["properties"]["tests"]["items"]["properties"]["requirementIds"]["items"]["enum"], ["r"])

    def test_invalid_urls(self):
        for url in ("https://", "javascript:alert(1)", "https://user:secret@example.com", "http://localhost:bad"):
            with self.subTest(url=url), self.assertRaises(Exception):
                store.validate_url(url)

    def test_corrupt_storage_is_not_replaced_with_empty_data(self):
        Path(store.FILE_PATH).write_text("invalid JSON")
        try:
            with self.assertRaises(json.JSONDecodeError):
                store.mutate(lambda s: None)
            self.assertEqual(Path(store.FILE_PATH).read_text(), "invalid JSON")
        finally:
            Path(store.FILE_PATH).unlink()

    def test_python_and_node_writers_preserve_all_updates(self):
        p = project()
        fixture = Path(TEMP.name) / "fixture.json"
        fixture.write_text(p.model_dump_json(exclude_none=True), encoding="utf8")
        worker = subprocess.Popen(["node", str(ROOT / "agent/node_modules/tsx/dist/cli.mjs"),
                                   str(ROOT / "agent/tests/storage-worker.ts"), "write", str(fixture)], cwd=ROOT,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        def write(i):
            store.mutate(lambda s: s.projects.append(p.model_copy(update={"id": f"python-{i}"})))
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(write, range(20)))
        out, err = worker.communicate(timeout=60)
        self.assertEqual(worker.returncode, 0, err.decode())
        ids = {p.id for p in store.read_store().projects}
        self.assertEqual(len(ids), 40)
        self.assertTrue({f"node-{i}" for i in range(20)} <= ids)

    def test_fingerprints_match_frontend_and_cancelled_attempt_supersedes_pass(self):
        p = project()
        p.results.append(Result(id="res", runId="run", testId="t", version=1, title="Search", requirementIds=["r"],
                                status="Passed", expected="Match", actual="Match", impact="", likelyCause="", startedAt="", duration=1,
                                screenshot="res.png", trace="res.zip", steps=[dict(action="assertText", target="#results", expected="Match",
                                status="Passed", detail="Match", duration=1)], console=[], network=[]))
        self.assertEqual(metrics(p)["coverage"], 100)
        for state in ("passed", "missing-evidence", "cancelled"):
            if state == "missing-evidence":
                p.results[0].trace = None
                self.assertEqual(metrics(p)["coverage"], 0)
            if state == "cancelled":
                p.runs.append(Run(id="new", status="Cancelled", testIds=["t"], startedAt=""))
                self.assertEqual(metrics(p)["passed"], 0)
            fixture = Path(TEMP.name) / "fingerprint.json"
            fixture.write_text(p.model_dump_json(exclude_none=True), encoding="utf8")
            data = json.loads(subprocess.check_output(["node", str(ROOT / "agent/node_modules/tsx/dist/cli.mjs"),
                       str(ROOT / "agent/tests/storage-worker.ts"), "fingerprint", str(fixture)], cwd=ROOT, timeout=30))
            self.assertEqual(data["fingerprint"], fingerprint(p))
            for key in ("passed", "ready", "coverage", "validated"):
                self.assertEqual(data["metrics"][key], metrics(p)[key])

if __name__ == "__main__":
    unittest.main(verbosity=2)
