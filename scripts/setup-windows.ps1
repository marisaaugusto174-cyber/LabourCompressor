$ErrorActionPreference = 'Stop'

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host '== LabourCompressor Windows setup =='
Write-Host "Project: $RootDir"

function Test-CommandAvailable {
  param([string] $Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Require-Command {
  param(
    [string] $Name,
    [string] $InstallMessage
  )

  if (-not (Test-CommandAvailable -Name $Name)) {
    throw $InstallMessage
  }
}

function Install-WingetPackage {
  param(
    [string] $PackageId,
    [string] $CommandName,
    [string] $DisplayName
  )

  if (Test-CommandAvailable -Name $CommandName) {
    Write-Host "OK: $CommandName is already available."
    return
  }

  if (-not (Test-CommandAvailable -Name 'winget')) {
    Write-Host "WARN: winget is not available. Install $DisplayName manually, then re-run this script."
    return
  }

  Write-Host "Installing $DisplayName with winget..."
  winget install --id $PackageId --exact --accept-source-agreements --accept-package-agreements
}

Require-Command -Name 'node' -InstallMessage 'ERROR: Node.js is not installed. Install Node.js 22+ first: https://nodejs.org/'

$NodeMajor = node -p "Number(process.versions.node.split('.')[0])"
if ([int] $NodeMajor -lt 22) {
  throw "ERROR: Node.js 22+ is required. Current version: $(node --version)"
}

Require-Command -Name 'npm' -InstallMessage 'ERROR: npm is not installed. Reinstall Node.js 22+ with npm.'

Install-WingetPackage -PackageId 'yt-dlp.yt-dlp' -CommandName 'yt-dlp' -DisplayName 'yt-dlp'
Install-WingetPackage -PackageId 'Gyan.FFmpeg' -CommandName 'ffmpeg' -DisplayName 'ffmpeg'
Install-WingetPackage -PackageId 'Python.Python.3.11' -CommandName 'python' -DisplayName 'Python 3.11'

$PythonCommand = Get-Command python3.11 -ErrorAction SilentlyContinue
if ($null -eq $PythonCommand) {
  $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
}
if ($null -eq $PythonCommand) {
  throw 'ERROR: Python 3.11+ is required for PySceneDetect. Install it and re-run npm run setup:windows.'
}

$ToolsBin = Join-Path $RootDir '.tools\bin'
$VenvDir = Join-Path $RootDir '.tools\scenedetect-venv'
$SceneDetectBin = Join-Path $VenvDir 'Scripts\scenedetect.exe'
New-Item -ItemType Directory -Force -Path $ToolsBin | Out-Null

if (Test-Path $SceneDetectBin) {
  Write-Host "OK: scenedetect is already available at $SceneDetectBin."
} else {
  Write-Host 'Installing PySceneDetect into project-local venv...'
  if (Test-Path $VenvDir) {
    Remove-Item -Recurse -Force $VenvDir
  }
  & $PythonCommand.Source -m venv $VenvDir
  & (Join-Path $VenvDir 'Scripts\python.exe') -m pip install --upgrade pip
  & (Join-Path $VenvDir 'Scripts\python.exe') -m pip install 'scenedetect[opencv]'
}

Set-Location $RootDir
Write-Host 'Installing Node dependencies...'
npm install

function Ensure-LocalConfig {
  param(
    [string] $TemplatePath,
    [string] $LocalPath
  )

  if (Test-Path $LocalPath) {
    Write-Host "OK: $(Split-Path -Leaf $LocalPath) already exists."
    return
  }

  if (-not (Test-Path $TemplatePath)) {
    throw "ERROR: Missing template: $TemplatePath"
  }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LocalPath) | Out-Null
  Copy-Item -Path $TemplatePath -Destination $LocalPath
  Write-Host "Created: $LocalPath"
}

Ensure-LocalConfig `
  -TemplatePath (Join-Path $RootDir 'config\model-providers\providers.template.json') `
  -LocalPath (Join-Path $RootDir 'config\model-providers\providers.local.json')
Ensure-LocalConfig `
  -TemplatePath (Join-Path $RootDir 'config\download-platform-credentials.template.json') `
  -LocalPath (Join-Path $RootDir 'config\download-platform-credentials.local.json')

Write-Host 'Creating Windows launcher...'
node (Join-Path $RootDir 'scripts\create-windows-launcher.ts')

Write-Host 'Setup complete.'
Write-Host 'Start the Web UI with:'
Write-Host '  npm run web'
Write-Host 'Or double-click the app launcher:'
Write-Host "  $(Join-Path $RootDir 'dist\LabourCompressor.vbs')"
Write-Host 'If the launcher fails, use the diagnostic command launcher:'
Write-Host "  $(Join-Path $RootDir 'dist\LabourCompressor.cmd')"
