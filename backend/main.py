import os

# Load .env.local manually
env_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "web", ".env.local"))
if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#"):
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and value and key not in os.environ:
                    os.environ[key] = value

import io
import json
import base64
import datetime
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, Request, Response, Form, UploadFile, File, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from fastapi.concurrency import run_in_threadpool

import store
from store import Studio, Project
import ai
import agent_client
import imports
from validation import validate_steps, test_input
from test_generation import generate_tests
from domain import metrics, fingerprint, latest_results
from models import Requirement, TestCase, Step, Result, Issue, Signoff, QAValidation
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    await run_in_threadpool(store.migrate_legacy_projects)
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def check_local(request: Request):
    host = request.client.host if request.client else ""
    if host not in ["127.0.0.1", "::1", "localhost"]:
        raise HTTPException(403, "Local access only.")
    from urllib.parse import urlparse
    if urlparse("http://" + request.headers.get("host", "")).hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise HTTPException(403, "Invalid local host.")
    origin = request.headers.get("origin")
    if origin and origin not in {"http://127.0.0.1:3000", "http://localhost:3000", "http://127.0.0.1:8000", "http://localhost:8000"}:
        raise HTTPException(403, "Cross-origin requests are blocked.")

def ensure_idle(p: Project):
    for r in p.runs:
        if r.status in ["Running", "Paused"]:
            raise Exception("Stop or finish the current run before editing validation inputs.")

def check_links(p: Project, ids: List[str]):
    for req_id in ids:
        if not any(r.id == req_id for r in p.requirements):
            raise Exception("A test references a requirement that does not exist in this project.")

@app.get("/api/studio")
def get_studio(request: Request):
    check_local(request)
    try:
        data = store.read_store().model_dump(exclude_none=True)
        for project in data["projects"]:
            for result in project["results"]:
                result.setdefault("confidence", None)
        data["ai"] = ai.ai_config()
        return data
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

