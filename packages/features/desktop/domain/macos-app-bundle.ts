export interface MacosAppBundleInput {
  readonly appName: string;
  readonly projectRoot: string;
  readonly defaultPort: number;
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
HOST='127.0.0.1'
DEFAULT_PORT='${input.defaultPort}'
LOG_DIR="\${HOME}/Library/Logs/LabourCompressor"
PID_FILE="\${LOG_DIR}/web-ui.pid"
LOG_FILE="\${LOG_DIR}/web-ui.log"

mkdir -p "\${LOG_DIR}"
cd "\${PROJECT_ROOT}"

fail() {
  /usr/bin/osascript -e "display dialog \\"$1\\" buttons {\\"OK\\"} default button \\"OK\\" with icon stop" >/dev/null 2>&1 || true
  exit 1
}

if ! command -v node >/dev/null 2>&1; then
  fail 'Node.js 22+ is required. Run scripts/setup-macos.sh first.'
fi

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
    /usr/bin/env node apps/cli/main.ts serve-web-ui >>"\${LOG_FILE}" 2>&1 &
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
