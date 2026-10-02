/* Local desktop supervisor. Owns only the services started by this launcher. */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { platformSettings, browserCommand } = require('./desktop-platform.cjs');
const root = path.resolve(__dirname, '..');
const platform = platformSettings(root);
const launcherName = name => `${name}.${platform.extension}`;
const work = process.env.STUDIO_DESKTOP_DIR || path.join(root, '.desktop');
const sessionFile = path.join(work, 'session.json');
const controlUrl = 'http://127.0.0.1:4319';
const appUrl = 'http://127.0.0.1:3000/';
const noOpen = process.argv.includes('--no-open') || process.env.STUDIO_NO_OPEN === 'true';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function openBrowser(url) {
  if (noOpen) return;
  const [executable, args] = browserCommand(url);
  const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' });
  child.on('error', () => console.log(`Open ${url} in your browser.`));
}
function configEnv() {
  const env = { ...process.env };
  const file = path.join(root, 'web', '.env.local');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (match) env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  env.PATH = `${path.dirname(process.execPath)}${platform.delimiter}${env.PATH || env.Path || ''}`;
  env.STUDIO_DATA_DIR = process.env.STUDIO_DATA_DIR || path.join(root, 'web', 'data', 'studio');
  env.HOSTNAME = '127.0.0.1';
  env.PORT = '3000';
  if (fs.existsSync(path.join(root, 'runtime', 'browsers'))) env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, 'runtime', 'browsers');
  return env;
}
async function freePort(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the other application, then try again. No unrelated processes were stopped.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}
async function existingSession() {
  try {
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    if (state.root !== root) return;
    const response = await fetch(`${controlUrl}/health`, { headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1500) });
    const status = await response.json();
    if (response.ok && status.root === root) return state;
  } catch {}
}
async function requestControl(state, action) {
  const response = await fetch(`${controlUrl}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The launcher could not complete the request.');
  return result;
}
async function waitReady(url, init = {}, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch {}
    await sleep(300);
  }
  throw new Error(`A service did not start: ${url}. Open .desktop/logs for details.`);
}
async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('exit', resolve); killer.once('error', resolve);
    });
  } else {
    // A separate process group keeps shutdown limited to this launcher's children.
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    const deadline = Date.now() + 5000;
    while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) await sleep(100);
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  }
}
async function start() {
  const current = await existingSession();
  if (current) {
    if (process.argv.includes('--demo')) await requestControl(current, 'demo');
    console.log('AI QA Studio is already running.'); openBrowser(appUrl); return;
  }
  const env = configEnv();
  const portable = platform.portablePython;
  const python = fs.existsSync(portable) ? portable : (env.STUDIO_PYTHON || platform.venvPython);
  const web = path.join(root, 'web');
  const standalone = path.join(web, 'server.js');
  const webArgs = fs.existsSync(standalone) ? [standalone] : [path.join(web, 'node_modules', 'next', 'dist', 'bin', 'next'), 'start', '--hostname', '127.0.0.1', '--port', '3000'];
  for (const file of [python, webArgs[0], path.join(root, 'agent', 'node_modules', 'tsx', 'dist', 'cli.mjs')]) {
    if (!fs.existsSync(file)) throw new Error(`Required application file is missing: ${file}. Extract the entire ZIP before starting; do not run inside the ZIP.`);
  }
  if (!fs.existsSync(path.join(web, '.next', 'BUILD_ID'))) throw new Error('The production build is missing. In the source project, run npm run build first.');
  for (const port of [4319, 3000, 8000, 4318]) await freePort(port);
  fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
  const state = { root, token: crypto.randomBytes(32).toString('hex'), pid: process.pid };
  const children = [];
  let stopping = false, ready = false, demo;
  function launch(label, executable, args, cwd) {
    const log = fs.openSync(path.join(work, 'logs', `${label}.log`), 'a');
    const child = spawn(executable, args, { cwd, env, detached: platform.detached, windowsHide: true, stdio: ['ignore', log, log] });
    fs.closeSync(log); children.push(child);
    child.once('error', error => { console.error(`${label}: ${error.message}`); void shutdown(1); });
    child.once('exit', code => { if (!stopping) { console.error(`${label} stopped unexpectedly (${code}). See .desktop/logs.`); void shutdown(1); } });
    return child;
  }
  async function startDemo() {
    if (demo) return;
    await freePort(4180);
    demo = launch('demo', process.execPath, [path.join(root, 'examples', 'manual-test-pack', 'website', 'server.cjs')], root);
    await waitReady('http://127.0.0.1:4180/api/health');
    console.log('Demo website: http://127.0.0.1:4180/ (cart bug enabled on fresh start)');
  }
  async function finalizeBrowsers() {
    const file = path.join(env.STUDIO_DATA_DIR, 'studio.json');
    const tokenFile = path.join(env.STUDIO_DATA_DIR, '.agent-token');
    if (!fs.existsSync(file) || !fs.existsSync(tokenFile)) return;
    const projects = JSON.parse(fs.readFileSync(file, 'utf8')).projects;
    const token = fs.readFileSync(tokenFile, 'utf8').trim();
    async function agent(command, id) {
      const response = await fetch(`http://127.0.0.1:4318/${command}`, { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ projectId: id }), signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('Browser not available');
      return response.json();
    }
    for (const project of projects) {
      try {
        let status = await agent('status', project.id);
        if (!status.connected) continue;
        if (['Running', 'Paused', 'Discovering'].includes(status.state)) {
          await agent('cancel', project.id);
          const deadline = Date.now() + 45000;
          do { await sleep(300); status = await agent('status', project.id); }
          while (['Running', 'Paused', 'Discovering'].includes(status.state) && Date.now() < deadline);
        }
        await agent('disconnect', project.id);
      } catch { console.log(`Browser ${project.id}: already closed or could not finalize. Check its results after restarting.`); }
    }
  }
  async function shutdown(code = 0) {
    if (stopping) return;
    stopping = true; ready = false;
    console.log('Stopping AI QA Studio and finalizing browser evidence...');
    await finalizeBrowsers().catch(() => {});
    for (const child of [...children].reverse()) await stopChild(child);
    try { if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).token === state.token) fs.unlinkSync(sessionFile); } catch {}
    server.close();
    console.log('Stopped. Saved projects and evidence are preserved.');
    process.exitCode = code;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.headers.authorization !== `Bearer ${state.token}` || req.headers.origin || req.headers.host !== '127.0.0.1:4319') {
      res.writeHead(403); res.end(JSON.stringify({ error: 'Unauthorized local launcher request.' })); return;
    }
    if (req.url === '/health' && req.method === 'GET') { res.end(JSON.stringify({ root, ready })); return; }
    try {
      if (req.method !== 'POST') throw new Error('Use POST.');
      if (req.url === '/stop') { await shutdown(); res.end(JSON.stringify({ ok: true })); }
      else if (req.url === '/demo' && ready) { await startDemo(); res.end(JSON.stringify({ ok: true })); }
      else throw new Error('Application is starting or stopping. Retry shortly.');
    } catch (error) { res.writeHead(400); res.end(JSON.stringify({ error: error.message })); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4319, '127.0.0.1', resolve); });
  fs.writeFileSync(sessionFile, JSON.stringify(state), { mode: 0o600 });
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
  if (process.platform !== 'win32') process.once('SIGHUP', () => { void shutdown(); });
  try {
    console.log('Starting AI QA Studio. Please keep this window open.');
    launch('backend', python, [path.join(root, 'backend', 'main.py')], path.join(root, 'backend'));
    await waitReady('http://127.0.0.1:8000/api/studio');
    const agentDir = path.join(root, 'agent');
    const tokenFile = path.join(env.STUDIO_DATA_DIR, '.agent-token');
    if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    launch('agent', process.execPath, [path.join(agentDir, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(agentDir, 'src', 'server.ts')], agentDir);
    const agentToken = fs.readFileSync(tokenFile, 'utf8').trim();
    await waitReady('http://127.0.0.1:4318/health', { headers: { Authorization: `Bearer ${agentToken}` } });
    launch('web', process.execPath, webArgs, web);
    await waitReady(appUrl);
    if (process.argv.includes('--demo')) await startDemo();
    ready = true;
    console.log(`Ready: ${appUrl}`);
    if (!env.GEMINI_API_KEY && env.AI_PROVIDER !== 'ollama') console.log(`For AI generation, stop the app, run ${launcherName('Configure AI')}, then start again. Imported executable tests work without an AI key.`);
    console.log(`To stop: double-click ${launcherName('Stop AI QA Studio')}, or press Ctrl+C here.`);
    openBrowser(appUrl);
  } catch (error) { console.error(error.message); await shutdown(1); }
}

