export interface MacosAppBundleInput {
  readonly appName: string;
  readonly projectRoot: string;
  readonly defaultPort: number;
  readonly nodeExecutablePath?: string;
}

export interface MacosAppBundleFile {
  readonly relativePath: string;
  readonly content: string;
  readonly executable: boolean;
}

export interface MacosAppBundleSpec {
  readonly bundleDirectoryName: string;
  readonly files: readonly MacosAppBundleFile[];
  readonly nativeExecutable: {
    readonly relativePath: string;
    readonly source: string;
  };
}

export interface NativeLauncherCompileInput {
  readonly sourcePath: string;
  readonly outputPath: string;
}

export function createMacosAppBundleSpec(
  input: MacosAppBundleInput
): MacosAppBundleSpec {
  assertValidBundleInput(input);

  return {
    bundleDirectoryName: `${input.appName}.app`,
    files: [
      {
        relativePath: 'Contents/Info.plist',
        content: createInfoPlist(input.appName),
        executable: false
      },
      {
        relativePath: 'Contents/Resources/launcher.sh',
        content: createLauncherScript(input),
        executable: true
      }
    ],
    nativeExecutable: {
      relativePath: 'Contents/MacOS/labour-compressor',
      source: createNativeLauncherSource()
    }
  };
}

export function createNativeLauncherCompileArgs(
  input: NativeLauncherCompileInput
): readonly string[] {
  return [
    '-arch',
    'arm64',
    '-mmacosx-version-min=12.0',
    input.sourcePath,
    '-o',
    input.outputPath
  ];
}

export function createWindowsLauncherScript(
  input: MacosAppBundleInput
): string {
  assertValidBundleInput(input);

  const projectRoot = escapePowerShellSingleQuotedString(input.projectRoot);
  const nodeExecutablePath = escapePowerShellSingleQuotedString(input.nodeExecutablePath ?? '');
  const appName = escapePowerShellSingleQuotedString(input.appName);

  return `$ErrorActionPreference = 'Stop'

$ProjectRoot = '${projectRoot}'
$NodeBin = '${nodeExecutablePath}'
$HostName = '127.0.0.1'
$DefaultPort = ${input.defaultPort}
$AppName = '${appName}'
$LocalAppData = if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { Join-Path $env:USERPROFILE 'AppData\\Local' } else { $env:LOCALAPPDATA }
$LogDir = Join-Path $LocalAppData "${appName}\\logs"
$PidFile = Join-Path $LogDir 'web-ui.pid'
$LogFile = Join-Path $LogDir 'web-ui.log'
$LaunchArgsText = 'apps\\cli\\main.ts serve-web-ui'
$ToolBin = '${projectRoot}\\.tools\\bin'
$SceneDetectScripts = '${projectRoot}\\.tools\\scenedetect-venv\\Scripts'

$env:PATH = "$ToolBin;$SceneDetectScripts;$env:PATH"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Set-Location $ProjectRoot

function Resolve-Node {
  if (-not [string]::IsNullOrWhiteSpace($NodeBin) -and (Test-Path $NodeBin)) {
    return $NodeBin
  }

  $resolved = Get-Command node -ErrorAction SilentlyContinue
  if ($null -eq $resolved) {
    throw 'Node.js 22+ is required. Run npm run setup:windows first.'
  }
  return $resolved.Source
}

function Test-LabourCompressorPort {
  param([int] $Port)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 -Uri "http://$HostName\`:$Port/api/defaults"
    return $response.Content.Contains('autoSegmentation')
  } catch {
    return $false
  }
}

function Test-PortInUse {
  param([int] $Port)
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  return $null -ne $connection
}

function Find-WebPort {
  for ($Port = $DefaultPort; $Port -le $DefaultPort + 50; $Port += 1) {
    if (Test-LabourCompressorPort -Port $Port) {
      return $Port
    }
    if (-not (Test-PortInUse -Port $Port)) {
      return $Port
    }
  }
  throw 'No available local Web UI port found between 4311 and 4361.'
}

function Wait-WebServer {
  param([int] $Port)
  for ($Attempt = 1; $Attempt -le 40; $Attempt += 1) {
    if (Test-LabourCompressorPort -Port $Port) {
      return
    }
    Start-Sleep -Milliseconds 250
  }
  throw "LabourCompressor Web UI did not start. Check $LogFile."
}

$NodeBin = Resolve-Node
$NodeMajor = & $NodeBin -p "Number(process.versions.node.split('.')[0])"
if ([int] $NodeMajor -lt 22) {
  throw "Node.js 22+ is required. Current node: $NodeBin"
}

$Port = Find-WebPort
if (-not (Test-LabourCompressorPort -Port $Port)) {
  "Starting LabourCompressor Web UI on $HostName\`:$Port" | Out-File -FilePath $LogFile -Append -Encoding utf8
  $env:LABOUR_COMPRESSOR_WEB_HOST = $HostName
  $env:LABOUR_COMPRESSOR_WEB_PORT = [string] $Port
  $process = Start-Process -FilePath $NodeBin -ArgumentList $LaunchArgsText -WorkingDirectory $ProjectRoot -RedirectStandardOutput $LogFile -RedirectStandardError $LogFile -PassThru
  [string] $process.Id | Out-File -FilePath $PidFile -Encoding utf8
}

Wait-WebServer -Port $Port
Start-Process "http://127.0.0.1:$Port"
`;
}

