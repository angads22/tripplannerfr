@echo off
title Build Trip Planner .exe
cd /d "%~dp0"

echo.
echo  Building Trip Planner.exe ...
echo  This takes about 1-2 minutes the first time (downloads a Node.js snapshot).
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo  ERROR: Node.js is not installed or not on your PATH.
  echo  Download it from https://nodejs.org/ then try again.
  pause
  exit /b 1
)

call npm install
if errorlevel 1 (
  echo  npm install failed.
  pause
  exit /b 1
)

call npx pkg . --targets node18-win-x64 --no-bytecode --public-packages "*" --public --output "dist\TripPlanner.exe"
if errorlevel 1 (
  echo  Build failed. See errors above.
  pause
  exit /b 1
)

echo.
echo  Done!  Your exe is at:
echo    %~dp0dist\TripPlanner.exe
echo.
echo  Copy the dist\ folder anywhere you like.
echo  The exe creates a  data\  folder next to itself for accounts and sessions.
echo.
pause
