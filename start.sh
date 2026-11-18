#!/bin/bash

# GGE BOT - Linux/macOS Startup
echo "==================================================="
echo "               GGE BOT Starting...                  "
echo "==================================================="
echo

# Check Node.js installation
if ! command -v node &> /dev/null; then
    echo -e "\033[0;31m[ERROR] Node.js is not detected on your system!\033[0m"
    echo
    echo "Node.js is required to run the bot."
    echo "Please download and install it from:"
    echo "https://nodejs.org/en/download/current"
    echo
    if [[ "$OSTYPE" == "darwin"* ]]; then
        open "https://nodejs.org/en/download/current"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v xdg-open &> /dev/null; then
            xdg-open "https://nodejs.org/en/download/current"
        fi
    fi
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo -e "\033[1;33m[WARNING] Core dependencies not found!\033[0m"
    echo "Please run ./install.sh first to install all dependencies and build the dashboard."
    exit 1
fi

# Check if website build exists
if [ ! -d "website/build" ]; then
    echo -e "\033[1;33m[WARNING] Dashboard build files not found!\033[0m"
    echo "Please run ./install.sh to compile and build the dashboard."
    exit 1
fi

echo "Starting main application..."
node main.js
if [ $? -ne 0 ]; then
    echo
    echo -e "\033[0;31m[ERROR] Bot exited with an error or was stopped.\033[0m"
    exit 1
fi
