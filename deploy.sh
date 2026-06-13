#!/bin/bash
set -e

UBUNTU_USER="root"                   # change to your Ubuntu username
UBUNTU_IP="192.168.101.205"   # change to your Ubuntu server's IP

echo "→ Pulling latest on Pi..."
cd /home/nextcloud/24game
git pull origin main
npm install --omit=dev
sudo systemctl restart 24game
echo "  Pi done."

echo "→ Deploying to Ubuntu..."
ssh -i ~/.ssh/deploy_key "$UBUNTU_USER@$UBUNTU_IP" "
  cd /opt/24game &&
  git pull origin main &&
  npm install --omit=dev &&
  sudo systemctl restart 24game
"
echo "  Ubuntu done."

echo "All deployed."
