#!/bin/sh

echo "=== Alpha Bot Startup ==="

# Run volume initialization (don't fail if it errors)
node /app/init-volume.js || echo "⚠️  Init script failed, continuing anyway..."

# Start the main bot
echo "Starting bot..."
exec node /app/index.js
