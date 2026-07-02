export interface MacosAppBundleInput {
  readonly appName: string;
  readonly projectRoot: string;
  readonly defaultPort: number;
  readonly nodeExecutablePath?: string | undefined;
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
  <string>0.5.1</string>
  <key>CFBundleShortVersionString</key>
  <string>0.5.1</string>
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
SETUP_SCRIPT="\${PROJECT_ROOT}/scripts/setup-macos.sh"

export PATH="\${PROJECT_ROOT}/.tools/bin:/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:\${PATH:-}"

mkdir -p "\${LOG_DIR}"
cd "\${PROJECT_ROOT}"

fail() {
  /usr/bin/osascript -e "display dialog \\"$1\\" buttons {\\"OK\\"} default button \\"OK\\" with icon stop" >/dev/null 2>&1 || true
  exit 1
}

is_labour_compressor() {
  local port="$1"
  /usr/bin/curl -fsS --max-time 1 "http://\${HOST}:\${port}/api/defaults" 2>/dev/null | /usr/bin/grep -q 'autoSegmentation'
}

find_running_port() {
  local port
  for port in $(/usr/bin/seq "\${DEFAULT_PORT}" $((DEFAULT_PORT + 50))); do
    if is_labour_compressor "\${port}"; then
      echo "\${port}"
      return
    fi
  done
}

labour_pid_cwd() {
  local pid="$1"
  /usr/sbin/lsof -a -p "\${pid}" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p' | /usr/bin/head -n 1
}

is_labour_compressor_pid() {
  local pid="$1"
  local command
  local cwd

  if ! [[ "\${pid}" =~ ^[0-9]+$ ]]; then
    return 1
  fi

  command="$(/bin/ps -p "\${pid}" -o command= 2>/dev/null || true)"
  if [ -z "\${command}" ]; then
    return 1
  fi

  if ! /bin/echo "\${command}" | /usr/bin/grep -q 'apps/cli/main.ts serve-web-ui'; then
    return 1
  fi

  cwd="$(labour_pid_cwd "\${pid}")"
  [ "\${cwd}" = "\${PROJECT_ROOT}" ]
}

wait_for_pid_exit() {
  local pid="$1"
  local attempt

  for attempt in $(/usr/bin/seq 1 40); do
    if ! /bin/kill -0 "\${pid}" >/dev/null 2>&1; then
      return 0
    fi
    /bin/sleep 0.25
  done

  return 1
}

stop_pid_if_labour_compressor() {
  local pid="$1"

  if ! is_labour_compressor_pid "\${pid}"; then
    return
  fi

  echo "Stopping existing LabourCompressor Web UI pid \${pid} at $(/bin/date)" >>"\${LOG_FILE}"
  /bin/kill -TERM "\${pid}" >/dev/null 2>&1 || true

  if ! wait_for_pid_exit "\${pid}"; then
    echo "Force stopping LabourCompressor Web UI pid \${pid} at $(/bin/date)" >>"\${LOG_FILE}"
    /bin/kill -KILL "\${pid}" >/dev/null 2>&1 || true
    wait_for_pid_exit "\${pid}" || true
  fi
}

stop_labour_compressor_on_port() {
  local port="$1"
  local pid

  if ! is_labour_compressor "\${port}"; then
    return
  fi

  for pid in $(/usr/sbin/lsof -tiTCP:"\${port}" -sTCP:LISTEN 2>/dev/null || true); do
    stop_pid_if_labour_compressor "\${pid}"
  done
}

stop_existing_labour_compressor() {
  local pid
  local port

  if [ -f "\${PID_FILE}" ]; then
    pid="$(/bin/cat "\${PID_FILE}" 2>/dev/null || true)"
    if [ -n "\${pid}" ]; then
      stop_pid_if_labour_compressor "\${pid}"
    fi
  fi

  for port in $(/usr/bin/seq "\${DEFAULT_PORT}" $((DEFAULT_PORT + 50))); do
    stop_labour_compressor_on_port "\${port}"
  done

  rm -f "\${PID_FILE}"
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

check_manual_prerequisites() {
  if [ ! -f "\${SETUP_SCRIPT}" ]; then
    fail "Missing setup script: \${SETUP_SCRIPT}"
  fi

  if ! xcrun --find clang >/dev/null 2>&1; then
    fail 'Xcode Command Line Tools are required. Install them with: xcode-select --install'
  fi

  if ! command -v npm >/dev/null 2>&1; then
    fail 'npm is required. Reinstall Node.js 22+ with npm included.'
  fi

  if ! command -v brew >/dev/null 2>&1; then
    fail 'Homebrew is required. Install it first from https://brew.sh/'
  fi
}

needs_setup() {
  if [ ! -d "\${PROJECT_ROOT}/node_modules/xlsx" ]; then
    return 0
  fi

  if ! command -v yt-dlp >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v ffmpeg >/dev/null 2>&1; then
    return 0
  fi

  if ! command -v python3.11 >/dev/null 2>&1; then
    return 0
  fi

  if [ ! -f "\${PROJECT_ROOT}/config/model-providers/providers.local.json" ]; then
    return 0
  fi

  if [ ! -f "\${PROJECT_ROOT}/config/download-platform-credentials.local.json" ]; then
    return 0
  fi

  return 1
}

run_setup() {
  echo "Running LabourCompressor setup at $(/bin/date)" >>"\${LOG_FILE}"

  if ! /bin/bash "\${SETUP_SCRIPT}" >>"\${LOG_FILE}" 2>&1; then
    fail "Setup failed. Check \${LOG_FILE}."
  fi

  echo "Setup finished at $(/bin/date)" >>"\${LOG_FILE}"
}

is_port_in_use() {
  local port="$1"
  /usr/sbin/lsof -nP -iTCP:"\${port}" -sTCP:LISTEN >/dev/null 2>&1
}

find_port() {
  local port
  for port in $(/usr/bin/seq "\${DEFAULT_PORT}" $((DEFAULT_PORT + 50))); do
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

if [ "\${LABOUR_COMPRESSOR_REUSE_RUNNING:-0}" = "1" ]; then
  REUSE_PORT="$(find_running_port)"
  if [ -n "\${REUSE_PORT}" ]; then
    /usr/bin/open "http://\${HOST}:\${REUSE_PORT}"
    exit 0
  fi
fi

stop_existing_labour_compressor

if [ -n "$(find_running_port)" ]; then
  fail 'Could not stop the existing LabourCompressor Web UI process.'
fi

if [ "\${LABOUR_COMPRESSOR_STOP_ONLY:-0}" = "1" ]; then
  exit 0
fi

resolve_node
validate_node
check_manual_prerequisites

if needs_setup; then
  run_setup
  resolve_node
  validate_node
fi

PORT="$(find_port)"

if ! is_labour_compressor "\${PORT}"; then
  echo "Starting LabourCompressor Web UI on \${HOST}:\${PORT}" >>"\${LOG_FILE}"
  /usr/bin/nohup /usr/bin/env \\
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
