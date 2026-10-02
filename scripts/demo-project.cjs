/* Creates synthetic draft data via the normal API. Does not approve or execute it. */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { browserCommand, platformSettings } = require('./desktop-platform.cjs');
const demoLauncher = `Start Client Demo.${platformSettings(__dirname).extension}`;
const base = 'http://127.0.0.1:3000/api/studio';
async function api(body) {
  const response = await fetch(base, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || 'Could not prepare the demo project.');
  return result;
}
async function getProject(id) {
  const response = await fetch(base, {signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw new Error(`Run ${demoLauncher} first, then retry loading the demo.`);
  return (await response.json()).projects.find(p => p.id === id);
}
async function main() {
  const directory = path.resolve(__dirname, '../examples/manual-test-pack');
  const prd = fs.readFileSync(path.join(directory,'Shop_QA_Demo_PRD.md'),'utf8');
  const requirements = [...prd.matchAll(/^## Requirement R\d+ (.+)\r?\n+([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match => {
    const text = match[2].trim();
    return {title:match[1].trim(),description:text,acceptanceCriteria:[text.split('Acceptance criteria:')[1]?.trim() || text]};
  });
  const cases = JSON.parse(fs.readFileSync(path.join(directory,'cases.json'),'utf8'));
  if (requirements.length !== 6 || cases.length !== 8) throw new Error('The supplied demo pack is incomplete. Re-extract the original package.');
  const created = await api({action:'createProject',name:`Shop QA Demo - ${new Date().toLocaleString()}`,owner:'Demo reviewer',description:'Synthetic supplied test plan. Six PRD groups and eight draft tests. Review and approve before execution.',url:'http://127.0.0.1:4180/',environment:'Local'});
  for (const requirement of requirements) await api({action:'saveRequirement',projectId:created.projectId,...requirement});
  const project = await getProject(created.projectId);
  const mapping = [0,1,2,2,2,3,4,5];
  for (let index=0; index<cases.length; index++) {
    const requirement = project.requirements.find(r => r.title === requirements[mapping[index]].title);
    if (!requirement) throw new Error('A demo requirement was not saved. Inspect the new project before proceeding.');
    await api({action:'saveTest',projectId:created.projectId,...cases[index],requirementIds:[requirement.id]});
  }
  const verified = await getProject(created.projectId);
  if (verified.requirements.length !== 6 || verified.tests.length !== 8 || verified.tests.some(t=>t.approved || !t.requirementIds.length)) throw new Error('Demo preparation did not complete. Inspect the new project.');
  const url = `http://127.0.0.1:3000/projects/${created.projectId}/workspace`;
  console.log('Prepared 6 requirements and 8 linked draft tests. Nothing has been executed or approved.');
  console.log(`Review and run the demo here: ${url}`);
  if (!process.argv.includes('--no-open')) {
    const [executable,args]=browserCommand(url);
    spawn(executable,args,{windowsHide:true,stdio:'ignore'}).on('error',()=>{});
  }
}
main().catch(error=>{console.error(error.message === 'fetch failed' ? `Run ${demoLauncher} first, then retry loading the demo.` : error.message);process.exitCode=1;});
