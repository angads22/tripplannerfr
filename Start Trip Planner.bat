@echo off
title Trip Planner - Launcher
cd /d "%~dp0"

echo.
echo  ========================================
echo    Starting your Trip Planner server...
echo  ========================================
echo.

REM --- Make sure Node.js is installed -------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  [!] Node.js is not installed.
  echo      Download the LTS version from https://nodejs.org and run it again.
  echo.
  pause
  exit /b 1
)

REM --- First run? Install dependencies ------------------------------------
if not exist "node_modules" (
  echo  Installing dependencies for the first time, please wait...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [!] npm install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

REM --- Launch the server in its own window --------------------------------
echo  Launching server in a new window...
start "TripPlannerServer" cmd /k "node server.js"

REM --- Give it a moment, then open the browser ----------------------------
timeout /t 2 /nobreak >nul
start "" "http://localhost:4040"

echo.
echo  Trip Planner is on!  It opened in your browser.
echo  To turn it OFF, run  "Stop Trip Planner.bat"  (or close the server window).
echo.
timeout /t 4 /nobreak >nul
exit /b 0
