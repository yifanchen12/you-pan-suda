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
echo 请先在本目录运行 npm install，然后再次双击本文件。
pause
