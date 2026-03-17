#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       ALPHA HUB — STARTING UP...         ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Check Node ───────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  ❌ Node.js not found."
  echo "     Please run 'SETUP (Mac - Run First).command' first."
  read -p "  Press Enter to close..."; exit 1
fi

# ── Install npm deps if needed ───────────────────────────
if [ ! -d "node_modules" ]; then
  echo "  Installing app..."
  npm install --silent
fi

# ── Kill anything on port 3000 ───────────────────────────
lsof -ti:3000 | xargs kill -9 2>/dev/null
pkill -f ngrok 2>/dev/null
sleep 1

# ── Start the bot ────────────────────────────────────────
echo "  Starting Alpha Hub bot..."
node index.js > /tmp/alpha-bot.log 2>&1 &
BOT_PID=$!

# ── Wait for dashboard to be ready ───────────────────────
echo "  Waiting for dashboard..."
for i in {1..20}; do
  sleep 1
  if curl -s http://localhost:3000/api/status >/dev/null 2>&1; then
    break
  fi
done

# ── Start ngrok tunnel ───────────────────────────────────
DOMAIN_FILE=".ngrok-domain"

if [ -f "$DOMAIN_FILE" ]; then
  NGROK_DOMAIN=$(cat "$DOMAIN_FILE" | tr -d '[:space:]')
fi

echo ""
if [ -n "$NGROK_DOMAIN" ]; then
  echo "  Opening tunnel to your permanent URL..."
  ngrok http 3000 --domain="$NGROK_DOMAIN" --log=stdout > /tmp/ngrok.log 2>&1 &
  NGROK_PID=$!
  sleep 5
  PUBLIC_URL="https://${NGROK_DOMAIN}"
else
  echo "  Opening tunnel (temporary URL)..."
  ngrok http 3000 --log=stdout > /tmp/ngrok.log 2>&1 &
  NGROK_PID=$!
  sleep 6
  PUBLIC_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4)
fi

# ── Show result ──────────────────────────────────────────
clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
if [ -n "$PUBLIC_URL" ]; then
  echo "  ║        🎉 ALPHA HUB IS LIVE!             ║"
else
  echo "  ║   ALPHA HUB RUNNING (local only)         ║"
fi
echo "  ╚══════════════════════════════════════════╝"
echo ""

if [ -n "$PUBLIC_URL" ]; then
  echo "  ─────────────────────────────────────────────"
  echo "  📊 DASHBOARD (share with team):"
  echo "     ${PUBLIC_URL}"
  echo ""
  echo "  📱 SCAN WHATSAPP QR (do this first):"
  echo "     ${PUBLIC_URL}/qr"
  echo "  ─────────────────────────────────────────────"
  echo ""
  # Auto-open QR in browser
  open "${PUBLIC_URL}/qr" 2>/dev/null
else
  echo "  📱 QR (local only):  http://localhost:3000/qr"
  echo "  📊 Dashboard:        http://localhost:3000"
  echo ""
  echo "  ⚠️  Run 'SETUP PERMANENT LINK (Mac).command'"
  echo "     to get a public URL for your team."
  open "http://localhost:3000/qr" 2>/dev/null
fi

echo ""
echo "  ⚠️  KEEP THIS WINDOW OPEN. Closing stops the bot."
echo "  ─────────────────────────────────────────────"
echo ""
echo "  📋 Press Ctrl+C to stop."
echo ""

# Wait for bot process
wait $BOT_PID

# Cleanup
kill $NGROK_PID 2>/dev/null
