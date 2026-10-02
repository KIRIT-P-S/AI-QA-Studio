const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../..');
const base = 'http://127.0.0.1:3000';
let fixed = false;
let projectId;
const fixture = http.createServer((req, res) => {
  if (req.url === '/__fix' && req.method === 'POST') { fixed = true; res.end('Fixed'); return; }
  if (req.url === '/api/approve') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: fixed ? 'Active' : 'Pending' })); return; }
  if (req.url === '/api/health') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ healthy: true })); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><title>Partner Portal · QA Fixture</title><style>body{font:16px system-ui;margin:60px;background:#f4f6fb;color:#28334b}main{max-width:700px;background:white;border:1px solid #ddd;border-radius:14px;padding:40px}button{padding:12px 24px;background:#6655d8;border:0;border-radius:5px;color:white}input{padding:10px;border:1px solid #ccc}a{display:block;margin:20px 0}#status{padding:14px;background:#eff5ef;margin:15px 0}</style></head><body><main><h1>Partner workspace</h1><p>Local application for AI QA Studio verification.</p><a href="/partners">Partners</a><label>Search partners <input id="search" type="search" value="wireless mouse" /></label><p id="hidden-state" hidden>Active</p><h2>Acme Corporation</h2><div id="status">Pending</div><button id="activate">Activate partner</button><button id="human">Approve partner</button><script>document.querySelector('#activate').onclick=async()=>{let data=await(await fetch('/api/approve')).json();document.querySelector('#status').textContent=data.status};document.querySelector('#human').onclick=()=>document.querySelector('#status').textContent='Active';</script></main></body></html>`);
});
async function api(action, values = {}, expectedStatus = 200) {
  const response = await fetch(base + '/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, projectId, ...values }) });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, `${action}: ${JSON.stringify(result)}`);
  return result;
}
async function project() { const data = await (await fetch(base + '/api/studio')).json(); return data.projects.find(p => p.id === projectId); }
async function until(fn, message, timeout = 45000) { const end = Date.now() + timeout; while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(r => setTimeout(r, 300)); } throw new Error(`Timed out: ${message}`); }
const checks = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
(async () => {
  await new Promise(r => fixture.listen(4173, '127.0.0.1', r));
  await fs.mkdir(path.join(root, 'verification-output'), { recursive: true });
  const response = await api('createProject', { name: 'Partner Portal · Verification', url: 'http://127.0.0.1:4173', owner: 'QA Engineer', environment: 'Local', description: 'Real browser verification fixture.' });
  projectId = response.projectId;
  await api('createProject', { name: 'Invalid URL', url: 'javascript:alert(1)', owner: 'QA' }, 400);
  pass('Project persistence and invalid URL rejection');
  await api('saveRequirement', { title: 'Partner activation', description: 'Activating a partner changes its status to Active.', acceptanceCriteria: ['Status changes from Pending to Active.'] });
  const requirementId = (await project()).requirements[0].id;
  await api('saveTest', { title: 'Partner becomes Active', expected: 'Partner status becomes Active.', requirementIds: [requirementId], steps: [{ action: 'navigate', target: '/' }, { action: 'click', target: '#activate' }, { action: 'assertText', target: '#status', expected: 'Active' }, { action: 'api', target: '/api/health', expected: '200', value: 'healthy' }] });
  let p = await project(); const testId = p.tests[0].id;
  await api('signoff', { name: 'Developer' }, 400);
  pass('Draft tests and blocked premature sign-off');
  const form = new FormData(); form.set('projectId', projectId); form.set('kind', 'requirements'); form.set('useAI', 'false'); form.set('file', new Blob(['Users can search for a partner by name.']), 'requirements.txt');
  let uploaded = await fetch(base + '/api/studio', { method: 'POST', body: form }); assert.equal(uploaded.status, 200, await uploaded.text());
  const manualRequirement = (await project()).requirements.find(r => r.id !== requirementId);
  await api('deleteRequirement', { id: manualRequirement.id });
  pass('Real text document import with manual review');
  await api('connect');
  await api('run', { testIds: [testId] }, 400);
  await api('resume');
  await api('run', { testIds: [testId] }, 400);
  pass('Manual login handoff and unapproved test execution blocked');
  await api('discover', { maxPages: 2, maxDepth: 1, timeLimit: 1 });
  await until(async () => (await api('status')).state === 'Connected', 'discovery');
  p = await project(); assert.ok(p.discovery.length > 0, JSON.stringify(await api('status'))); assert.ok(p.discovery[0].elements.some(e => e.selector === '#activate'));
  pass('Bounded application discovery with usable selectors');
  await api('approveTests', { testIds: [testId] });
  await api('run', { testIds: [testId] });
  await until(async () => { const state = await project(); return state.runs.at(-1)?.status === 'Completed'; }, 'first run');
  p = await project(); let result = p.results.at(-1); assert.equal(result.status, 'Failed'); assert.ok(result.screenshot); assert.ok(result.trace);
  assert.equal((await fetch(`${base}/api/evidence/${result.screenshot}`)).status, 200);
  assert.equal((await fetch(`${base}/api/evidence/${result.trace}`)).status, 200);
  pass('Real failing assertion with screenshot and trace evidence');
  await api('createIssue', { resultId: result.id }); await api('createIssue', { resultId: result.id });
  p = await project(); assert.equal(p.issues.length, 1); const issueId = p.issues[0].id;
  await api('updateIssue', { id: issueId, status: 'Closed', severity: 'High' }, 400);
  await api('updateIssue', { id: issueId, status: 'Fixed', severity: 'High', notes: 'Corrected activation state in fixture.' });
  await fetch('http://127.0.0.1:4173/__fix', { method: 'POST' });
  await api('run', { testIds: [testId] });
  await until(async () => (await project()).runs.at(-1)?.status === 'Completed', 're-test');
  p = await project(); result = p.results.at(-1); assert.equal(result.status, 'Passed', JSON.stringify(result.steps)); assert.equal(p.issues[0].status, 'Verified'); assert.ok(result.network.some(n => n.url.endsWith('/api/approve')));
  pass('Issue deduplication, genuine fix, passing re-test and auto-verification');
  await api('qaValidate', { name: 'QA Engineer' }); await api('signoff', { name: 'Developer', note: 'Reviewed real fixture evidence.' });
  assert.equal((await project()).signoffs.length, 1);
  pass('QA validation and developer release sign-off');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  await page.screenshot({ path: path.join(root, 'verification-output/overview.png'), fullPage: true });
  for (const view of ['preparation', 'workspace', 'results', 'issues', 'release', 'settings', 'reports']) {
    await page.goto(`${base}/projects/${projectId}/${view}`, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Overflow on ${view}`);
    await page.screenshot({ path: path.join(root, `verification-output/${view}.png`), fullPage: true });
  }
  await page.goto(`${base}/projects/${projectId}/preparation`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Add requirement', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Title', { exact: true }).fill('Requirement created through UI');
  await page.getByRole('dialog').getByLabel('Description', { exact: true }).fill('A requirement can be added through the interface.');
  await page.getByRole('dialog').getByLabel('Acceptance criteria (one per line)').fill('Saved requirement appears in the list.');
  await page.getByRole('button', { name: 'Save requirement', exact: true }).click();
  await page.getByText('Requirement created through UI', { exact: true }).waitFor();
  await page.goto(`${base}/projects/${projectId}/release`, { waitUntil: 'networkidle' });
  assert.ok(await page.getByText('Superseded', { exact: true }).count());
  pass('All seven screens and real UI edit invalidating release sign-off');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const view of ['preparation', 'workspace', 'results', 'release']) {
    await page.goto(`${base}/projects/${projectId}/${view}`, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Mobile overflow on ${view}`);
  }
  await page.screenshot({ path: path.join(root, 'verification-output/mobile.png'), fullPage: true });
  assert.deepEqual(errors, []);
  await browser.close();
  pass('Responsive 390px screens and no browser runtime errors');
  await api('saveTest', { title: 'Missing field never substitutes another search input', expected: 'Exact selector is required.', requirementIds: [], steps: [{ action: 'navigate', target: '/' }, { action: 'assertValue', target: '#missing-field', expected: 'wireless mouse' }] });
  const missingId = (await project()).tests.at(-1).id;
  await api('saveTest', { title: 'Hidden text never proves a visible outcome', expected: 'Status must be visible.', requirementIds: [], steps: [{ action: 'navigate', target: '/' }, { action: 'assertText', target: '#hidden-state', expected: 'Active' }] });
  const hiddenId = (await project()).tests.at(-1).id;
  await api('approveTests', { testIds: [missingId, hiddenId] }); await api('run', { testIds: [missingId, hiddenId] });
  await until(async () => (await project()).runs.at(-1)?.status === 'Completed', 'false-pass regressions');
  p = await project(); assert.ok(p.results.filter(r => r.runId === p.runs.at(-1).id).every(r => r.status === 'Failed'));
  pass('Missing selectors and hidden text cannot fabricate a passing assertion');
  // Verify stop while a human-gated step is paused. It must never yield a pass.
  await api('saveTest', { title: 'Human gate cancellation', expected: 'Human approval followed by assertion.', requirementIds: [], steps: [{ action: 'navigate', target: '/' }, { action: 'click', target: '#human', humanApproval: true }, { action: 'assertText', target: '#status', expected: 'Active' }] });
  const gateId = (await project()).tests.at(-1).id; await api('approveTests', { testIds: [gateId] }); await api('run', { testIds: [gateId] });
  await until(async () => (await api('status')).state === 'Paused', 'human gate');
  await api('cancel'); await until(async () => (await project()).runs.at(-1)?.status === 'Cancelled', 'cancellation');
  assert.equal((await project()).results.at(-1).status, 'Warning');
  pass('Human-gated action pauses, cancellation saves incomplete evidence without a false pass');
  await api('disconnect');
  p = await project(); assert.ok(p.results.some(r => r.video));
  pass('Video finalized and linked on disconnect');
  await fs.writeFile(path.join(root, 'verification-output/report.json'), JSON.stringify({ passed: checks.length, checks, projectId, at: new Date().toISOString() }, null, 2));
  console.log(`\n${checks.length} end-to-end checks passed. Project ${projectId}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { fixture.close(); setTimeout(() => process.exit(process.exitCode || 0), 500); });
