/**
 * Compile, pack a .vsix, and install it into Cursor or VS Code.
 * Usage: node scripts/install-local.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const tsc = path.join(root, 'node_modules', 'typescript', 'lib', 'tsc.js');

function run(cmd, args) {
  execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
}

function which(cmd) {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}

function editorCli() {
  const forced = process.env.CHUCK_LIVE_EDITOR;
  if (forced) {
    return forced;
  }
  // Prefer Cursor when this workspace is open there; fall back to VS Code.
  for (const name of ['cursor', 'code']) {
    if (which(name)) {
      return name;
    }
  }
  throw new Error(
    'Neither `cursor` nor `code` is on PATH. Install the CLI from the editor, or set CHUCK_LIVE_EDITOR.'
  );
}

if (!fs.existsSync(tsc)) {
  throw new Error('TypeScript is missing under node_modules/. Run npm install first.');
}

console.log('Compiling…');
run(process.execPath, [tsc, '-p', '.']);

console.log('Packaging VSIX…');
run(process.execPath, [path.join(root, 'scripts', 'package-vsix.js')]);

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const vsix = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
if (!fs.existsSync(vsix)) {
  throw new Error(`Expected ${vsix} after packaging`);
}

const cli = editorCli();
console.log(`Installing ${path.basename(vsix)} with ${cli}…`);
run(cli, ['--install-extension', vsix, '--force']);
console.log('Done. Reload the window (Developer: Reload Window) to pick up the new build.');
