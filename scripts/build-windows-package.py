"""Build a clean Windows x64 portable release. Never copy workspace data or keys."""
from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import sys
import zipfile
import requests

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "deliverables"
PACKAGE = OUTPUT / "AI-QA-Studio-Windows-x64"
CACHE = OUTPUT / "build-cache"


def download(url, name, expected, algorithm="sha256"):
    CACHE.mkdir(parents=True, exist_ok=True)
    target = CACHE / name
    if not target.exists():
        print("Downloading", name, flush=True)
        with requests.get(url, stream=True, timeout=90) as response:
            response.raise_for_status()
            with target.open("wb") as file:
                for chunk in response.iter_content(1024 * 1024):
                    file.write(chunk)
    actual = hashlib.new(algorithm, target.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f"Checksum mismatch for {name}; do not distribute this file.")
    return target


def excluded(directory, names):
    return [name for name in names if name.startswith(".env") or name in {
        "__pycache__", ".git", "data", "evidence", "tests", ".agent-token", ".desktop", "cache"}]


def copy(source, destination):
    if source.is_dir():
        shutil.copytree(source, destination, dirs_exist_ok=True, ignore=excluded)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)


def prepare():
    PACKAGE.mkdir(parents=True, exist_ok=True)
    marker = PACKAGE / "release-manifest.json"
    if marker.exists():
        raise RuntimeError("This release directory already exists. Build into a fresh directory to prevent accidental inclusion of configuration or user data.")
    print("Assembling clean frontend, API, agent and demo", flush=True)
    copy(ROOT / "web/.next/standalone", PACKAGE / "web")
    copy(ROOT / "web/.next/static", PACKAGE / "web/.next/static")
    copy(ROOT / "web/public", PACKAGE / "web/public")
    # The browser worker imports the shared domain/storage modules directly.
    copy(ROOT / "web/lib", PACKAGE / "web/lib")
    copy(ROOT / "agent/src", PACKAGE / "agent/src")
    copy(ROOT / "agent/node_modules", PACKAGE / "agent/node_modules")
    copy(ROOT / "agent/package.json", PACKAGE / "agent/package.json")
    copy(ROOT / "agent/package-lock.json", PACKAGE / "agent/package-lock.json")
    for source in (ROOT / "backend").glob("*.py"):
        copy(source, PACKAGE / "backend" / source.name)
    copy(ROOT / "backend/requirements.txt", PACKAGE / "backend/requirements.txt")
    copy(ROOT / "scripts/desktop.cjs", PACKAGE / "scripts/desktop.cjs")
    copy(ROOT / "scripts/desktop-platform.cjs", PACKAGE / "scripts/desktop-platform.cjs")
    copy(ROOT / "scripts/demo-project.cjs", PACKAGE / "scripts/demo-project.cjs")
    for name in ["Start AI QA Studio.cmd", "Start Client Demo.cmd", "Stop AI QA Studio.cmd", "Configure AI.cmd", "Load Demo Project.cmd"]:
        copy(ROOT / name, PACKAGE / name)
    for name in ["START HERE.html", "Client_Quick_Start.md", "Presenter_Demo_Guide.md"]:
        copy(ROOT / "handoff" / name, PACKAGE / name)
    for source in (ROOT / "examples/manual-test-pack").iterdir():
        if source.suffix != ".zip" and source.name not in {"verify-demo.cjs", "build-cases.cjs"}:
            copy(source, PACKAGE / "examples/manual-test-pack" / source.name)

    node_name = "node-v24.21.0-win-x64.zip"
    node_zip = download(f"https://nodejs.org/dist/v24.21.0/{node_name}", node_name,
                        "158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541")
    node_dir = PACKAGE / "runtime/node"
    node_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(node_zip) as archive:
        for name in ["node.exe", "LICENSE", "README.md"]:
            (node_dir / name).write_bytes(archive.read(f"node-v24.21.0-win-x64/{name}"))
    python_zip = download("https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip",
                          "python-3.12.10-embed-amd64.zip", "fe8ef205f2e9c3ba44d0cf9954e1abd3", "md5")
    python_dir = PACKAGE / "runtime/python"
    with zipfile.ZipFile(python_zip) as archive:
        archive.extractall(python_dir)
    (python_dir / "python312._pth").write_text("python312.zip\n.\nLib/site-packages\n../../backend\nimport site\n", encoding="ascii")
    print("Installing the pinned Python dependencies into the package only", flush=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "--no-compile",
                    "--only-binary=:all:", "--no-binary=docx2txt", "--target", str(python_dir / "Lib/site-packages"),
                    "-r", str(ROOT / "backend/requirements.txt")], check=True)
    # Include the exact browser revision used by this installed Playwright.
    browsers = json.loads((ROOT / "agent/node_modules/playwright-core/browsers.json").read_text())
    browser_root = Path(os.environ["LOCALAPPDATA"]) / "ms-playwright"
    for name in ["chromium", "chromium-headless-shell", "ffmpeg", "winldd"]:
        entry = next(item for item in browsers["browsers"] if item["name"] == name)
        directory = f"{name.replace('-', '_')}-{entry['revision']}"
        if name == "chromium": directory = f"chromium-{entry['revision']}"
        copy(browser_root / directory, PACKAGE / "runtime/browsers" / directory)
    (PACKAGE / "web/.env.example").write_text("AI_PROVIDER=gemini\nGEMINI_MODEL=gemini-2.5-flash\nGEMINI_API_KEY=YOUR_OWN_KEY\n", encoding="utf8")
    # Secret and data checks before any archive is created. Never print key contents.
    secret = None
    settings = ROOT / "web/.env.local"
    if settings.is_file():
        for line in settings.read_text(encoding="utf8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                secret = line.partition("=")[2].strip().strip("\"'").encode()
    for file in PACKAGE.rglob("*"):
        if not file.is_file(): continue
        if file.name in {"studio.json", ".env.local", ".agent-token"}:
            raise RuntimeError(f"Private workspace file found in package: {file.name}")
        if secret and len(secret) > 10 and file.suffix in {".json", ".js", ".cjs", ".ts", ".py", ".html", ".txt", ".md"} and secret in file.read_bytes():
            raise RuntimeError("The workspace API key was found in the package. Do not distribute.")
    marker.write_text(json.dumps({"application": "AI QA Studio", "version": "1.0.0", "platform": "Windows x64",
                      "node": "24.21.0", "python": "3.12.10", "cleanWorkspace": True,
                      "includesApiKey": False, "includesCustomerEvidence": False,
                      "browserRevision": next(b["revision"] for b in browsers["browsers"] if b["name"] == "chromium")}, indent=2))
    print("Package assembled:", PACKAGE, flush=True)


def archive():
    # Verification runs must use an external STUDIO_DATA_DIR, not the package.
    for forbidden in [PACKAGE / "web/.env.local", PACKAGE / "web/data/studio/studio.json", PACKAGE / ".desktop"]:
        if forbidden.exists(): raise RuntimeError(f"Remove verification/configuration artifacts from the release before archiving: {forbidden}")
    target = OUTPUT / "AI-QA-Studio-Windows-x64.zip"
    print("Creating ZIP", flush=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package_zip:
        for file in sorted(PACKAGE.rglob("*")):
            if file.is_file(): package_zip.write(file, Path(PACKAGE.name) / file.relative_to(PACKAGE))
    digest = hashlib.sha256(target.read_bytes()).hexdigest()
    (OUTPUT / "AI-QA-Studio-Windows-x64.sha256.txt").write_text(f"{digest}  {target.name}\n")
    print(json.dumps({"zip": str(target), "sizeMB": round(target.stat().st_size / 1024**2, 1), "sha256": digest}), flush=True)


if __name__ == "__main__":
    if "--archive" in sys.argv: archive()
    else: prepare()
