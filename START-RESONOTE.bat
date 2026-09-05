@echo off
REM Resonote — start the dev server from wherever this file lives, on any machine.
cd /d "%~dp0"
if not exist node_modules (
  echo Installing dependencies ^(first run only^)...
  call npm install
)
echo.
echo Resonote is starting. Open http://localhost:5173 in your browser.
echo The mic works on localhost or https only.
echo.
call npm run dev -- --host --port 5173 --strictPort
