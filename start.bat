@echo off
title GGE BOT - Startup
color 0B

echo ===================================================
echo               GGE BOT Starting...                  
echo ===================================================
echo.

:: Check Node.js installation
where node >nul 2>nul
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is not detected on your system!
    echo Node.js is required to run the bot.
    echo Press any key to open the official Node.js download page...
    pause >nul
    start "" "https://nodejs.org/en/download/current"
    exit /b
)

:: Check if node_modules exists
if not exist node_modules (
    color 0E
    echo [WARNING] Core dependencies not found!
    echo Please run install.bat first to install all dependencies and build the dashboard.
    echo.
    pause
    exit /b
)

:: Check if website build exists
if not exist website\build (
    color 0E
    echo [WARNING] Dashboard build files not found!
    echo Please run install.bat to compile and build the dashboard.
    echo.
    pause
    exit /b
)

echo Starting main application...
node main.js
if %errorlevel% neq 0 (
    color 0C
    echo.
    echo [ERROR] Bot exited with an error or was stopped.
    pause
)
