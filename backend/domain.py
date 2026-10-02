import json
import math

def latest_results(p):
    results = []
    for test in p.tests:
        attempt = next((run for run in reversed(p.runs) if test.id in run.testIds), None)
        result = next((r for r in reversed(p.results) if r.testId == test.id and r.version == test.version
                       and (attempt is None or r.runId == attempt.id)), None)
        if result and result.status == "Passed":
            fields = ("action", "target", "value", "expected", "humanApproval")
            complete = bool(result.screenshot and result.trace and len(result.steps) == len(test.steps)
                            and all(s.status == "Passed" and all(getattr(s, k) == getattr(t, k) for k in fields)
                                    for s, t in zip(result.steps, test.steps))
                            and any(s.action in {"assertVisible", "assertText", "assertValue", "assertURL", "api", "database"}
                                    and not s.humanApproval for s in result.steps))
            if not complete:
                result = result.model_copy(update={"status": "Warning", "actual": "Saved pass lacks complete matching execution and evidence. Re-run the current test."})
        if result:
            results.append(result)
    return results

def fingerprint(p):
    data = dict(requirements=[r.model_dump(exclude_none=True) for r in p.requirements],
                tests=[t.model_dump(exclude_none=True) for t in p.tests],
                results=[r.id for r in latest_results(p)],
                issues=[[i.id, i.status, i.severity] for i in p.issues], url=p.url)
    if p.runs:
        data["latestRun"] = p.runs[-1].id
    def clean(value):
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items() if v is not None}
        if isinstance(value, list):
            return [clean(v) for v in value]
        if isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    return json.dumps(clean(data), sort_keys=True, ensure_ascii=False, separators=(",", ":"))

def metrics(p):
    results = latest_results(p)
    passed = sum(r.status == "Passed" for r in results)
    validated = 0
    for req in p.requirements:
        tests = [t for t in p.tests if req.id in t.requirementIds]
        if tests and all(any(r.testId == t.id and r.status == "Passed" for r in results) for t in tests):
            validated += 1
    blocking = any(i.severity in {"Critical", "High"} and i.status not in {"Verified", "Closed"} for i in p.issues)
    ready = bool(p.requirements and p.tests and validated == len(p.requirements) and passed == len(p.tests)
                 and not blocking and not any(r.status in {"Running", "Paused", "Error", "Cancelled"} for r in p.runs[-1:]))
    return {"ready": ready, "validated": validated, "passed": passed,
            "coverage": math.floor(validated / len(p.requirements) * 100 + 0.5) if p.requirements else 0}
