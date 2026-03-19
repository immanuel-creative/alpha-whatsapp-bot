#!/bin/bash
# Seed data files (clients.json etc) on first run
node /app/init-volume.js 2>/dev/null || true

# Ensure the WhatsApp auth directory exists inside the persistent volume
mkdir -p /app/data/session-alpha-bot 2>/dev/null || true

# Run bot — restart automatically on crash
while :; do
  node /app/index.js || true
  echo "[start.sh] Bot exited — restarting in 3s..."
  sleep 3
done