@app.post("/api/studio")
async def post_studio(request: Request):
    check_local(request)
    try:
        content_type = request.headers.get("content-type", "")
        if "multipart/form-data" in content_type:
            form = await request.form()
            file: UploadFile = form.get("file")
            project_id = str(form.get("projectId", ""))
            kind = str(form.get("kind", ""))
            use_ai = form.get("useAI") == "true"

            if not file:
                raise Exception("Choose a file to upload.")

            def process_upload(s: Studio):
                p = store.project_by_id(s, project_id)
                ensure_idle(p)
                content_bytes = file.file.read()
                if len(content_bytes) > 10 * 1024 * 1024:
                    raise ValueError("Maximum file size is 10 MB.")

                if kind == "requirements":
                    text_content = imports.document_text(file.filename, content_bytes)
                    new_reqs = []
                    if use_ai:
                        schema = {
                            "type": "object",
                            "properties": {
                                "requirements": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "title": {"type": "string"},
                                            "description": {"type": "string"},
                                            "acceptanceCriteria": {"type": "array", "items": {"type": "string"}}
                                        }
                                    }
                                }
                            }
                        }
                        resp = ai.generate_json(
                            'Extract functional requirements and verifiable acceptance criteria. Schema: {"requirements":[{"title":"...","description":"...","acceptanceCriteria":["..."]}]}. Do not invent requirements.',
                            {"content": text_content}, schema
                        )
                        raw_reqs = resp.get("requirements", [])
                        if not isinstance(raw_reqs, list) or len(raw_reqs) > 300:
                            raise ValueError("Extract between 1 and 300 requirements. Split the PRD if necessary.")
                        for r in raw_reqs:
                            if not r.get("title", "").strip() or not r.get("acceptanceCriteria") or not all(isinstance(c, str) and c.strip() for c in r["acceptanceCriteria"]):
                                raise ValueError("Extracted requirements need a title and verifiable acceptance criteria. Review the document or retry.")
                            new_reqs.append(Requirement(
                                id=store.generate_id("FR"),
                                title=r.get("title", "")[:200],
                                description=r.get("description", r.get("title", "")),
                                acceptanceCriteria=r.get("acceptanceCriteria", [r.get("description", "")]),
                                source=file.filename
                            ))
                    else:
                        lines = [line.strip() for line in text_content.split("\n") if len(line.strip()) > 12]
                        if len(lines) > 300:
                            raise ValueError("Split the PRD into documents with at most 300 requirements.")
                        for line in lines:
                            new_reqs.append(Requirement(
                                id=store.generate_id("FR"),
                                title=line[:180],
                                description=line,
                                acceptanceCriteria=[line],
                                source=f"{file.filename} · manual review"
                            ))

                    if not new_reqs:
                        raise Exception("No requirements found.")

                    p.requirements.extend(new_reqs)
                    p.documents.append({
                        "id": store.generate_id("DOC"),
                        "name": file.filename,
                        "kind": kind,
                        "uploadedAt": datetime.datetime.utcnow().isoformat() + "Z",
                        "count": len(new_reqs)
                    })
                    store.add_activity(p, f"Imported {len(new_reqs)} requirements from {file.filename}.")

                elif kind == "tests":
                    rows = imports.test_rows(file.filename, content_bytes)
                    if not rows or len(rows) > 300:
                        raise Exception("Import between 1 and 300 tests at a time.")

                    inputs = []
                    # Basic manual parse attempt
                    try:
                        for row in rows:
                            req_ids = [v.strip() for v in row.get("requirementids", row.get("requirement ids", "")).split(",") if v.strip()]
                            inputs.append({
                                "title": row.get("title", row.get("name", row.get("test name", ""))),
                                "expected": row.get("expected", row.get("expected result", "")),
                                "steps": json.loads(row.get("steps", "[]")),
                                "requirementIds": req_ids,
                                "kind": row.get("kind", "Imported")
                            })
                        for value in inputs:
                            test_input(value, p)
                    except Exception:
                        if not use_ai:
                            raise Exception("Use the CSV template with JSON steps, or enable AI.")
                        inputs = generate_tests(
                            p,
                            {"rows": rows, "url": p.url, "requirements": [r.model_dump() for r in p.requirements],
                             "discovery": [d.model_dump() for d in p.discovery]}
                        )
                    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 300:
                        raise ValueError("No valid tests returned. Review the uploaded cases and discovered application.")

                    new_tests = []
                    for v in inputs:
                        new_tests.append(TestCase(
                            id=store.generate_id("TC"),
                            **test_input(v, p),
                            version=1,
                            approved=False
                        ))

                    check_links(p, [req for t in new_tests for req in t.requirementIds])
                    p.tests.extend(new_tests)
                    p.documents.append({
                        "id": store.generate_id("DOC"),
                        "name": file.filename,
                        "kind": kind,
                        "uploadedAt": datetime.datetime.utcnow().isoformat() + "Z",
                        "count": len(new_tests)
                    })
                    store.add_activity(p, f"Imported {len(new_tests)} draft tests from {file.filename}.")

                else:
                    raise Exception("Unknown upload type.")

            await run_in_threadpool(store.mutate, process_upload)
            return {"ok": True}

        # JSON body
        body = await request.json()
        action = body.get("action")

        if action == "createProject":
            def create_proj(s: Studio):
                if not str(body.get("name", "")).strip() or not str(body.get("owner", "")).strip():
                    raise ValueError("Project name and owner are required.")
                now = datetime.datetime.utcnow().isoformat() + "Z"
                p = Project(
                    id=store.generate_id("PRJ"),
                    name=body.get("name", "")[:100],
                    description=body.get("description", "")[:3000],
                    url=store.validate_url(body.get("url", "")),
                    environment=body.get("environment", "Staging"),
                    owner=body.get("owner", "")[:100],
                    members=[m.strip() for m in body.get("members", "").split(",") if m.strip()],
                    createdAt=now,
                    updatedAt=now
                )
                store.add_activity(p, "Project created.")
                s.projects.append(p)
                return p.id
            pid = store.mutate(create_proj)
            return {"ok": True, "projectId": pid}

        project_id = body.get("projectId")

        if action == "analyzeResult":
            def analyze(s: Studio):
                p = store.project_by_id(s, project_id)
                res_id = body.get("resultId")
                res = next((r for r in p.results if r.id == res_id), None)
                if not res:
                    raise Exception("Result not found.")
                analysis = ai.generate_json(
                    'Analyze this actual test execution. Return {"impact":"...", "likelyCause":"...", "confidence":0}.',
                    {"title": res.title, "expected": res.expected, "actual": res.actual, "steps": [s.model_dump() for s in res.steps]}
                )
                res.impact = str(analysis.get("impact", ""))
                res.likelyCause = str(analysis.get("likelyCause", ""))
                import math
                confidence = analysis.get("confidence")
                if confidence is not None and not math.isfinite(float(confidence)):
                    raise ValueError("AI returned an invalid confidence score.")
                res.confidence = max(0, min(100, float(confidence))) if confidence is not None else None
                store.add_activity(p, f"AI analyzed evidence for {res.title}.")
                return res.model_dump()
            return {"ok": True, "result": await run_in_threadpool(store.mutate, analyze)}

        if action in ["connect", "status", "pause", "resume", "cancel", "disconnect", "discover", "run"]:
            res = await run_in_threadpool(
                agent_client.agent_call,
                action,
                {
                    "projectId": project_id,
                    "testIds": body.get("testIds"),
                    "maxPages": body.get("maxPages"),
                    "maxDepth": body.get("maxDepth"),
                    "timeLimit": body.get("timeLimit")
                },
                action == "connect"
            )
            res["ok"] = True
            return res

        if action == "generateTests":
            def gen_tests(s: Studio):
                p = store.project_by_id(s, project_id)
                ensure_idle(p)
                if not p.requirements or not p.discovery:
                    raise ValueError("Upload a PRD, connect the URL and discover the application before generating executable tests.")

                discovery_data = [d.model_dump() for d in p.discovery]
                req_data = [r.model_dump() for r in p.requirements]

                inputs = generate_tests(
                    p,
                    {
                        "requirements": req_data,
                        "discovery": discovery_data,
                        "url": p.url,
                        "workflow": str(body.get("workflow", ""))[:10000]
                    }
                )

                new_tests = []
                mock_data_log = []

                for valid in inputs:
                    for step in valid["steps"]:
                        if step.action == "fill" and step.value:
                            mock_data_log.append({
                                "test_title": valid["title"],
                                "target": step.target,
                                "generated_value": step.value
                            })

                    test_case = TestCase(
                        id=store.generate_id("TC"),
                        **valid,
                        version=1,
                        approved=False
                    )
                    new_tests.append(test_case)

                check_links(p, [req for t in new_tests for req in t.requirementIds])
                p.tests.extend(new_tests)

                if mock_data_log:
                    log_file = os.path.join(store.DATA_DIR, "mock_data_log.jsonl")
                    with open(log_file, "a", encoding="utf-8") as f:
                        for entry in mock_data_log:
                            entry["timestamp"] = datetime.datetime.utcnow().isoformat() + "Z"
                            f.write(json.dumps(entry) + "\n")

                store.add_activity(p, f"Generated {len(new_tests)} tests awaiting approval. Mock data noted in mock_data_log.jsonl if applicable.")
                return {"ok": True}

            return await run_in_threadpool(store.mutate, gen_tests)

        if action == "map":
            def map_reqs(s: Studio):
                p = store.project_by_id(s, project_id)
                ensure_idle(p)
                if not p.discovery or not p.requirements:
                    raise Exception("Add requirements and discover the app before mapping.")

                resp = ai.generate_json(
                    'Map requirements to observed application pages only. Return {"mappings":[{"requirementId":"...","url":"...","confidence":0,"reason":"..."}]}. Confidence 0 to 100. Omit unobserved or unsupported mappings.',
                    {
                        "requirements": [r.model_dump() for r in p.requirements],
                        "pages": [d.model_dump() for d in p.discovery]
                    }
                )

                mappings = resp.get("mappings", [])
                for m in mappings:
                    req = next((r for r in p.requirements if r.id == m.get("requirementId")), None)
                    if req and any(d.url == m.get("url") for d in p.discovery):
                        from models import RequirementMapping
                        req.mapping = RequirementMapping(
                            url=str(m.get("url", "")),
                            confidence=max(0, min(100, float(m.get("confidence", 0)))),
                            reason=str(m.get("reason", ""))[:2000]
                        )
                store.add_activity(p, "Updated requirement-to-application mapping.")
                return {"ok": True}
            return await run_in_threadpool(store.mutate, map_reqs)

        # Other mutations
        def handle_mutation(s: Studio):
            p = store.project_by_id(s, project_id)
            if action not in ["updateIssue"]:
                ensure_idle(p)

            if action == "updateProject":
                if not str(body.get("name", "")).strip() or not str(body.get("owner", "")).strip():
                    raise ValueError("Project name and owner are required.")
                new_url = store.validate_url(body.get("url", ""))
                if new_url != p.url:
                    for t in p.tests:
                        t.version += 1
                        t.approved = False
                    p.discovery = []
                    for r in p.requirements:
                        r.mapping = None
                p.name = body.get("name", "")[:100]
                p.url = new_url
                p.owner = body.get("owner", "")[:100]
                p.description = body.get("description", "")[:3000]
                store.add_activity(p, "Project settings updated.")

            elif action == "saveRequirement":
                if not str(body.get("title", "")).strip() or not body.get("acceptanceCriteria") or not all(isinstance(c, str) and c.strip() for c in body["acceptanceCriteria"]):
                    raise ValueError("A requirement needs a title and verifiable acceptance criteria.")
                req_id = body.get("id")
                r = Requirement(
                    id=req_id or store.generate_id("FR"),
                    title=body.get("title", "")[:200],
                    description=body.get("description", body.get("title", "")),
                    acceptanceCriteria=body.get("acceptanceCriteria", [body.get("description", "")]),
                    source="Manual"
                )
                existing = next((req for req in p.requirements if req.id == req_id), None)
                if existing:
                    # Replace existing
                    idx = p.requirements.index(existing)
                    p.requirements[idx] = r
                    for t in p.tests:
                        if existing.id in t.requirementIds:
                            t.version += 1
                            t.approved = False
                else:
                    p.requirements.append(r)
                store.add_activity(p, "Requirement saved; linked tests require review.")

            elif action == "deleteRequirement":
                req_id = body.get("id")
                p.requirements = [r for r in p.requirements if r.id != req_id]
                for t in p.tests:
                    if req_id in t.requirementIds:
                        t.requirementIds.remove(req_id)
                        t.version += 1
                        t.approved = False
                store.add_activity(p, "Requirement removed.")

            elif action == "saveTest":
                t_id = body.get("id")
                req_ids = body.get("requirementIds", [])
                check_links(p, req_ids)

                t = TestCase(
                    id=t_id or store.generate_id("TC"),
                    **test_input(body, p),
                    version=1,
                    approved=False
                )
                existing = next((test for test in p.tests if test.id == t_id), None)
                if existing:
                    t.version = existing.version + 1
                    idx = p.tests.index(existing)
                    p.tests[idx] = t
                else:
                    p.tests.append(t)
                store.add_activity(p, "Saved draft test for approval.")

            elif action == "deleteTest":
                t_id = body.get("id")
                p.tests = [t for t in p.tests if t.id != t_id]
                store.add_activity(p, "Test removed; execution history retained.")

            elif action == "approveTests":
                test_ids = body.get("testIds", [])
                if not test_ids:
                    raise Exception("Select tests to approve.")
                if any(i not in {t.id for t in p.tests} for i in test_ids):
                    raise ValueError("Select existing tests to approve.")
                for t in p.tests:
                    if t.id in test_ids:
                        test_input(t.model_dump(exclude_none=True), p)
                        t.approved = (body.get("approved") is not False)
                store.add_activity(p, f"Approved/Revoked tests.")

            elif action == "createIssue":
                r_id = body.get("resultId")
                r = next((res for res in p.results if res.id == r_id), None)
                if not r or r.status == "Passed":
                    raise Exception("Choose a failed or warning result.")

                existing = next((i for i in p.issues if i.testId == r.testId and i.status not in ["Closed", "Verified"]), None)
                if existing:
                    if r.id not in existing.resultIds:
                        existing.resultIds.append(r.id)
                else:
                    p.issues.append(Issue(
                        id=store.generate_id("BUG"),
                        title=r.title,
                        testId=r.testId,
                        requirementIds=r.requirementIds,
                        resultIds=[r.id],
                        severity="High",
                        status="Open",
                        notes="",
                        createdAt=datetime.datetime.utcnow().isoformat() + "Z"
                    ))
                store.add_activity(p, "Linked failure evidence to issue.")

            elif action == "updateIssue":
                i_id = body.get("id")
                issue = next((i for i in p.issues if i.id == i_id), None)
                if not issue:
                    raise Exception("Issue not found.")
                new_status = body.get("status", issue.status)
                if new_status not in {"Open", "In Progress", "Fixed", "Re-testing", "Verified", "Closed"}:
                    raise ValueError("Invalid issue status.")
                if new_status in {"Closed", "Verified"} and not any(r.testId == issue.testId and r.status == "Passed" for r in latest_results(p)):
                    raise ValueError("Re-test successfully before verifying or closing an issue.")
                if new_status == "Re-testing":
                    raise ValueError("Start a test run to mark the issue as re-testing.")
                issue.status = body.get("status", issue.status)
                issue.notes = body.get("notes", "")[:10000]
                if body.get("severity") in ["Critical", "High", "Medium", "Low"]:
                    issue.severity = body.get("severity")
                store.add_activity(p, f"Issue updated.")

            elif action == "qaValidate":
                if not metrics(p)["ready"] or not str(body.get("name", "")).strip():
                    raise ValueError("Complete current tests and requirement coverage, resolve blocking issues and provide a reviewer name.")
                p.qaValidation = QAValidation(
                    name=body.get("name", "")[:100],
                    at=datetime.datetime.utcnow().isoformat() + "Z",
                    fingerprint=fingerprint(p)
                )
                store.add_activity(p, "QA validation recorded.")

            elif action == "signoff":
                if not metrics(p)["ready"] or not p.qaValidation or p.qaValidation.fingerprint != fingerprint(p) or not str(body.get("name", "")).strip():
                    raise ValueError("Current passing results and QA validation are required before developer sign-off.")
                p.signoffs.append(Signoff(
                    id=store.generate_id("REL"),
                    name=body.get("name", "")[:100],
                    note=body.get("note", "")[:3000],
                    at=datetime.datetime.utcnow().isoformat() + "Z",
                    fingerprint=fingerprint(p)
                ))
                store.add_activity(p, "Developer signed off this validated release.")

            else:
                raise Exception(f"Unknown action: {action}")

        store.mutate(handle_mutation)
        return {"ok": True}

    except Exception as e:
        return JSONResponse(status_code=400, content={"error": str(e)})

