"""Package platform-neutral source with executable macOS first-run launchers."""
from pathlib import Path
import hashlib
import json
import shutil
import stat
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "deliverables"
PACKAGE = OUTPUT / "AI-QA-Studio-Mac"


def ignore(directory, names):
    omitted = {"node_modules", ".next", "data", "venv", "evidence", "tests", "__pycache__", ".git", ".desktop"}
    return [name for name in names if name in omitted or (name.endswith(".md") and name != "Shop_QA_Demo_PRD.md") or name.startswith(".env") or name.endswith((".tsbuildinfo", ".log", ".cmd", ".zip"))]


def main():
    if PACKAGE.exists():
        raise RuntimeError("The Mac release directory exists. Use a fresh staging directory to avoid distributing customer data.")
    PACKAGE.mkdir(parents=True)
    for name in ["web", "agent"]:
        shutil.copytree(ROOT / name, PACKAGE / name, ignore=ignore)
    (PACKAGE / "backend").mkdir()
    for source in (ROOT / "backend").glob("*.py"):
        shutil.copy2(source, PACKAGE / "backend" / source.name)
    shutil.copy2(ROOT / "backend/requirements.txt", PACKAGE / "backend/requirements.txt")
    (PACKAGE / "scripts").mkdir()
    for name in ["desktop.cjs", "desktop-platform.cjs", "demo-project.cjs", "setup-mac.sh", "verify-mac-install.cjs"]:
        source = ROOT / "scripts" / name
        (PACKAGE / "scripts" / name).write_text(source.read_text(encoding="utf8"), encoding="utf8", newline="\n")
    for source in (ROOT / "handoff/mac").iterdir():
        (PACKAGE / source.name).write_text(source.read_text(encoding="utf8"), encoding="utf8", newline="\n")
    shutil.copytree(ROOT / "examples/manual-test-pack", PACKAGE / "examples/manual-test-pack", ignore=ignore)
    for name in ["verify-demo.cjs", "build-cases.cjs"]:
        file = PACKAGE / "examples/manual-test-pack" / name
        if file.exists(): file.unlink()
    (PACKAGE / "web/.env.example").write_text("AI_PROVIDER=gemini\nGEMINI_MODEL=gemini-2.5-flash\nGEMINI_API_KEY=YOUR_OWN_KEY\n", encoding="utf8")
    manifest = {"application":"AI QA Studio", "version":"1.0.0", "delivery":"Mac source and first-run setup",
                "primaryTarget":"Apple Silicon", "minimumMacOS":14, "node":"24.21.0", "uv":"0.12.21", "python":"managed 3.12",
                "includesApiKey":False, "includesCustomerData":False, "nativeMacExecutionVerified":False}
    (PACKAGE / "release-manifest.json").write_text(json.dumps(manifest, indent=2))
    secret = None
    settings = ROOT / "web/.env.local"
    if settings.is_file():
        for line in settings.read_text(encoding="utf8").splitlines():
            if line.startswith("GEMINI_API_KEY="):
                secret = line.partition("=")[2].strip().strip("\"'").encode()
    for file in PACKAGE.rglob("*"):
        if not file.is_file(): continue
        if file.name in {".env.local", ".agent-token", "studio.json"} or file.suffix in {".exe", ".dll"}:
            raise RuntimeError("Private data or a Windows binary was found in the Mac release.")
        if secret and len(secret)>10 and secret in file.read_bytes():
            raise RuntimeError("The source API key was found in the release. Do not distribute.")
    archive = OUTPUT / "AI-QA-Studio-Mac.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as package_zip:
        for file in sorted(PACKAGE.rglob("*")):
            if not file.is_file(): continue
            name = (Path(PACKAGE.name) / file.relative_to(PACKAGE)).as_posix()
            info = zipfile.ZipInfo(name)
            info.create_system = 3
            executable = file.suffix in {".command", ".sh"}
            info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            package_zip.writestr(info, file.read_bytes())
    with archive.open("rb") as file:
        digest = hashlib.file_digest(file, "sha256").hexdigest()
    (OUTPUT / "AI-QA-Studio-Mac.sha256.txt").write_text(f"{digest}  {archive.name}\n")
    print(json.dumps({"zip":str(archive),"sizeMB":round(archive.stat().st_size/1024**2,1),"sha256":digest}))


if __name__ == "__main__":
    main()
