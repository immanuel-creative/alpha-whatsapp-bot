#!/bin/sh

echo "=== Alpha Bot Startup ==="

# Run volume initialization (don't fail if it errors)
node /app/init-volume.js || echo "⚠️  Init script failed, continuing anyway..."

# Start the main bot with auto-restart on crash
# This prevents the entire container from dying when Node.js crashes
echo "Starting bot (with auto-restart on crash)..."
while true; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting node index.js..."
  node --max-old-space-size=512 /app/index.js
  EXIT_CODE=$?
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] Bot exited with code $EXIT_CODE"
  
  if [ $EXIT_CODE -eq 0 ]; then
    echo "Clean exit, not restarting"
    exit 0
  fi
  
  echo "Bot crashed or was killed. Restarting in 5 seconds..."
  sleep 5
done
