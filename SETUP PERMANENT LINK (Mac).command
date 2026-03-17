#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

clear
echo ""
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║     ALPHA HUB — PERMANENT LINK SETUP         ║"
echo "  ╚══════════════════════════════════════════════╝"
echo ""
echo "  This sets up a FREE permanent public link"
echo "  so your team can access the dashboard anywhere."
echo ""

# ── Step 1: Install Homebrew if needed ───────────────────────
if ! command -v brew &>/dev/null; then
  echo "  [1/4] Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  export PATH="/opt/homebrew/bin:$PATH"
else
  echo "  [1/4] Homebrew ✓"
fi

# ── Step 2: Install ngrok ─────────────────────────────────
echo "  [2/4] Installing ngrok..."
if ! command -v ngrok &>/dev/null; then
  brew install ngrok/ngrok/ngrok
fi
echo "  ngrok ✓"

# ── Step 3: Get auth token ────────────────────────────────
echo ""
echo "  [3/4] Connect your free ngrok account"
echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  1. Go to:  https://dashboard.ngrok.com     │"
echo "  │  2. Sign up FREE (just email + password)    │"
echo "  │  3. After login, go to:                     │"
echo "  │     https://dashboard.ngrok.com/get-started │"
echo "  │  4. Copy your auth token (long string)      │"
echo "  └─────────────────────────────────────────────┘"
echo ""
read -p "  Paste your ngrok auth token here and press Enter: " NGROK_TOKEN

if [ -z "$NGROK_TOKEN" ]; then
  echo ""
  echo "  ❌ No token entered. Please run this again after signing up."
  read -p "  Press Enter to close..."
  exit 1
fi

ngrok config add-authtoken "$NGROK_TOKEN"

# ── Step 4: Claim free static domain ─────────────────────
echo ""
echo "  [4/4] Getting your permanent URL..."
echo ""
echo "  ┌─────────────────────────────────────────────────┐"
echo "  │  ngrok gives you 1 FREE permanent domain.       │"
echo "  │                                                  │"
echo "  │  To claim it:                                    │"
echo "  │  1. Go to https://dashboard.ngrok.com/domains   │"
echo "  │  2. Click 'New Domain' → it generates a free    │"
echo "  │     permanent URL like:                          │"
echo "  │     something-catchy.ngrok-free.app              │"
echo "  │  3. Copy that domain name                        │"
echo "  └─────────────────────────────────────────────────┘"
echo ""
read -p "  Paste your ngrok domain (e.g. something.ngrok-free.app): " NGROK_DOMAIN

# Save the domain for the start script
if [ -n "$NGROK_DOMAIN" ]; then
  echo "$NGROK_DOMAIN" > .ngrok-domain
  echo ""
  echo "  ✅ Saved! Your permanent link will be:"
  echo ""
  echo "  📊 DASHBOARD:  https://${NGROK_DOMAIN}"
  echo "  📱 QR SCAN:    https://${NGROK_DOMAIN}/qr"
  echo ""
  echo "  These links NEVER change."
  echo "  Bookmark them and share with your team!"
else
  echo ""
  echo "  Skipped domain setup. You can run this again to add it."
fi

echo ""
echo "  ✅ Setup complete! Now run:"
echo "     'START BOT WITH PUBLIC URL (Mac).command'"
echo ""
read -p "  Press Enter to close..."
