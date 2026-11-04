@echo off
cd /d "%~dp0"
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b 0
)
if exist "..\node_modules\electron\dist\electron.exe" (
  start "" "..\node_modules\electron\dist\electron.exe" .
  exit /b 0
)
echo Run npm install in this folder, then open this file again.
pause
