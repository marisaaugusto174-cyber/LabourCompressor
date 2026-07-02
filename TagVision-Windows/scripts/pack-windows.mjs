import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = '24.18.0';
const NODE_ARCHIVE_BASENAME = `node-v${NODE_VERSION}-win-x64`;
const NODE_ARCHIVE_NAME = `node-v${NODE_VERSION}-win-x64.zip`;
const NODE_DIST_BASE_URL = `https://nodejs.org/dist/v${NODE_VERSION}`;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(projectRoot, 'dist');
const packageDir = path.join(distDir, 'TagVision-Windows-V0.5.1');
const zipPath = path.join(distDir, 'TagVision-Windows-V0.5.1.zip');
const runtimeCacheDir = path.join(projectRoot, '.runtime-cache');
const portableNodeDir = path.join(packageDir, 'runtime', 'node');

const packageItems = [
  '.gitignore',
  'README.md',
  'TagVision Windows Manual Terminal Startup.txt',
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

await main();

async function main() {
  cleanDistArtifacts();
  fs.mkdirSync(packageDir, { recursive: true });

  for (const item of packageItems) {
    const source = path.join(projectRoot, item);

    if (!fs.existsSync(source)) {
      continue;
    }

    copyRecursive(source, path.join(packageDir, item));
  }

  installProductionDependencies();
  await installPortableNodeRuntime();
  createZip();
  execFileSync(npmCommand(), ['pack', '--pack-destination', distDir], {
    cwd: projectRoot,
    stdio: 'inherit'
  });

  console.log(`Wrote ${zipPath}`);
}

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

function cleanDistArtifacts() {
  fs.mkdirSync(distDir, { recursive: true });

  for (const item of fs.readdirSync(distDir)) {
    if (/^TagVision-Windows-V/u.test(item) || /^tagvision-windows-.*\.tgz$/u.test(item)) {
      fs.rmSync(path.join(distDir, item), { recursive: true, force: true });
    }
  }
}

function installProductionDependencies() {
  console.log('Installing production dependencies for packaged Windows app...');
  execFileSync(npmCommand(), ['ci', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: packageDir,
    stdio: 'inherit'
  });
}

async function installPortableNodeRuntime() {
  console.log(`Installing portable Node.js ${NODE_VERSION} for Windows x64...`);
  const archivePath = await downloadPortableNodeRuntime();
  await verifyNodeRuntimeArchive(archivePath);
  extractPortableNodeRuntime(archivePath);

  const nodeExe = path.join(portableNodeDir, 'node.exe');
  if (!fs.existsSync(nodeExe)) {
    throw new Error(`Portable Node runtime was not installed correctly: ${nodeExe}`);
  }
}

async function downloadPortableNodeRuntime() {
  fs.mkdirSync(runtimeCacheDir, { recursive: true });

  const archivePath = path.join(runtimeCacheDir, NODE_ARCHIVE_NAME);
  const checksumPath = path.join(runtimeCacheDir, `SHASUMS256-v${NODE_VERSION}.txt`);

  if (!fs.existsSync(archivePath)) {
    await downloadFile(`${NODE_DIST_BASE_URL}/${NODE_ARCHIVE_NAME}`, archivePath);
  }

  await downloadFile(`${NODE_DIST_BASE_URL}/SHASUMS256.txt`, checksumPath);
  return archivePath;
}

async function verifyNodeRuntimeArchive(archivePath) {
  const checksumPath = path.join(runtimeCacheDir, `SHASUMS256-v${NODE_VERSION}.txt`);
  const checksumText = fs.readFileSync(checksumPath, 'utf8');
  const expectedLine = checksumText
    .split(/\r?\n/u)
    .find((line) => line.endsWith(`  ${NODE_ARCHIVE_NAME}`));

  if (!expectedLine) {
    throw new Error(`Checksum for ${NODE_ARCHIVE_NAME} was not found in official SHASUMS256.txt`);
  }

  const expectedHash = expectedLine.split(/\s+/u)[0];
  const actualHash = crypto
    .createHash('sha256')
    .update(fs.readFileSync(archivePath))
    .digest('hex');

  if (actualHash !== expectedHash) {
    fs.rmSync(archivePath, { force: true });
    throw new Error(`Checksum mismatch for ${NODE_ARCHIVE_NAME}`);
  }
}

async function downloadFile(url, target) {
  console.log(`Downloading ${url}`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }

  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

function extractPortableNodeRuntime(archivePath) {
  const extractDir = path.join(distDir, '.node-runtime-extract');
  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.rmSync(portableNodeDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  fs.mkdirSync(path.dirname(portableNodeDir), { recursive: true });

  extractZip(archivePath, extractDir);

  const extractedRuntimeDir = path.join(extractDir, NODE_ARCHIVE_BASENAME);
  copyRuntimeRecursive(extractedRuntimeDir, portableNodeDir);
  fs.rmSync(extractDir, { recursive: true, force: true });
}

function extractZip(archivePath, targetDir) {
  if (process.platform === 'win32') {
    const powershell = findPowerShellCommand();
    execFileSync(
      powershell,
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -Path '${escapePowerShellSingleQuotedString(archivePath)}' -DestinationPath '${escapePowerShellSingleQuotedString(targetDir)}' -Force`
      ],
      { stdio: 'inherit' }
    );
    return;
  }

  execFileSync('unzip', ['-q', archivePath, '-d', targetDir], { stdio: 'inherit' });
}

function copyRuntimeRecursive(source, target) {
  const stats = fs.statSync(source);

  if (stats.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });

    for (const child of fs.readdirSync(source)) {
      copyRuntimeRecursive(path.join(source, child), path.join(target, child));
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