async function configure() {
  if (await existingSession()) throw new Error(`Stop AI QA Studio before changing its AI settings, then double-click ${launcherName('Configure AI')} again.`);
  await freePort(4319);
  const nonce = crypto.randomBytes(32).toString('hex');
  const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const model = configEnv().GEMINI_MODEL || 'gemini-2.5-flash';
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (req.headers.host !== '127.0.0.1:4319' || (req.headers.origin && req.headers.origin !== controlUrl)) { res.writeHead(403); res.end('Local settings only.'); return; }
    if (req.url === '/configure' && req.method === 'GET') {
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>AI QA Studio settings</title><style>body{font:16px/1.6 Segoe UI,sans-serif;background:#f7f8fc;color:#202b43;padding:35px}main{max-width:620px;margin:auto;background:white;padding:32px;border-radius:12px}input{display:block;width:95%;font:inherit;padding:10px;margin:8px 0 20px;border:1px solid #ddd;border-radius:6px}button{background:#6c58d8;color:white;border:0;padding:13px 20px;border-radius:6px;font:inherit}a{color:#6c58d8}small{color:#737b8d}</style></head><body><main><h1>Connect your AI provider</h1><p>Enter your own Gemini API key once. It is saved locally in this application folder.</p><form method="post" action="/save"><input type="hidden" name="nonce" value="${nonce}"><label>Gemini API key<input name="key" type="password" required autocomplete="off" maxlength="200"></label><label>Model<input name="model" value="${escape(model)}" required maxlength="100"></label><button>Save settings</button></form><form method="post" action="/cancel" style="margin-top:12px"><input type="hidden" name="nonce" value="${nonce}"><button>Continue without changing AI settings</button></form><p><a href="https://aistudio.google.com/api-keys" target="_blank" rel="noreferrer">Create a Gemini API key</a></p><small>AI generation sends supplied requirements and observed page content to Gemini. Internet access and provider quota are required. No key is included with this package.</small></main></body></html>`); return;
    }
    if (['/save','/cancel'].includes(req.url) && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 4000) { res.writeHead(413); res.end('Request too large.'); return; } }
      const values = new URLSearchParams(raw);
      if (values.get('nonce') !== nonce) { res.writeHead(400); res.end('Invalid settings request.'); return; }
      if (req.url === '/cancel') { res.end(`<h1>No settings changed</h1><p>Close this page and double-click ${launcherName('Start AI QA Studio')}. Supplied tests work without an AI key.</p>`); server.close(); return; }
      const key = (values.get('key') || '').trim(), selected = (values.get('model') || '').trim();
      if (values.get('nonce') !== nonce || !/^[A-Za-z0-9_-]{20,200}$/.test(key) || !/^[A-Za-z0-9._/-]{1,100}$/.test(selected)) { res.writeHead(400); res.end('Invalid settings. Go back and check the key and model.'); return; }
      const file = path.join(root, 'web', '.env.local');
      let lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/) : [];
      lines = lines.filter(line => !/^\s*(AI_PROVIDER|GEMINI_API_KEY|GEMINI_MODEL)\s*=/.test(line));
      lines.push('AI_PROVIDER=gemini', `GEMINI_MODEL=${selected}`, `GEMINI_API_KEY=${key}`);
      fs.writeFileSync(file, lines.filter(Boolean).join('\n') + '\n', { mode: 0o600 });
      res.end(`<!doctype html><html><head><title>Settings saved</title></head><body style="font:18px Segoe UI;padding:40px"><h1>Settings saved</h1><p>Close this page. Double-click ${launcherName('Start AI QA Studio')} or ${launcherName('Start Client Demo')}.</p></body></html>`);
      console.log('AI settings saved locally. Start the application now.');
      server.close(); return;
    }
    res.writeHead(404); res.end('Not found.');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(4319, '127.0.0.1', resolve); });
  console.log(`Open ${controlUrl}/configure to enter your AI key. No key is logged.`);
  openBrowser(`${controlUrl}/configure`);
  process.once('SIGINT', () => server.close());
}

async function main() {
  const action = process.argv[2] || 'start';
  if (action === 'stop') {
    const state = await existingSession();
    if (!state) { console.log('AI QA Studio is already stopped.'); return; }
    await requestControl(state, 'stop'); console.log('AI QA Studio stopped.');
  } else if (action === 'configure') await configure();
  else if (action === 'start') await start();
  else throw new Error('Use start, stop, or configure.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
