#!/bin/sh
set -e

echo "=== Alpha Bot Startup ==="

# Run volume initialization
node /app/init-volume.js

# Start the main bot
echo "Starting bot..."
exec node /app/index.js
