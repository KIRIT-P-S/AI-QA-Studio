const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const base = 'http://127.0.0.1:3000/api/studio';
let projectId;
let fixed = false;
const checks = [];
const fixture = http.createServer((req, res) => {
  if (req.url === '/fix' && req.method === 'POST') { fixed = true; res.end('Fixed'); return; }
  if (req.url === '/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ status: fixed ? 'Active' : 'Pending' })); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end(`<!doctype html><html><head><title>QA Workflow Fixture</title></head><body><h1>Partner workspace</h1><label>Search query<input id="search" name="q"></label><p id="status">Pending</p><button type="button" id="activate">Activate partner</button><script>document.querySelector('#activate').onclick=async()=>document.querySelector('#status').textContent=(await(await fetch('/status')).json()).status;</script></body></html>`);
});
async function call(action, fields = {}, expected = 200) {
  const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, projectId, ...fields }) });
  const data = await response.json(); assert.equal(response.status, expected, `${action}: ${JSON.stringify(data)}`); return data;
}
async function project() { const data = await (await fetch(base)).json(); return data.projects.find(p => p.id === projectId); }
async function upload(name, contents, kind, useAI = false, expected = 200) {
  const form = new FormData(); form.set('projectId', projectId); form.set('kind', kind); form.set('useAI', String(useAI)); form.set('file', new Blob([contents]), name);
  const response = await fetch(base, { method: 'POST', body: form }); const data = await response.json(); assert.equal(response.status, expected, JSON.stringify(data));
}
async function until(fn, label) { const end = Date.now() + 60000; while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 250)); } throw Error(`Timed out: ${label}`); }
function pass(message) { checks.push(message); console.log('PASS ' + message); }
async function run(ids) { await call('approveTests', { testIds: ids }); await call('run', { testIds: ids }); await until(async () => (await project()).runs.at(-1).status === 'Completed', 'run'); }
(async () => {
  await new Promise(r => fixture.listen(4174, '127.0.0.1', r));
  const config = await (await fetch(base)).json();
  projectId = (await call('createProject', { name: 'URL + PRD + AI + uploaded cases · Verification', owner: 'QA', environment: 'Local', url: 'http://127.0.0.1:4174' })).projectId;
  await upload('search-prd.md', '# Search input requirement\nThe search query field must accept typed text and retain the exact entered value. Acceptance: after entering wireless mouse, its input value is wireless mouse.', 'requirements', true);
  let p = await project(); assert.ok(p.requirements.length); assert.ok(p.requirements.every(r => r.acceptanceCriteria.length));
  pass(`Live ${config.ai.provider} extracted PRD requirements`);
  await call('generateTests', {}, 400);
  await call('connect'); await call('resume'); await call('discover', { maxPages: 1, maxDepth: 0, timeLimit: 1 });
  await until(async () => (await call('status')).state === 'Connected', 'discovery');
  await call('generateTests', { workflow: 'Generate exactly one test for the search input requirement. Navigate to /, fill the observed #search with wireless mouse, then assertValue #search expected wireless mouse. No other actions. Link the supplied requirement IDs. Do not add assertVisible.' });
  p = await project(); assert.equal(p.tests.length, 1); const generated = p.tests[0]; assert.equal(generated.approved, false); assert.ok(generated.steps.some(s => s.action === 'assertValue' && s.expected === 'wireless mouse')); assert.ok(generated.requirementIds.length);
  await call('run', { testIds: [generated.id] }, 400); await run([generated.id]);
  p = await project(); assert.equal(p.results.at(-1).status, 'Passed', JSON.stringify(p.results.at(-1).steps));
  pass('URL + PRD → observed selectors → live AI test generation → approval → real passing input assertion');
  const before = p.tests.length;
  await upload('bad.csv', 'title,expected,steps\nBroken,Success,[]', 'tests', false, 400);
  assert.equal((await project()).tests.length, before);
  await call('saveTest', { title: 'Bypass attempt', expected: 'Active', steps: [{ action: 'assertText', target: '#status', expected: 'Active', humanApproval: true }] }, 400);
  await call('saveTest', { title: 'Missing expected', expected: 'Active', steps: [{ action: 'assertText', target: '#status' }] }, 400);
  pass('Empty imported cases and bypassed or missing assertions rejected without partial writes');
  await call('saveRequirement', { title: 'Partner activation', description: 'Activation changes Pending to Active.', acceptanceCriteria: ['After activation the status is Active.'] });
  p = await project(); const reqId = p.requirements.at(-1).id;
  const steps = JSON.stringify([{ action: 'navigate', target: '/' }, { action: 'click', target: '#activate' }, { action: 'assertText', target: '#status', expected: 'Active' }]);
  await upload('user-cases.csv', `title,expected,requirementIds,steps\n"Partner activation","Status becomes Active","${reqId}","${steps.replaceAll('"', '""')}"`, 'tests');
  p = await project(); const imported = p.tests.at(-1); assert.equal(imported.approved, false);
  await run([imported.id]); p = await project(); const failure = p.results.at(-1); assert.equal(failure.status, 'Failed'); assert.equal(failure.steps.at(-1).expected, 'Active');
  for (const name of [failure.screenshot, failure.trace]) { assert.ok(name); assert.equal((await fetch(`http://127.0.0.1:3000/api/evidence/${name}`)).status, 200); }
  await call('qaValidate', { name: 'QA' }, 400);
  pass('Uploaded user test detects actual fixture defect, retains expected outcome and saves evidence');
  await fetch('http://127.0.0.1:4174/fix', { method: 'POST' });
  await run([imported.id]); assert.equal((await project()).results.at(-1).status, 'Passed');
  pass('Same uploaded test passes only after actual application fix');
  await upload('natural-cases.csv', `title,expected result,requirement ids,steps\n"Input retains query","Input value is wireless mouse","${p.requirements[0].id}","Navigate to /; type wireless mouse in observed #search; verify exact input value with assertValue"`, 'tests', true);
  p = await project(); const converted = p.tests.slice(before + 1); assert.ok(converted.length); assert.ok(converted.every(t => t.steps.length && !t.approved));
  await run(converted.map(t => t.id)); p = await project(); const currentRun = p.runs.at(-1); assert.ok(p.results.filter(r => r.runId === currentRun.id).every(r => r.status === 'Passed'));
  pass('Natural-language user cases converted with live AI and executed successfully');
  await call('qaValidate', { name: 'QA' }); await call('signoff', { name: 'Developer' });
  await call('disconnect'); p = await project();
  await fs.mkdir(path.join(root, 'verification-output'), { recursive: true });
  await fs.writeFile(path.join(root, 'verification-output/workflow-project.json'), JSON.stringify(p, null, 2));
  await fs.writeFile(path.join(root, 'verification-output/workflow-report.json'), JSON.stringify({ at: new Date().toISOString(), projectId, provider: config.ai.provider, checks }, null, 2));
  console.log(`${checks.length} workflow checks passed. Project ${projectId}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => { fixture.close(); setTimeout(() => process.exit(process.exitCode || 0), 300); });
