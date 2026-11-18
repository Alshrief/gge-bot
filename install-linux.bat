@echo off
title GGE BOT - Installation Setup
color 0B

echo ===================================================
echo             GGE BOT Installation Setup            
echo ===================================================
echo.
echo [IMPORTANT] This script will perform a complete installation:
echo  1. Verify Node.js environment
echo  2. Setup addons-extra repository
echo  3. Install core dependencies
echo  4. Install website dependencies and build dashboard
echo.

:: Step 1: Check Node.js installation
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

:: Step 3: Install root dependencies
echo [3/4] Installing core dependencies (this may take a minute)...
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Failed to install core dependencies.
    pause
    exit /b 1
)
echo.

:: Step 4: Install and build website dependencies
echo [4/4] Installing and building dashboard website...
if not exist website (
    color 0C
    echo [ERROR] Directory 'website' not found!
    pause
    exit /b 1
)
cd website
echo Installing website packages...
call npm install
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Failed to install website dependencies.
    cd ..
    pause
    exit /b 1
)
echo Building dashboard assets (Vite)...
call npm run build
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Failed to build website assets.
    cd ..
    pause
    exit /b 1
)
cd ..
echo.

color 0A
echo ===================================================
echo   Installation completed successfully!
echo   You can now start the bot using "start.bat".
echo ===================================================
echo.
pause
