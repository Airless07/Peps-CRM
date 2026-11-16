@echo off
setlocal
title Buckshot Peps
cd /d "%~dp0"

echo.
echo  ==========================================
echo    Buckshot Peps - local launcher
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

rem --- 2. .env present? (created automatically with working local defaults) ---
if exist ".env" goto :envok
if not exist ".env.example" (
  echo  [X] .env.example is missing. Re-download the project.
  goto :fail
)
node scripts\init-env.mjs
if errorlevel 1 (
  echo  [X] Could not create .env. See the error above.
  goto :fail
)
echo  [ok] Created .env. Login password is peps1234 - change it in Settings.
goto :envdone
:envok
echo  [ok] .env found
:envdone

rem --- 2b. Data folder for the SQLite database ---
if exist "data\" goto :dataok
mkdir "data"
if errorlevel 1 (
  echo  [X] Could not create the data folder.
  goto :fail
)
:dataok
echo  [ok] Data folder: %CD%\data

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
  echo  [X] Database migration failed. Check DATABASE_URL in .env.
  goto :fail
)
echo  [ok] Database ready

rem --- 5. Open the browser once the app answers, then start the dev server ---
echo.
echo  Starting. Admin: http://localhost:3000/admin   Store: http://localhost:3000  (close this window to stop it)
echo.
start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "for($i=0;$i -lt 180;$i++){ try { Invoke-WebRequest -Uri 'http://localhost:3000/admin/login' -UseBasicParsing -TimeoutSec 2 | Out-Null; Start-Process 'http://localhost:3000/admin'; break } catch { Start-Sleep -Seconds 1 } }"

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
