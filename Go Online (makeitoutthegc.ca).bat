@echo off
title Pitstop - Go Online at makeitoutthegc.ca
cd /d "%~dp0"

set DOMAIN=makeitoutthegc.ca
set TUNNEL=pitstop

echo.
echo  ==========================================================
echo    Putting Pitstop online at  https://%DOMAIN%
echo  ==========================================================
echo.
echo  This uses a FREE Cloudflare Named Tunnel tied to your own
echo  domain. No port forwarding, your home IP stays hidden, and
echo  HTTPS is automatic.
echo.
echo  Make sure the app is already ON (run "Start Trip Planner.bat"
echo  or double-click TripPlanner.exe first).
echo.

REM --- Get the cloudflared helper if we don't have it (one time) ----------
if not exist "cloudflared.exe" (
  echo  Downloading the Cloudflare Tunnel helper, please wait...
  powershell -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' } catch { Write-Host $_; exit 1 }"
  if not exist "cloudflared.exe" (
    echo  [!] Could not download it. Get cloudflared-windows-amd64.exe from
    echo      https://github.com/cloudflare/cloudflared/releases/latest
    echo      save it next to this file as cloudflared.exe, and run again.
    pause
    exit /b 1
  )
)

REM --- One-time login to YOUR Cloudflare account --------------------------
if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo.
  echo  STEP 1 of 3: Log in to Cloudflare.
  echo  A browser window will open. Pick the zone "%DOMAIN%" and authorize.
  echo.
  pause
  cloudflared.exe tunnel login
  if not exist "%USERPROFILE%\.cloudflared\cert.pem" (
    echo  [!] Login did not complete. Run this file again.
    pause
    exit /b 1
  )
)

REM --- Create the named tunnel once --------------------------------------
cloudflared.exe tunnel info %TUNNEL% >nul 2>&1
if errorlevel 1 (
  echo.
  echo  STEP 2 of 3: Creating the tunnel "%TUNNEL%"...
  cloudflared.exe tunnel create %TUNNEL%
)

REM --- Point the domain at the tunnel (idempotent) -----------------------
echo.
echo  STEP 3 of 3: Routing %DOMAIN% to the tunnel...
cloudflared.exe tunnel route dns %TUNNEL% %DOMAIN%

REM --- Write a config that forwards the domain to the local app ----------
> "cloudflared-config.yml" echo tunnel: %TUNNEL%
>> "cloudflared-config.yml" echo ingress:
>> "cloudflared-config.yml" echo   - hostname: %DOMAIN%
>> "cloudflared-config.yml" echo     service: http://localhost:4040
>> "cloudflared-config.yml" echo   - service: http_status:404

echo.
echo  ==========================================================
echo    Pitstop is now live at:  https://%DOMAIN%
echo  ==========================================================
echo.
echo  Share that link. Friends still need an account + invite code.
echo  Closing this window takes the site offline (the app keeps
echo  running locally). Re-run this file any time to go back online.
echo.

cloudflared.exe tunnel --config "cloudflared-config.yml" run %TUNNEL%

echo.
echo  Tunnel closed.
pause
exit /b 0
