import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fingerprint,
  metrics,
  type Project,
  type Result,
} from "../../web/lib/studio/model";
import { validateSteps } from "../../web/lib/studio/validation";
import { assertReadOnly } from "../src/readOnlyDatabase";
import { mutate, readStore, validateURL } from "../../web/lib/studio/store";
function sample(): Project {
  return {
    id: "p",
    name: "Fixture",
    description: "",
    url: "http://localhost:4173",
    environment: "Local",
    owner: "QA",
    members: [],
    createdAt: "",
    updatedAt: "",
    requirements: [
      {
        id: "r",
        title: "Save",
        description: "Save",
        acceptanceCriteria: ["Saved"],
        source: "test",
      },
    ],
    tests: [
      {
        id: "t",
        title: "Save",
        expected: "Saved",
        requirementIds: ["r"],
        approved: true,
        steps: [{ action: "assertVisible", target: "body" }],
        version: 1,
        kind: "Functional",
      },
    ],
    results: [],
    runs: [],
    issues: [],
    discovery: [],
    documents: [],
    signoffs: [],
    activity: [],
  };
}
function result(status: Result["status"] = "Passed"): Result {
  return {
    id: "result-1",
    testId: "t",
    version: 1,
    runId: "run",
    title: "Save",
    requirementIds: ["r"],
    status,
    expected: "Saved",
    actual: "Saved",
    impact: "",
    likelyCause: "",
    confidence: null,
    startedAt: "",
    duration: 1,
    steps: [
      {
        action: "assertVisible",
        target: "body",
        status: "Passed",
        detail: "Visible",
        duration: 1,
      },
    ],
    screenshot: "result-1.png",
    trace: "result-1.zip",
    console: [],
    network: [],
  };
}
test("Empty and unexecuted projects cannot be ready", () => {
  const p = sample();
  assert.equal(metrics(p).ready, false);
  assert.equal(metrics(p).coverage, 0);
});
test("Coverage requires every linked current test to pass", () => {
  const p = sample();
  p.results.push(result());
  assert.equal(metrics(p).coverage, 100);
  p.tests.push({ ...p.tests[0], id: "t2" });
  assert.equal(metrics(p).coverage, 0);
  assert.equal(metrics(p).ready, false);
});
test("Latest failed result supersedes a previous pass", () => {
  const p = sample();
  p.results.push(result(), { ...result("Failed"), id: "result-2" });
  assert.equal(metrics(p).passed, 0);
  assert.equal(metrics(p).failed, 1);
  assert.equal(metrics(p).ready, false);
});
test("Missing evidence, skipped assertions and changed steps cannot count as passes", () => {
  for (const change of [
    { screenshot: undefined },
    { trace: undefined },
    { steps: [] },
    { steps: [{ ...result().steps[0], humanApproval: true }] },
    { steps: [{ ...result().steps[0], target: "#other" }] },
  ]) {
    const p = sample();
    p.results.push({ ...result(), ...change });
    assert.equal(metrics(p).passed, 0);
    assert.equal(metrics(p).coverage, 0);
    assert.equal(metrics(p).warnings, 1);
  }
});
test("An unfinished new attempt supersedes the previous passing run", () => {
  const p = sample();
  p.results.push(result());
  p.runs.push({
    id: "cancelled",
    status: "Cancelled",
    testIds: ["t"],
    startedAt: "",
  });
  assert.equal(metrics(p).passed, 0);
  assert.equal(metrics(p).coverage, 0);
  assert.equal(metrics(p).ready, false);
});
test("Editing tests invalidates old result coverage", () => {
  const p = sample();
  p.results.push(result());
  p.tests[0].version++;
  assert.equal(metrics(p).executed, 0);
  assert.equal(metrics(p).coverage, 0);
});
test("Blocking issues override passing tests", () => {
  const p = sample();
  p.results.push(result());
  p.issues.push({
    id: "i",
    title: "Issue",
    testId: "t",
    requirementIds: ["r"],
    resultIds: [],
    severity: "High",
    status: "Open",
    notes: "",
    createdAt: "",
  });
  assert.equal(metrics(p).ready, false);
  p.issues[0].status = "Verified";
  assert.equal(metrics(p).ready, true);
});
test("Signoff is invalidated as soon as a new run begins", () => {
  const p = sample();
  p.results.push(result());
  const fp = fingerprint(p);
  p.qaValidation = { name: "QA", at: "", fingerprint: fp };
  p.signoffs.push({ id: "s", name: "Dev", at: "", note: "", fingerprint: fp });
  assert.equal(metrics(p).signed, true);
  p.runs.push({
    id: "new-run",
    status: "Running",
    testIds: ["t"],
    startedAt: "",
  });
  assert.equal(metrics(p).ready, false);
  assert.equal(metrics(p).signed, false);
  assert.equal(metrics(p).qa, false);
});
test("Manual approval cannot bypass an assertion", () => {
  assert.throws(() =>
    validateSteps([
      {
        action: "assertText",
        target: "#status",
        expected: "Active",
        humanApproval: true,
      },
    ]),
  );
  assert.throws(() =>
    validateSteps([{ action: "assertText", target: "#status" }]),
  );
  assert.throws(() => validateSteps([{ action: "shell", target: "whoami" }]));
});
test("URL and SQL boundaries reject unsafe input", () => {
  for (const url of [
    "file:///secret",
    "javascript:alert(1)",
    "https://user:secret@example.com",
  ])
    assert.throws(() => validateURL(url));
  for (const sql of [
    "DELETE FROM users",
    "SELECT 1; DROP TABLE users",
    "SELECT * INTO backup FROM users",
    "SELECT pg_sleep(100)",
    "SELECT * FROM users FOR UPDATE",
    "SELECT 1 -- hidden statement",
  ])
    assert.throws(() => assertReadOnly(sql));
  assert.doesNotThrow(() =>
    assertReadOnly("SELECT id FROM partners WHERE status = 'Active'"),
  );
});
test("Concurrent storage mutations preserve all writes and roll back errors", async () => {
  const prefix = `concurrency-${Date.now()}-`;
  await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      mutate((s) => s.projects.push({ ...sample(), id: prefix + i })),
    ),
  );
  const s = await readStore();
  assert.equal(s.projects.filter((p) => p.id.startsWith(prefix)).length, 20);
  await assert.rejects(
    mutate((s) => {
      s.projects.push({ ...sample(), id: prefix + "rollback" });
      throw new Error("rollback");
    }),
  );
  assert.ok(
    !(await readStore()).projects.some((p) => p.id === prefix + "rollback"),
  );
});
