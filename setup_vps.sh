#!/bin/bash

# GGE BOT - Linux VPS Setup & Service Installer
# Designed for Debian/Ubuntu-based Linux distributions

# Text Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}===================================================${NC}"
echo -e "${BLUE}        GGE BOT VPS Installation & Service Configurator     ${NC}"
echo -e "${BLUE}===================================================${NC}"
echo

# 1. Check if running with sudo/root privileges
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}[ERROR] Please run this script with sudo or as root!${NC}"
    echo "Example: sudo ./setup_vps.sh"
    exit 1
fi

# Detect original user who invoked sudo
REAL_USER=${SUDO_USER:-$(whoami)}
REAL_HOME=$(eval echo ~$REAL_USER)
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${GREEN}[*] Detected user:${NC} $REAL_USER"
echo -e "${GREEN}[*] Bot directory:${NC} $BOT_DIR"
echo

# 2. Update System Packages
echo -e "${YELLOW}[1/5] Updating package lists...${NC}"
apt-get update -y
if [ $? -ne 0 ]; then
    echo -e "${RED}[WARNING] Failed to update package list. Attempting to proceed...${NC}"
fi

# Install dependencies (curl, git, build-essential)
echo -e "${YELLOW}[*] Installing system tools (curl, git, build-essential)...${NC}"
apt-get install -y curl git build-essential
if [ $? -ne 0 ]; then
    echo -e "${RED}[WARNING] Failed to install some system tools. Proceeding...${NC}"
fi

# 3. Install Node.js v22 (Required for node:sqlite)
echo -e "${YELLOW}[2/5] Checking Node.js installation...${NC}"
NODE_NEED_INSTALL=true
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 22 ]; then
        NODE_NEED_INSTALL=false
        echo -e "${GREEN}[*] Node.js is already installed (v$(node -v)) which meets the requirement (v22+).${NC}"
    else
        echo -e "${YELLOW}[!] Current Node.js version (v$(node -v)) is less than v22.${NC}"
        echo "Upgrading Node.js to v22..."
    fi
fi

if [ "$NODE_NEED_INSTALL" = true ]; then
    echo -e "${YELLOW}[*] Downloading Node.js v22 setup script from NodeSource...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Failed to download Node.js setup script. Please install Node.js v22 manually.${NC}"
        exit 1
    fi

    echo -e "${YELLOW}[*] Installing Node.js & npm...${NC}"
    apt-get install -y nodejs
    if [ $? -ne 0 ] || ! command -v node &> /dev/null; then
        echo -e "${RED}[ERROR] Node.js installation failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}[*] Node.js successfully installed: $(node -v)${NC}"
fi

# 4. Check for addons-extra directory
# Some users manually upload it, check or clone if git is configured
if [ ! -d "$BOT_DIR/addons-extra" ]; then
    echo -e "${YELLOW}[*] 'addons-extra' folder not found. Checking git...${NC}"
    if [ -d "$BOT_DIR/.git" ] && command -v git &> /dev/null; then
        echo -e "${YELLOW}[*] Attempting to initialize submodules if any...${NC}"
        cd "$BOT_DIR"
        sudo -u "$REAL_USER" git submodule update --init --recursive
    else
        echo -e "${YELLOW}[!] Note: 'addons-extra' is not present. If you have premium addons, transfer them to this folder manually.${NC}"
    fi
fi

# 5. Install Bot Dependencies
echo -e "${YELLOW}[3/5] Installing Bot core dependencies (this may take a minute)...${NC}"
cd "$BOT_DIR"
# Make files owned by real user so they don't lock as root
chown -R "$REAL_USER":"$REAL_USER" "$BOT_DIR"

# Run npm install as the original user
sudo -u "$REAL_USER" npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Core dependencies installation failed.${NC}"
    exit 1
fi
echo -e "${GREEN}[*] Core dependencies installed successfully.${NC}"

# Install and build website dependencies
echo -e "${YELLOW}[4/5] Building dashboard website...${NC}"
if [ -d "$BOT_DIR/website" ]; then
    cd "$BOT_DIR/website"
    sudo -u "$REAL_USER" npm install
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Website dependencies installation failed.${NC}"
        exit 1
    fi
    echo -e "${YELLOW}[*] Compiling dashboard assets...${NC}"
    sudo -u "$REAL_USER" npm run build
    if [ $? -ne 0 ]; then
        echo -e "${RED}[ERROR] Website compilation failed.${NC}"
        exit 1
    fi
    echo -e "${GREEN}[*] Dashboard website built successfully.${NC}"
else
    echo -e "${RED}[ERROR] 'website' directory not found!${NC}"
    exit 1
fi

# 6. Create systemd Service File
echo -e "${YELLOW}[5/5] Configuring systemd service...${NC}"
SERVICE_FILE="/etc/systemd/system/ggebot.service"
NODE_PATH=$(which node)

cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=GGE Bot Service
After=network.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$BOT_DIR
ExecStart=$NODE_PATH main.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=ggebot

[Install]
WantedBy=multi-user.target
EOF

echo -e "${GREEN}[*] Service file created at ${SERVICE_FILE}${NC}"

# Reload systemd, enable and start service
echo -e "${YELLOW}[*] Activating and starting ggebot service...${NC}"
systemctl daemon-reload
systemctl enable ggebot.service
systemctl start ggebot.service

# Check service status
sleep 2
if systemctl is-active --quiet ggebot.service; then
    echo -e "${GREEN}===================================================${NC}"
    echo -e "${GREEN}      GGE BOT Setup & Startup Completed Successfully!${NC}"
    echo -e "${GREEN}===================================================${NC}"
    echo -e "The bot is now running in the background as a systemd service."
    echo
    echo -e "Useful Commands:"
    echo -e " - View bot status:  ${BLUE}sudo systemctl status ggebot.service${NC}"
    echo -e " - Stop the bot:      ${BLUE}sudo systemctl stop ggebot.service${NC}"
    echo -e " - Start the bot:     ${BLUE}sudo systemctl start ggebot.service${NC}"
    echo -e " - Restart the bot:   ${BLUE}sudo systemctl restart ggebot.service${NC}"
    echo -e " - View live logs:    ${BLUE}sudo journalctl -u ggebot.service -f${NC}"
    echo
    echo -e "${YELLOW}Important Notes:${NC}"
    echo -e "1. Make sure to open port ${GREEN}3001${NC} (or your custom webPort in ggeConfig.json) in your VPS firewall."
    echo -e "   For UFW: ${BLUE}sudo ufw allow 3001${NC}"
    echo -e "2. If you need to edit configuration, edit ${BLUE}$BOT_DIR/ggeConfig.json${NC} and restart the service."
else
    echo -e "${RED}[ERROR] GGE BOT service failed to start.${NC}"
    echo -e "Check logs using: ${BLUE}sudo journalctl -u ggebot.service -n 50${NC}"
fi
