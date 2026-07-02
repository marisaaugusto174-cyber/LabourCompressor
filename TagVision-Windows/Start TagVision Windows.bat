@echo off
setlocal

set "SCRIPT_DIR=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%Start TagVision Windows.ps1"

if errorlevel 1 (
  echo.
  echo TagVision V0.5.1 Windows launcher failed.
  pause
  exit /b %errorlevel%
)
