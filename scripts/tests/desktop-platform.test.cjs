const test = require('node:test');
const assert = require('node:assert/strict');
const { platformSettings, browserCommand } = require('../desktop-platform.cjs');

test('Mac services use Unix Python paths, PATH separator and their own process groups', () => {
  const settings = platformSettings('/Users/Client/AI QA Studio', 'darwin');
  assert.equal(settings.venvPython, '/Users/Client/AI QA Studio/backend/venv/bin/python');
  assert.equal(settings.portablePython, '/Users/Client/AI QA Studio/runtime/python/bin/python3');
  assert.equal(settings.delimiter, ':');
  assert.equal(settings.extension, 'command');
  assert.equal(settings.detached, true);
});

test('Windows keeps its executable paths and supervisor child tree behavior', () => {
  const settings = platformSettings('C:\\Client\\AI QA Studio', 'win32');
  assert.equal(settings.venvPython, 'C:\\Client\\AI QA Studio\\backend\\venv\\Scripts\\python.exe');
  assert.equal(settings.portablePython, 'C:\\Client\\AI QA Studio\\runtime\\python\\python.exe');
  assert.equal(settings.delimiter, ';');
  assert.equal(settings.extension, 'cmd');
  assert.equal(settings.detached, false);
});

test('Mac opens URLs as a single argument without involving a shell', () => {
  assert.deepEqual(browserCommand('http://127.0.0.1:3000/projects?a=1&b=2', 'darwin'),
    ['/usr/bin/open', ['http://127.0.0.1:3000/projects?a=1&b=2']]);
});

test('Windows continues opening its local application using start', () => {
  assert.deepEqual(browserCommand('http://127.0.0.1:3000/', 'win32'),
    ['cmd.exe', ['/d', '/c', 'start', '', 'http://127.0.0.1:3000/']]);
});
