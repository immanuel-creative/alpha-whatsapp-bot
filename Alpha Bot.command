#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║     ALPHA HUB — FIXING & STARTING...     ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Kill anything that might be stuck ────────────────
echo "  Cleaning up old processes..."
pkill -f "chromium" 2>/dev/null
pkill -f "chrome" 2>/dev/null
pkill -f "puppeteer" 2>/dev/null
pkill -f "node index.js" 2>/dev/null
pkill -f ngrok 2>/dev/null
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 2

# ── Step 2: Remove Chrome lock files ─────────────────────────
echo "  Removing lock files..."
find .wwebjs_auth -name "SingletonLock" -delete 2>/dev/null
find .wwebjs_auth -name "SingletonCookie" -delete 2>/dev/null
find .wwebjs_auth -name "SingletonSocket" -delete 2>/dev/null
sleep 1

# ── Step 3: Check Node ────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo "  ERROR: Node.js not found."
  echo "  Please run 'SETUP (Mac - Run First).command' first."
  echo ""
  read -p "  Press Enter to close..."
  exit 1
fi

# ── Step 4: Install npm deps if needed ───────────────────────
if [ ! -d "node_modules" ]; then
  echo "  Installing app dependencies..."
  npm install --silent
fi

# ── Step 5: Write clean domain file (no hidden characters) ───
printf 'intercystic-dandily-tori.ngrok-free.dev' > .ngrok-domain
NGROK_DOMAIN="intercystic-dandily-tori.ngrok-free.dev"

# ── Step 6: Start the bot ─────────────────────────────────────
echo "  Starting Alpha Hub bot..."
node index.js > /tmp/alpha-bot.log 2>&1 &
BOT_PID=$!

# ── Step 7: Wait for dashboard to be ready ───────────────────
echo "  Waiting for bot to start (up to 30 seconds)..."
STARTED=false
for i in {1..30}; do
  sleep 1
  if curl -s http://localhost:3000/api/status >/dev/null 2>&1; then
    STARTED=true
    break
  fi
  if ! kill -0 $BOT_PID 2>/dev/null; then
    echo ""
    echo "  ERROR: Bot crashed on startup. Log:"
    tail -10 /tmp/alpha-bot.log
    echo ""
    read -p "  Press Enter to close..."
    exit 1
  fi
done

if [ "$STARTED" = false ]; then
  echo "  ERROR: Bot did not start in time. Log:"
  tail -10 /tmp/alpha-bot.log
  read -p "  Press Enter to close..."
  exit 1
fi

# ── Step 8: Start ngrok tunnel ───────────────────────────────
echo "  Opening ngrok tunnel..."
ngrok http 3000 --domain="$NGROK_DOMAIN" --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!
sleep 6

# Verify ngrok is actually connected
NGROK_CHECK=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1)
if [ -z "$NGROK_CHECK" ]; then
  echo "  WARNING: ngrok may not have connected. Check /tmp/ngrok.log"
fi

PUBLIC_URL="https://${NGROK_DOMAIN}"

# ── Step 9: Show result ───────────────────────────────────────
clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║         ALPHA HUB IS LIVE!               ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  ─────────────────────────────────────────────"
echo "  STEP 1 — WhatsApp QR (scan on first run):"
echo "     ${PUBLIC_URL}/qr"
echo ""
echo "  STEP 2 — Dashboard (share with your team):"
echo "     ${PUBLIC_URL}"
echo "  ─────────────────────────────────────────────"
echo ""
echo "  KEEP THIS WINDOW OPEN — closing stops the bot."
echo "  Press Ctrl+C when you want to stop."
echo ""

open "${PUBLIC_URL}/qr" 2>/dev/null

wait $BOT_PID
kill $NGROK_PID 2>/dev/null
