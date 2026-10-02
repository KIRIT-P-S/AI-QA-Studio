const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const root = path.resolve(__dirname, "..");
const web = path.join(root, "web");
const mode = process.argv[2] === "start" ? "start" : "dev";
const env = {
  ...process.env,
  ...(process.env.STUDIO_DATA_DIR
    ? { STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR }
    : {}),
};
const venvPython = path.join(
  root,
  "backend",
  "venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.STUDIO_PYTHON ||
  (fs.existsSync(venvPython) ? venvPython : "python");
const backend = spawn(python, [path.join(root, "backend/main.py")], {
  cwd: path.join(root, "backend"),
  stdio: "inherit",
  windowsHide: true,
  env,
});
let child;
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  child?.kill();
  backend.kill();
};
backend.on("error", (e) => {
  console.error(
    `Could not start Python API: ${e.message}. Install backend/requirements.txt in backend/venv.`,
  );
  stop();
  process.exitCode = 1;
});
backend.on("exit", (code) => {
  if (!stopping) {
    console.error("Python API stopped.");
    stop();
    process.exitCode = code || 1;
  }
});
async function startWeb() {
  for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:8000/api/studio", {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        child = spawn(
          process.execPath,
          [
            path.join(web, "node_modules/next/dist/bin/next"),
            mode,
            "--hostname",
            "127.0.0.1",
            "--port",
            process.env.PORT || "3000",
          ],
          { cwd: web, stdio: "inherit", windowsHide: true, env },
        );
        child.on("error", (e) => {
          console.error(e.message);
          stop();
          process.exitCode = 1;
        });
        child.on("exit", (code) => {
          stop();
          process.exitCode = code || 0;
        });
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!stopping) {
    console.error("Python API did not become ready. Check the error above.");
    stop();
    process.exitCode = 1;
  }
}
void startWeb();
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
