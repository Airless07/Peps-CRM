@echo off
setlocal
title Peps CRM
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Peps CRM - local launcher
echo  ==========================================
echo.

rem --- 1. Node.js installed? ---
where node >nul 2>nul
if errorlevel 1 (
  echo  [X] Node.js is not installed.
  echo      Download the LTS version from https://nodejs.org , install it, then run this file again.
  goto :fail
)
for /f "delims=" %%v in ('node -v') do echo  [ok] Node.js %%v

rem --- 2. .env present? ---
if not exist ".env" (
  if not exist ".env.example" (
    echo  [X] .env.example is missing. Re-download the project.
    goto :fail
  )
  copy /y ".env.example" ".env" >nul
  echo  [!] Created a new .env file from .env.example.
  echo.
  echo      Open ".env" in this folder and fill in:
  echo        DATABASE_URL    - your PostgreSQL connection string
  echo        APP_PASSWORD    - the password you will log in with
  echo        SESSION_SECRET  - a long random string, 32+ characters
  echo.
  echo      Then run launch.bat again.
  goto :fail
)
echo  [ok] .env found

rem --- 3. Dependencies (only if missing) ---
if not exist "node_modules\" (
  echo.
  echo  Installing dependencies, this takes a minute the first time...
  call npm install
  if errorlevel 1 (
    echo  [X] npm install failed. See the error above.
    goto :fail
  )
)
echo  [ok] Dependencies installed

rem --- 4. Prisma ---
echo.
echo  Preparing the database...
call npx prisma generate
if errorlevel 1 (
  echo  [X] prisma generate failed. See the error above.
  goto :fail
)
call npx prisma migrate deploy
if errorlevel 1 (
  echo  [X] Database migration failed. Check DATABASE_URL in .env and that the database is running.
  goto :fail
)
echo  [ok] Database ready

rem --- 5. Open the browser once the app answers, then start the dev server ---
echo.
echo  Starting Peps CRM at http://localhost:3000  (close this window to stop it)
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 180;$i++){ try { Invoke-WebRequest -Uri 'http://localhost:3000/login' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000'; break } catch { Start-Sleep -Seconds 1 } }"

call npm run dev
if errorlevel 1 (
  echo.
  echo  [X] The app stopped with an error. See the messages above.
  goto :fail
)
goto :eof

:fail
echo.
pause
exit /b 1
