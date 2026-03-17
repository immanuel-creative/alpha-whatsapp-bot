#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.railway/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

clear
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     ALPHA HUB — REDEPLOYING...       ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
echo "  Uploading fixes to the cloud..."
echo "  Please wait 3-5 minutes..."
echo ""

railway up --detach

if [ $? -ne 0 ]; then
  echo ""
  echo "  ❌ Failed. Screenshot this and send to Immanuel."
  read -p "  Press Enter to close..."
  exit 1
fi

echo ""
echo "  ✅ Done! Your app has been updated."
echo ""
echo "  ⏳ Wait 3-5 minutes for Railway to rebuild, then:"
echo ""
echo "  SCAN WhatsApp QR:"
echo "  https://alpha-app-production.up.railway.app/qr"
echo ""
echo "  VIEW DASHBOARD:"
echo "  https://alpha-app-production.up.railway.app"
echo ""
echo "  (The dashboard loads even before WhatsApp connects.)"
echo ""
read -p "  Press Enter to close..."