@app.get("/api/evidence/{filename}")
def get_evidence(filename: str, request: Request):
    check_local(request)
    import re
    if not re.match(r"^[a-zA-Z0-9-]+\.(png|zip|webm)$", filename):
        return JSONResponse(status_code=400, content={"error": "Invalid evidence name"})

    path = os.path.join(store.DATA_DIR, "evidence", filename)
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "Evidence not found"})

    ext = filename.split(".")[-1]
    media_type = "image/png" if ext == "png" else "video/webm" if ext == "webm" else "application/zip"

    with open(path, "rb") as f:
        content = f.read()

    headers = {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff"
    }
    if ext == "zip":
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'

    return Response(content=content, media_type=media_type, headers=headers)

@app.get("/api/preview/{id}")
def get_preview(id: str, request: Request):
    check_local(request)
    try:
        result = agent_client.agent_call("screenshot", {"projectId": id})
        if not result.get("image"):
            return Response(status_code=204)
        img_bytes = base64.b64decode(result["image"])
        return Response(content=img_bytes, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
    except Exception:
        return Response(status_code=503)

@app.get("/api/prd/extract")
@app.post("/api/prd/extract")
@app.get("/api/tests/results")
@app.post("/api/tests/results")
@app.get("/api/tests/run")
@app.post("/api/tests/run")
def legacy_endpoints():
    return JSONResponse(status_code=410, content={"error": "Use the project-scoped /api/studio endpoint."})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, timeout_keep_alive=120)
