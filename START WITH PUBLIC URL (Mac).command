#!/bin/bash
cd "$(dirname "$0")"

export PATH="/usr/local/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$HOME/.railway/bin:$PATH"
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && source "$NVM_DIR/nvm.sh"

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   ALPHA HUB — PUBLIC DASHBOARD START     ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# ── Check Node ─────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "  ❌ Node.js not found."
  echo "     Please run 'SETUP (Mac - Run First).command' first."
  echo ""
  read -p "  Press Enter to close..."
  exit 1
fi

# ── Install npm deps if needed ────────────────────────────────
if [ ! -d "node_modules" ]; then
  echo "  Installing app..."
  npm install --silent
fi

# ── Install cloudflared if needed ────────────────────────────
echo "  Checking for tunnel tool..."
if ! command -v cloudflared &>/dev/null; then
  echo ""
  echo "  Installing cloudflared (one-time, takes ~1 min)..."

  if ! command -v brew &>/dev/null; then
    echo "  First installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    export PATH="/opt/homebrew/bin:$PATH"
  fi

  brew install cloudflare/cloudflare/cloudflared 2>&1 | tail -3
fi

if ! command -v cloudflared &>/dev/null; then
  echo ""
  echo "  ⚠️  cloudflared not available. Starting locally only..."
  echo ""
  # Fall back to local-only start
  lsof -ti:3000 | xargs kill -9 2>/dev/null
  node index.js
  exit 0
fi

echo "  ✅ Tunnel tool ready!"
echo ""

# ── Kill anything on port 3000 ────────────────────────────────
lsof -ti:3000 | xargs kill -9 2>/dev/null
sleep 1

# ── Start the bot ─────────────────────────────────────────────
echo "  Starting Alpha Hub..."
node index.js &
BOT_PID=$!

# Wait up to 15s for dashboard to respond
echo "  Waiting for dashboard..."
for i in {1..15}; do
  sleep 1
  if curl -s http://localhost:3000/api/status >/dev/null 2>&1; then
    echo "  ✅ Dashboard is up!"
    break
  fi
done

# ── Start Cloudflare Tunnel ────────────────────────────────────
echo ""
echo "  Creating your public URL..."
LOGFILE=$(mktemp /tmp/cf-XXXXXX.log)
cloudflared tunnel --url http://localhost:3000 --no-autoupdate > "$LOGFILE" 2>&1 &
CF_PID=$!

# Poll for the trycloudflare URL (up to 20s)
PUBLIC_URL=""
for i in {1..20}; do
  sleep 1
  PUBLIC_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$LOGFILE" 2>/dev/null | head -1)
  if [ -n "$PUBLIC_URL" ]; then break; fi
done

# ── Show result ───────────────────────────────────────────────
clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
if [ -n "$PUBLIC_URL" ]; then
  echo "  ║       🎉 ALPHA HUB IS LIVE!              ║"
else
  echo "  ║   ALPHA HUB RUNNING (local only)         ║"
fi
echo "  ╚══════════════════════════════════════════╝"
echo ""

if [ -n "$PUBLIC_URL" ]; then
  echo "  📱 STEP 1 — Scan WhatsApp QR code:"
  echo "     ➜  ${PUBLIC_URL}/qr"
  echo ""
  echo "  📊 STEP 2 — Share dashboard with team:"
  echo "     ➜  ${PUBLIC_URL}"
  echo ""
  echo "  (These links work on any phone, anywhere!)"
  echo ""
  # Auto-open QR page
  open "${PUBLIC_URL}/qr" 2>/dev/null || true
else
  echo "  📱 Open on this computer:"
  echo "     ➜  http://localhost:3000/qr"
  echo ""
  echo "  (No public URL — tunnel didn't start.)"
  open "http://localhost:3000/qr" 2>/dev/null || true
fi

echo ""
echo "  ──────────────────────────────────────────────"
echo "  ⚠️  KEEP THIS WINDOW OPEN while bot is running."
echo "     Closing this window will stop the bot."
echo "  ──────────────────────────────────────────────"
echo ""
echo "  Press Ctrl+C to stop the bot."
echo ""

# Wait — keep window alive
wait $BOT_PID

# Clean up tunnel when bot stops
kill $CF_PID 2>/dev/null
rm -f "$LOGFILE"
