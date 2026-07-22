@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
  exit /b %errorlevel%
)

where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
  exit /b %errorlevel%
)

echo Python 3 was not found.
echo Install Python 3 or open index.html for browser-only storage.
pause
