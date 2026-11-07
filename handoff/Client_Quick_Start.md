# AI QA Studio - Client Quick Start

This package is for one user on one Windows 10/11 x64 computer. Node, Python, application dependencies and the testing browser are included. No developer tools, command typing, administrator installation or dependency downloads are needed for normal startup.

## First use

1. Right-click AI-QA-Studio-Windows-x64.zip and choose **Extract All**. Use a short, writable local folder, for example C:\AIQA. Run files from the extracted folder, not from inside the ZIP. Do not place the app inside Program Files or a synchronized folder.
2. For AI extraction/generation, double-click **Configure AI.cmd**. A local browser form opens. Enter your own Gemini API key and save. The key stays in this app's local settings file. Get a key from https://aistudio.google.com/api-keys. Your provider account needs available quota and internet access. The package does not contain the developer's key.
3. Double-click **Start AI QA Studio.cmd**. Wait for Ready. Your browser opens http://127.0.0.1:3000/. Keep the launcher window open.
4. Create a project, upload its PRD and/or tests, connect the website, review the tests and approve them before running. Complete website login/MFA manually in the controlled browser. Review results and evidence before recording QA validation or developer sign-off.
5. Double-click **Stop AI QA Studio.cmd** when finished. It stops the app's services and demo, finalizes connected browser evidence where possible, and preserves your projects.

Subsequent use: just double-click Start. AI settings are retained. Stop and restart after changing AI settings. Imported executable tests and the supplied demo do not require an AI key; AI generation does.

## One-click demo preparation

1. Double-click **Start Client Demo.cmd**. This starts both AI QA Studio and the local shop website.
2. Double-click **Load Demo Project.cmd**. It creates a fresh project with six requirements and eight correctly linked **draft** tests from the supplied pack. It does not use AI, approve tests, record results or sign off releases.
3. Review the drafts, connect the app, give AI control, select all eight tests, approve and run them. Fresh demo startup enables the intentional cart bug: expect **7 passed, 1 failed**.
4. Create an issue from TC07. At http://127.0.0.1:4180/control choose Fixed and apply it, mark the issue Fixed, then re-run TC07. Expect eight current passes and 100% requirement coverage for this plan.
5. Review evidence, confirm QA validation and developer sign-off yourself, disconnect to finalize the video, then export a report. See Presenter_Demo_Guide.md for the presentation sequence.

The detailed PRD, executable CSV, natural-language CSV and manual test guide are in examples\manual-test-pack. For your own application, use its real URL and PRD. The seeded demo is a supplied plan, not AI-generated output.

## Keep your work

- Projects and evidence: **web\data\studio**. Stop the app, then back up this entire folder.
- AI settings: **web\.env.local**. Keep this private; it contains your key.
- Startup logs: **.desktop\logs**. These help diagnose startup failures.
- Before replacing/updating the app folder, stop it and preserve the data folder and settings. Restore them only into your own installation. The original delivery ZIP is clean and contains no customer projects or test evidence.

## If something does not start

| Symptom | What to do |
| --- | --- |
| Missing files | Extract the full ZIP again. Do not run launchers inside the archive. |
| Port already in use | Run Stop from this same app folder. Close an older AI QA Studio terminal if it was started using npm. Leave unrelated applications alone. Required local ports are 3000, 8000, 4318 and 4319; the demo also uses 4180. |
| Browser did not open | Open http://127.0.0.1:3000/ manually after the launcher says Ready. |
| AI generation fails | Check the key, model, internet connection and quota. The provider may reject or rate-limit requests. Executable imported tests remain available. |
| Confirm QA validation is disabled | Link tests to requirements, run their current versions, reach full requirement coverage, and resolve critical/high issues. Notes alone do not enable approval. |
| Security software blocks a runtime | Ask your IT administrator to review the package. Do not disable organizational security protections. |

This delivery is a local, single-user application. A shared cloud service or simultaneous multi-user deployment requires authentication, isolated workspaces and a separate deployment design. Passing a test plan confirms its reviewed assertions, not every possible behavior of an arbitrary website. AI output still needs review.

Runtime references: https://nodejs.org/download/release/v24.21.0/ and https://www.python.org/downloads/release/python-31210/. Third-party licenses are retained in the bundled runtimes and dependency folders. This is a tested demonstration handoff; assess runtime updates and your organization’s deployment requirements before wider rollout.
