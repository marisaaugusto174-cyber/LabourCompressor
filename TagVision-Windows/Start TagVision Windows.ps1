$ErrorActionPreference = "Stop"

$ScriptDir = $PSScriptRoot
Set-Location $ScriptDir

$env:TAGVISION_WEB_HOST = if ($env:TAGVISION_WEB_HOST) { $env:TAGVISION_WEB_HOST } else { "127.0.0.1" }
$env:TAGVISION_WEB_PORT = if ($env:TAGVISION_WEB_PORT) { $env:TAGVISION_WEB_PORT } else { "4312" }
$TagVisionUrl = "http://$($env:TAGVISION_WEB_HOST):$($env:TAGVISION_WEB_PORT)/review.html"
$LogFile = Join-Path $ScriptDir "tagvision-windows-launcher.log"
$PidFile = Join-Path $ScriptDir "tagvision-windows-server.pid"
$ServerEntry = Join-Path $ScriptDir "apps\web\server.ts"
$BundledNode = Join-Path $ScriptDir "runtime\node\node.exe"
$BundledNpm = Join-Path $ScriptDir "runtime\node\npm.cmd"

Write-Host "Starting TagVision V0.5 Windows from: $ScriptDir"
Write-Host "TagVision URL: $TagVisionUrl"
Write-Host "Launcher log: $LogFile"

function Pause-OnError {
  Read-Host "Press Enter to close" | Out-Null
}

