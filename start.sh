#!/bin/bash
set -e

echo "========================================"
echo "ALPHA BOT STARTUP SCRIPT"
echo "========================================"
echo ""

# Run initialization
echo "Running volume initialization..."
node init-volume.js

# Start the main application
echo ""
echo "Starting Alpha Bot..."
node index.js
