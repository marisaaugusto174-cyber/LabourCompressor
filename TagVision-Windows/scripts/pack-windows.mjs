import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const packageDir = path.join(distDir, 'TagVision-Windows-V0.1');
const zipPath = path.join(distDir, 'TagVision-Windows-V0.1.zip');

const packageItems = [
  '.gitignore',
  'README.md',
  'Start TagVision Windows.bat',
  'Start TagVision Windows.ps1',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'apps',
  'packages',
  'scripts'
];

const excludedNames = new Set([
  '.DS_Store',
  '._.DS_Store',
  'node_modules',
  'dist',
  'tagvision-windows-launcher.log',
  'tagvision-windows-server.pid',
  '_tagvision-thumbnails'
]);

fs.rmSync(packageDir, { recursive: true, force: true });
fs.rmSync(zipPath, { force: true });
fs.mkdirSync(packageDir, { recursive: true });

for (const item of packageItems) {
  const source = path.join(projectRoot, item);

  if (!fs.existsSync(source)) {
    continue;
  }

  copyRecursive(source, path.join(packageDir, item));
}

createZip();
execFileSync(npmCommand(), ['pack', '--pack-destination', distDir], {
  cwd: projectRoot,
  stdio: 'inherit'
});

console.log(`Wrote ${zipPath}`);

function copyRecursive(source, target) {
  const name = path.basename(source);

  if (excludedNames.has(name)) {
    return;
  }

  const stats = fs.statSync(source);

  if (stats.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });

    for (const child of fs.readdirSync(source)) {
      copyRecursive(path.join(source, child), path.join(target, child));
    }

    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function createZip() {
  fs.mkdirSync(distDir, { recursive: true });

  if (process.platform === 'win32') {
    const powershell = findPowerShellCommand();
    execFileSync(
      powershell,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Compress-Archive -Path '${escapePowerShellSingleQuotedString(packageDir)}' -DestinationPath '${escapePowerShellSingleQuotedString(zipPath)}' -Force`
      ],
      { stdio: 'inherit' }
    );
    return;
  }

  execFileSync(
    'zip',
    ['-r', '-q', path.basename(zipPath), path.basename(packageDir), '-x', '*/.DS_Store', '*/._*'],
    { cwd: distDir, stdio: 'inherit' }
  );
}

function findPowerShellCommand() {
  for (const candidate of ['powershell.exe', 'pwsh.exe', 'pwsh']) {
    try {
      execFileSync(candidate, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
        stdio: 'ignore'
      });
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error('PowerShell was not found. Install PowerShell or run this pack script on Windows.');
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function escapePowerShellSingleQuotedString(value) {
  return value.replaceAll("'", "''");
}
