@echo off
title Trip Planner - Stop
cd /d "%~dp0"

echo.
echo  Turning off the Trip Planner server...
echo.

set "STOPPED="

REM --- Preferred: kill the exact process via the PID file -----------------
if exist "data\server.pid" (
  set /p PID=<data\server.pid
  if defined PID (
    taskkill /PID %PID% /T /F >nul 2>nul
    if not errorlevel 1 set "STOPPED=1"
  )
  del /q "data\server.pid" >nul 2>nul
)

REM --- Fallback: kill by the server window's title ------------------------
if not defined STOPPED (
  taskkill /FI "WINDOWTITLE eq TripPlannerServer*" /T /F >nul 2>nul
  if not errorlevel 1 set "STOPPED=1"
)

if defined STOPPED (
  echo  Server stopped. Have a good trip!  🧳
) else (
  echo  Could not find a running server ^(it may already be off^).
)
echo.
timeout /t 3 /nobreak >nul
exit /b 0
