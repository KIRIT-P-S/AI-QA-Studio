# AI QA Studio - Mac quick start

For Apple Silicon Macs (M1, M2, M3, M4 and newer), using macOS 14 Sonoma or later. The setup also detects Intel Macs. This delivery is a source-and-setup package, not a prebuilt or notarized Mac application.

## Send this package

Send **AI-QA-Studio-Mac.zip** using Google Drive, Dropbox, USB or another file-sharing method. Send the original clean ZIP. Do not send the Windows package or zip your working folder, which contains your private AI settings and project evidence.

## Client first-time setup

1. Double-click the ZIP to extract it. Move the extracted AI-QA-Studio-Mac folder into a writable local folder, for example Documents/AIQA. Choose its final location before setup. Avoid iCloud-synchronized folders.
2. Double-click **Setup Mac.command**. A Terminal window opens and automatically detects the processor, downloads checksum-verified Node and uv, prepares app-local Python 3.12, installs the dependencies and testing browser, and builds the frontend on the Mac. No Homebrew, sudo or administrator installation is needed. Internet access is required. The first setup can take several minutes depending on downloads; keep the window open until Setup complete.
3. Double-click **Configure AI.command**. Enter your own Gemini API key in the local browser settings form and save. Get a key at https://aistudio.google.com/api-keys. AI generation needs internet and available provider quota. Supplied executable tests and the local demo can run without an AI key.
4. Double-click **Start AI QA Studio.command**. The application opens at http://127.0.0.1:3000/. Keep its Terminal window open.
5. When finished, double-click **Stop AI QA Studio.command**. This stops the launcher-owned services and preserves your projects. Subsequent use requires only Start and Stop.

### If macOS says a launcher was "Not Opened"

The supplied `.command` launchers are unsigned and not notarized. For the original package you received and reviewed:

1. Dismiss the blocked-launcher dialog with **Done**.
2. Open **System Settings > Privacy & Security**. Find the blocked launcher's name and select **Open Anyway**.
3. Confirm **Open** when macOS asks. Authenticate if prompted.

Approve each launcher separately if requested. Complete **Setup Mac.command** before **Configure AI.command** and **Start AI QA Studio.command**. If company policy prevents approval, contact the Mac's administrator. Keep Gatekeeper enabled. This approval does not sign or notarize the package.

[Apple's explanation and opening instructions](https://support.apple.com/en-us/102445).

## Demonstration

1. Double-click **Start Client Demo.command** to start the studio and the local shop website.
2. Double-click **Load Demo Project.command**. It prepares six requirements and eight linked draft tests from the supplied test pack. It does not generate them with AI, approve them, run them or sign off a release.
3. Review the tests, connect the website, give AI control, approve all eight and run them. A fresh demo startup enables the cart bug: expect seven passes and one TC07 failure.
4. Inspect TC07 evidence and create an issue. Open http://127.0.0.1:4180/control, choose Fixed and apply it. Mark the issue Fixed and re-run TC07 with the same expected values.
5. Expect TC07 to pass, its issue to become Verified, all eight current tests to pass, and requirement coverage to reach 100% for this plan. Review the evidence before confirming QA validation and developer sign-off. Disconnect to finalize the video.

For AI-generated tests, use a separate project: upload Shop_QA_Demo_PRD.md with AI extraction, connect/discover the website, generate, review and approve the proposed cases. The number of generated tests can vary. Detailed PRD, CSV files and manual guide are in examples/manual-test-pack. Where the older manual guide mentions Windows .cmd launchers, use these Mac .command launchers instead.

## Data, diagnostics and setup verification

- Projects, results and evidence: **web/data/studio**. Stop the app before backing up this entire folder.
- AI settings: **web/.env.local**. Keep this private.
- Startup logs: **.desktop/logs**.
- Native installation check: **.setup/ready.json**. Setup writes this only after Python imports, the production build and an actual headless browser assertion/screenshot succeed on the Mac.
- A failed setup leaves your data and settings intact. Check the displayed error and network access, then re-run Setup Mac.command. Stop the app before re-running setup. If you move its installed folder, run Setup again to repair the Python environment.
- If a port is busy, stop an earlier studio instance using Stop from its own folder. Do not kill unrelated applications. Ports are 3000, 8000, 4318, 4319 and, for the demo, 4180.
- If QA validation is disabled, check requirement links, current passing test versions, full requirement coverage and unresolved critical/high issues. Release notes alone do not enable approval.

This package supports a local single-user workspace. A shared hosted application needs separate authentication and isolated workspaces. Passing reviewed assertions does not prove every possible behavior of a website.

## Verification boundary

The application and Windows workflow have been tested. The Mac-specific launch logic, shell syntax and archive permissions were checked on the Windows development machine. The complete application has **not yet been executed on a physical Mac**. Before relying on it for the client presentation, run setup and the supplied demo on the client's Mac, and retain its native installation report. This package is not an Apple-signed/notarized .app or .dmg.

Official references: Playwright macOS requirements at https://playwright.dev/docs/intro#system-requirements; app-local managed Python at https://docs.astral.sh/uv/guides/install-python/; Node archives at https://nodejs.org/dist/v24.21.0/; uv release at https://github.com/astral-sh/uv/releases/tag/0.12.21.