function assertValidBundleInput(input: MacosAppBundleInput): void {
  if (input.appName.trim().length === 0) {
    throw new Error('appName is required.');
  }

  if (input.projectRoot.trim().length === 0) {
    throw new Error('projectRoot is required.');
  }

  if (!Number.isInteger(input.defaultPort) || input.defaultPort < 1024) {
    throw new Error('defaultPort must be an integer >= 1024.');
  }
}

function createInfoPlist(appName: string): string {
  const escapedName = escapeXml(appName);

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${escapedName}</string>
  <key>CFBundleDisplayName</key>
  <string>${escapedName}</string>
  <key>CFBundleIdentifier</key>
  <string>local.labour-compressor.launcher</string>
  <key>CFBundleVersion</key>
  <string>0.3</string>
  <key>CFBundleShortVersionString</key>
  <string>0.3</string>
  <key>CFBundleExecutable</key>
  <string>labour-compressor</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>LSArchitecturePriority</key>
  <array>
    <string>arm64</string>
  </array>
  <key>LSUIElement</key>
  <false/>
</dict>
</plist>
`;
}

function createLauncherScript(input: MacosAppBundleInput): string {
  return `#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=${shellSingleQuote(input.projectRoot)}
NODE_BIN=${shellSingleQuote(input.nodeExecutablePath ?? '')}
HOST='127.0.0.1'
DEFAULT_PORT='${input.defaultPort}'
LOG_DIR="\${HOME}/Library/Logs/LabourCompressor"
PID_FILE="\${LOG_DIR}/web-ui.pid"
LOG_FILE="\${LOG_DIR}/web-ui.log"

export PATH="\${PROJECT_ROOT}/.tools/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"

mkdir -p "\${LOG_DIR}"
cd "\${PROJECT_ROOT}"

fail() {
  /usr/bin/osascript -e "display dialog \\"$1\\" buttons {\\"OK\\"} default button \\"OK\\" with icon stop" >/dev/null 2>&1 || true
  exit 1
}

resolve_node() {
  if [ -n "\${NODE_BIN}" ] && [ -x "\${NODE_BIN}" ]; then
    return
  fi

  NODE_BIN="$(command -v node || true)"
  if [ -z "\${NODE_BIN}" ]; then
    fail 'Node.js 22+ is required. Run scripts/setup-macos.sh first.'
  fi
}

validate_node() {
  local node_major
  node_major="\$("\${NODE_BIN}" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || true)"

  if [ -z "\${node_major}" ] || [ "\${node_major}" -lt 22 ]; then
    fail "Node.js 22+ is required. Current node: \${NODE_BIN}"
  fi
}

resolve_node
validate_node

is_labour_compressor() {
  local port="$1"
  /usr/bin/curl -fsS --max-time 1 "http://\${HOST}:\${port}/api/defaults" 2>/dev/null | /usr/bin/grep -q 'autoSegmentation'
}

is_port_in_use() {
  local port="$1"
  /usr/sbin/lsof -nP -iTCP:"\${port}" -sTCP:LISTEN >/dev/null 2>&1
}

find_port() {
  local port
  for port in $(/usr/bin/seq "\${DEFAULT_PORT}" $((DEFAULT_PORT + 50))); do
    if is_labour_compressor "\${port}"; then
      echo "\${port}"
      return
    fi

    if ! is_port_in_use "\${port}"; then
      echo "\${port}"
      return
    fi
  done

  fail 'No available local Web UI port found between 4311 and 4361.'
}

wait_for_server() {
  local port="$1"
  local attempt
  for attempt in $(/usr/bin/seq 1 40); do
    if is_labour_compressor "\${port}"; then
      return
    fi
    /bin/sleep 0.25
  done

  fail "LabourCompressor Web UI did not start. Check \${LOG_FILE}."
}

PORT="$(find_port)"

if ! is_labour_compressor "\${PORT}"; then
  echo "Starting LabourCompressor Web UI on \${HOST}:\${PORT}" >>"\${LOG_FILE}"
  LABOUR_COMPRESSOR_WEB_HOST="\${HOST}" \\
    LABOUR_COMPRESSOR_WEB_PORT="\${PORT}" \\
    "\${NODE_BIN}" apps/cli/main.ts serve-web-ui >>"\${LOG_FILE}" 2>&1 &
  echo "$!" >"\${PID_FILE}"
fi

wait_for_server "\${PORT}"
/usr/bin/open "http://\${HOST}:\${PORT}"
`;
}

function createNativeLauncherSource(): string {
  return `#include <limits.h>
#include <mach-o/dyld.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  char executable_path[PATH_MAX];
  uint32_t size = sizeof(executable_path);

  if (_NSGetExecutablePath(executable_path, &size) != 0) {
    fprintf(stderr, "Executable path is too long.\\n");
    return 1;
  }

  char *last_slash = strrchr(executable_path, '/');
  if (last_slash == NULL) {
    fprintf(stderr, "Cannot locate app executable directory.\\n");
    return 1;
  }
  *last_slash = '\\0';

  char launcher_path[PATH_MAX];
  int written = snprintf(
    launcher_path,
    sizeof(launcher_path),
    "%s/../Resources/launcher.sh",
    executable_path
  );

  if (written < 0 || written >= (int)sizeof(launcher_path)) {
    fprintf(stderr, "Launcher path is too long.\\n");
    return 1;
  }

  execl("/bin/bash", "bash", launcher_path, (char *)NULL);
  perror("Failed to start LabourCompressor launcher");
  return 1;
}
`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;');
}

function escapePowerShellSingleQuotedString(value: string): string {
  return value.replaceAll('\'', '\'\'');
}
