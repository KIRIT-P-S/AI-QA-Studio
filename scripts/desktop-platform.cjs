const path = require('node:path');

function platformSettings(root, platform = process.platform) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  return {
    extension: windows ? 'cmd' : 'command',
    delimiter: windows ? ';' : ':',
    portablePython: windows ? paths.join(root, 'runtime', 'python', 'python.exe') : paths.join(root, 'runtime', 'python', 'bin', 'python3'),
    venvPython: windows ? paths.join(root, 'backend', 'venv', 'Scripts', 'python.exe') : paths.join(root, 'backend', 'venv', 'bin', 'python'),
    detached: !windows,
  };
}
function browserCommand(url, platform = process.platform) {
  if (platform === 'win32') return ['cmd.exe', ['/d', '/c', 'start', '', url]];
  if (platform === 'darwin') return ['/usr/bin/open', [url]];
  return ['xdg-open', [url]];
}
module.exports = { platformSettings, browserCommand };
