$ErrorActionPreference = "Stop"

$ScriptPath = Join-Path $PSScriptRoot "pack-windows.mjs"
node $ScriptPath
