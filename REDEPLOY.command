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

# ── Step 1: Make sure Railway CLI is installed ──────────────────
if ! command -v railway &>/dev/null; then
  echo "  Installing Railway CLI..."
  curl -fsSL https://railway.app/install.sh | sh 2>/dev/null
  export PATH="$HOME/.railway/bin:$PATH"
fi

if ! command -v railway &>/dev/null; then
  echo "  ❌ Could not install Railway CLI."
  read -p "  Press Enter to close..."
  exit 1
fi

# ── Step 2: Log in (handles both new and existing accounts) ─────
echo "  Checking Railway login..."
railway whoami 2>/dev/null
if [ $? -ne 0 ]; then
  echo ""
  echo "  ┌─────────────────────────────────────────┐"
  echo "  │  Not logged in. Opening browser to      │"
  echo "  │  sign in or create a new account...     │"
  echo "  └─────────────────────────────────────────┘"
  echo ""
  railway login
  if [ $? -ne 0 ]; then
    echo "  ❌ Login failed."
    read -p "  Press Enter to close..."
    exit 1
  fi
fi

echo ""
echo "  ✅ Logged in as: $(railway whoami 2>/dev/null)"
echo ""

# ── Step 3: Link or create project ─────────────────────────────
if ! railway status &>/dev/null 2>&1; then
  echo "  No project linked. Creating a new one..."
  echo ""
  railway init --name "alpha-bot"
  if [ $? -ne 0 ]; then
    echo "  ❌ Could not create project."
    read -p "  Press Enter to close..."
    exit 1
  fi
fi

# ── Step 4: Deploy ──────────────────────────────────────────────
echo "  Uploading fixes to the cloud..."
echo "  Please wait 3-5 minutes..."
echo ""

railway up --detach

if [ $? -ne 0 ]; then
  echo ""
  echo "  ❌ Deploy failed. Screenshot this and send to Immanuel."
  read -p "  Press Enter to close..."
  exit 1
fi

echo ""
echo "  ✅ Deployed successfully!"
echo ""

# ── Step 5: Get the new URL ─────────────────────────────────────
DOMAIN=$(railway domain 2>/dev/null | grep -oE 'https?://[^ ]+' | head -1)

echo "  ⏳ Wait 3-5 minutes for Railway to build, then:"
echo ""
if [ -n "$DOMAIN" ]; then
  echo "  SCAN WhatsApp QR:"
  echo "  $DOMAIN/qr"
  echo ""
  echo "  VIEW DASHBOARD:"
  echo "  $DOMAIN"
else
  echo "  Go to railway.app → your project → find your domain"
  echo "  Then open: yourdomain.railway.app/qr to scan WhatsApp"
fi
echo ""
echo "  ⚠️  IMPORTANT: After deploy, you need to scan the WhatsApp"
echo "  QR code again since this is a fresh deployment."
echo ""
read -p "  Press Enter to close..."
