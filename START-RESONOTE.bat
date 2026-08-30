@echo off
title Resonote
cd /d D:\Guitar\APP\resonote-v2
echo.
echo  ============================================
echo   RESONOTE - starting the dev server...
echo   Your browser opens in a few seconds.
echo.
echo   KEEP THIS BLACK WINDOW OPEN while you play.
echo   Closing it stops the app.
echo  ============================================
echo.
start "" cmd /c "timeout /t 3 >nul && start http://localhost:5173"
npm run dev
echo.
echo  Server stopped. Press any key to close.
pause >nul
