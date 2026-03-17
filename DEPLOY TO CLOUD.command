#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.railway/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

clear
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║     ALPHA HUB — CLOUD DEPLOY         ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# ── Step 1: Install Railway CLI ──────────────────────────────────
echo "  [1/5] Installing Railway..."
curl -fsSL https://railway.app/install.sh | sh 2>/dev/null
export PATH="$HOME/.railway/bin:$PATH"

if ! command -v railway &>/dev/null; then
  sudo npm install -g @railway/cli 2>/dev/null
fi

if ! command -v railway &>/dev/null; then
  echo "  ERROR: Could not install Railway. Please screenshot and send to Immanuel."
  read -p "  Press Enter to close..."
  exit 1
fi
echo "  Railway ready."
echo ""

# ── Step 2: Login ────────────────────────────────────────────────
echo "  [2/5] Opening Railway login in your browser..."
echo "        Sign up free, then click Authorize and come back here."
echo ""
railway login
echo "  Logged in."
echo ""

# ── Step 3: Create or link project ───────────────────────────────
echo "  [3/5] Setting up your cloud project..."
echo "        If asked for a name — type: alpha-hub"
echo ""
railway init
echo "  Project ready."
echo ""

# ── Step 4: Set environment variables ────────────────────────────
echo "  [4/5] Uploading your settings securely..."
echo ""

# Read API key from .env file
if [ -f ".env" ]; then
  ANTHROPIC_KEY=$(grep ANTHROPIC_API_KEY .env | cut -d'=' -f2)
  if [ -n "$ANTHROPIC_KEY" ]; then
    railway variables set ANTHROPIC_API_KEY="$ANTHROPIC_KEY"
    echo "  API key set."
  fi
fi

railway variables set NODE_ENV=production
railway variables set PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
railway variables set WWEBJS_AUTH_PATH=/app/.wwebjs_auth
echo "  Settings uploaded."
echo ""

# ── Step 5: Deploy ───────────────────────────────────────────────
echo "  [5/5] Uploading to the cloud (3-5 min, please wait)..."
echo ""
railway up --detach

if [ $? -ne 0 ]; then
  echo ""
  echo "  ERROR: Upload failed. Screenshot this and send to Immanuel."
  read -p "  Press Enter to close..."
  exit 1
fi

# Get the app URL
APP_URL=$(railway domain 2>/dev/null | grep -o 'https://[^ ]*' | head -1)

clear
echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║        YOUR BOT IS IN THE CLOUD!     ║"
echo "  ╚══════════════════════════════════════╝"
echo ""
if [ -n "$APP_URL" ]; then
  echo "  Your URL: ${APP_URL}"
  echo ""
  echo "  LAST STEP — Connect WhatsApp:"
  echo "  Open this in your browser:"
  echo "  ${APP_URL}/qr"
  echo ""
  echo "  Scan the QR with WhatsApp Business."
  echo "  Done! The bot runs 24/7 from now on."
else
  echo "  Deployed! Now go to railway.app to get your URL."
  echo "  Open your URL + /qr and scan the WhatsApp QR."
fi
echo ""
echo "  IMPORTANT — To keep data saved between restarts:"
echo "  1. Go to railway.app → your project"
echo "  2. Click your service → Volumes"
echo "  3. Add volume: mount path = /app/data"
echo "  4. Add volume: mount path = /app/.wwebjs_auth"
echo ""
read -p "  Press Enter to close..."
