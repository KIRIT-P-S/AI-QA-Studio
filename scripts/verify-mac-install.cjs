const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function main() {
  if (process.platform !== 'darwin') throw new Error('Run this native installation check on the client Mac.');
  const version = spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' });
  if (version.status !== 0 || parseInt(version.stdout, 10) < 14) throw new Error('macOS 14 or later is required.');
  const python = path.join(root, 'backend/venv/bin/python');
  const checked = spawnSync(python, ['-c', 'import sys,fastapi,uvicorn,pydantic,pandas,numpy,docx2txt,openpyxl,pypdf; from google import genai; assert sys.version_info[:2] == (3,12); print(sys.version.split()[0])'], { encoding: 'utf8' });
  if (checked.status !== 0) throw new Error(`Python dependency check failed: ${checked.stderr}`);
  if (!fs.existsSync(path.join(root, 'web/.next/BUILD_ID'))) throw new Error('The production build is missing.');
  process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'runtime/browsers');
  const { chromium } = require(path.join(root, 'agent/node_modules/playwright'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1 id="check">AI QA Studio browser check</h1>');
    if (await page.locator('#check').innerText() !== 'AI QA Studio browser check') throw new Error('Browser assertion failed.');
    await page.screenshot();
  } finally { await browser.close(); }
  const report = { platform: process.platform, arch: process.arch, macOS: version.stdout.trim(), node: process.version,
    python: checked.stdout.trim(), productionBuild: true, browserLaunchAndAssertion: true, verifiedAt: new Date().toISOString() };
  fs.mkdirSync(path.join(root, '.setup'), { recursive: true });
  fs.writeFileSync(path.join(root, '.setup/ready.json'), JSON.stringify(report, null, 2));
  console.log('Native Python dependencies, production build and browser checks passed.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
