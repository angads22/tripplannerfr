@echo off
title Trip Planner - Go Online
cd /d "%~dp0"

echo.
echo  ==========================================================
echo    Putting your Trip Planner online (reachable anywhere)
echo  ==========================================================
echo.
echo  This uses a FREE Cloudflare Tunnel. No domain to buy, no
echo  router port-forwarding, and it does NOT expose your home
echo  IP address. It also gives you HTTPS automatically, so your
echo  friends' passwords aren't sent in the clear.
echo.
echo  Make sure the server is already ON (run "Start Trip Planner.bat"
echo  first). Friends still need an account + the invite code.
echo.

REM --- Get the cloudflared helper if we don't have it (one time) ----------
if not exist "cloudflared.exe" (
  echo  Downloading the Cloudflare Tunnel helper, please wait...
  powershell -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile 'cloudflared.exe' } catch { Write-Host $_; exit 1 }"
  if not exist "cloudflared.exe" (
    echo.
    echo  [!] Could not download it automatically.
    echo      Download "cloudflared-windows-amd64.exe" from:
    echo        https://github.com/cloudflare/cloudflared/releases/latest
    echo      Save it next to this file as "cloudflared.exe" and run again.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  Starting the tunnel. In a moment a public link will appear below,
echo  looking like:   https://something-random.trycloudflare.com
echo.
echo  ^>^>  Share THAT link with your friends.  ^<^<
echo.
echo  Closing this window turns the public link off (the server keeps
echo  running locally until you run "Stop Trip Planner.bat").
echo.

cloudflared.exe tunnel --url http://localhost:4040

echo.
echo  Tunnel closed.
pause
exit /b 0
