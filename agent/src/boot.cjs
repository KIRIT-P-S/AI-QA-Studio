const { spawn } = require('node:child_process');
const path = require('node:path');
const directory = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.resolve(directory, '../web/.env.local'), quiet: true });
const child = spawn(process.execPath, [path.join(directory, 'node_modules/tsx/dist/cli.mjs'), path.join(directory, 'src/server.ts')], { cwd: directory, stdio: 'inherit', windowsHide: true, env: { ...process.env, STUDIO_DATA_DIR: process.env.STUDIO_DATA_DIR || path.resolve(directory, '../web/data/studio') } });
child.on('exit', code => { process.exitCode = code || 0; });
child.on('error', e => { console.error(e.message); process.exitCode = 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