function Convert-ToComparablePathText {
  param([string]$Value)

  if (-not $Value) {
    return ""
  }

  return $Value.Replace("/", "\").ToLowerInvariant()
}

function Test-TagVisionPackageDir {
  param([string]$CandidateDir)

  if (-not $CandidateDir) {
    return $false
  }

  $PackagePath = Join-Path $CandidateDir "package.json"
  if (-not (Test-Path -LiteralPath $PackagePath)) {
    return $false
  }

  try {
    $Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
    return $Package.name -eq "tagvision-windows"
  } catch {
    return $false
  }
}

function Get-ProcessRecord {
  param([int]$ProcessId)

  Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Get-ProcessLineageCommandLines {
  param([int]$ProcessId)

  $CommandLines = New-Object System.Collections.Generic.List[string]
  $CurrentProcessId = $ProcessId

  for ($Index = 0; $Index -lt 8; $Index += 1) {
    $ProcessRecord = Get-ProcessRecord -ProcessId $CurrentProcessId
    if (-not $ProcessRecord) {
      break
    }

    if ($ProcessRecord.CommandLine) {
      $CommandLines.Add($ProcessRecord.CommandLine)
    }

    if (-not $ProcessRecord.ParentProcessId -or $ProcessRecord.ParentProcessId -eq $CurrentProcessId) {
      break
    }

    $CurrentProcessId = [int]$ProcessRecord.ParentProcessId
  }

  return $CommandLines
}

function Test-TagVisionServerProcess {
  param([int]$ProcessId)

  if (-not (Test-TagVisionPackageDir -CandidateDir $ScriptDir)) {
    return $false
  }

  $ProcessRecord = Get-ProcessRecord -ProcessId $ProcessId
  if (-not $ProcessRecord -or -not $ProcessRecord.CommandLine) {
    return $false
  }

  $CommandLine = Convert-ToComparablePathText -Value $ProcessRecord.CommandLine
  $ComparableScriptDir = Convert-ToComparablePathText -Value $ScriptDir
  $ComparableServerEntry = Convert-ToComparablePathText -Value $ServerEntry

  if ($CommandLine.Contains($ComparableServerEntry)) {
    return $true
  }

  if (-not $CommandLine.Contains("node apps\web\server.ts")) {
    return $false
  }

  foreach ($Line in (Get-ProcessLineageCommandLines -ProcessId $ProcessId)) {
    $ComparableLine = Convert-ToComparablePathText -Value $Line
    if ($ComparableLine.Contains($ComparableScriptDir)) {
      return $true
    }
  }

  return $false
}

function Stop-VerifiedTagVisionProcess {
  param([int]$ProcessId)

  Write-Host "Stopping previous TagVision server process: $ProcessId"
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue

  for ($Index = 0; $Index -lt 40; $Index += 1) {
    $Process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $Process) {
      return
    }

    Start-Sleep -Milliseconds 100
  }

  if (Test-TagVisionServerProcess -ProcessId $ProcessId) {
    Write-Host "Previous TagVision server did not exit after stop request; forcing stop: $ProcessId"
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
    return
  }

  throw "Process changed while stopping; refusing to force stop pid $ProcessId."
}

function Stop-ExistingTagVisionServers {
  $Connections = Get-NetTCPConnection -LocalPort ([int]$env:TAGVISION_WEB_PORT) -State Listen -ErrorAction SilentlyContinue
  if (-not $Connections) {
    return
  }

  foreach ($Connection in $Connections) {
    $ProcessId = [int]$Connection.OwningProcess

    if (Test-TagVisionServerProcess -ProcessId $ProcessId) {
      Stop-VerifiedTagVisionProcess -ProcessId $ProcessId
      continue
    }

    Write-Host "Port $($env:TAGVISION_WEB_PORT) is occupied by pid $ProcessId."
    Write-Host "Refusing to stop non-TagVision process. Close that app or choose another TAGVISION_WEB_PORT."
    Pause-OnError
    exit 1
  }
}

function Resolve-NodeCommand {
  if (Test-Path -LiteralPath $BundledNode) {
    Write-Host "Using bundled Node.js runtime."
    return $BundledNode
  }

  $SystemNode = Get-Command node -ErrorAction SilentlyContinue
  if ($SystemNode) {
    return $SystemNode.Source
  }

  Write-Host "Node.js was not found and bundled runtime is missing."
  Write-Host "Use the full TagVision Windows package with runtime\\node\\node.exe, or install Node.js LTS."
  Pause-OnError
  exit 1
}

function Resolve-NpmCommand {
  if (Test-Path -LiteralPath $BundledNpm) {
    return $BundledNpm
  }

  $SystemNpm = Get-Command npm -ErrorAction SilentlyContinue
  if ($SystemNpm) {
    return $SystemNpm.Source
  }

  return ""
}

function Sync-Dependencies {
  Write-Host "Syncing TagVision V0.5 Windows dependencies..."

  if (Test-DependenciesReady) {
    Write-Host "Using bundled TagVision dependencies."
    return
  }

  $NpmCommand = Resolve-NpmCommand
  if (-not $NpmCommand) {
    Write-Host "npm was not found and bundled npm is missing. Use the full TagVision Windows package or install Node.js LTS with npm."
    Pause-OnError
    exit 1
  }

  if (Test-Path -LiteralPath (Join-Path $ScriptDir "package-lock.json")) {
    & $NpmCommand ci --omit=dev --no-audit --no-fund
    return
  }

  & $NpmCommand install --omit=dev --no-audit --no-fund
}

function Test-DependenciesReady {
  $PlyrDistDir = Join-Path $ScriptDir "node_modules\plyr\dist"

  return (
    (Test-Path -LiteralPath (Join-Path $PlyrDistDir "plyr.min.js")) -and
    (Test-Path -LiteralPath (Join-Path $PlyrDistDir "plyr.css")) -and
    (Test-Path -LiteralPath (Join-Path $PlyrDistDir "plyr.svg"))
  )
}

$NodeCommand = Resolve-NodeCommand
Stop-ExistingTagVisionServers
Sync-Dependencies

Write-Host "Starting local server..."
Set-Content -LiteralPath $LogFile -Value "" -Encoding utf8

$ServerCommand = "`"$NodeCommand`" `"$ServerEntry`" > `"$LogFile`" 2>&1"
$ServerProcess = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", $ServerCommand) -WorkingDirectory $ScriptDir -PassThru -WindowStyle Hidden
Set-Content -LiteralPath $PidFile -Value $ServerProcess.Id -Encoding utf8

for ($Index = 0; $Index -lt 40; $Index += 1) {
  try {
    Invoke-WebRequest -UseBasicParsing -Uri $TagVisionUrl -TimeoutSec 1 | Out-Null
    Write-Host "TagVision V0.5 Windows is ready."
    Write-Host "Server process: $($ServerProcess.Id)"
    Start-Process $TagVisionUrl
    exit 0
  } catch {
    if ($ServerProcess.HasExited) {
      Write-Host "TagVision server exited before becoming ready. Last log lines:"
      if (Test-Path -LiteralPath $LogFile) {
        Get-Content -LiteralPath $LogFile -Tail 40
      }
      Pause-OnError
      exit 1
    }

    Start-Sleep -Milliseconds 250
  }
}

Write-Host "Timed out waiting for TagVision. Last log lines:"
if (Test-Path -LiteralPath $LogFile) {
  Get-Content -LiteralPath $LogFile -Tail 40
}
Stop-Process -Id $ServerProcess.Id -ErrorAction SilentlyContinue
Pause-OnError
exit 1
