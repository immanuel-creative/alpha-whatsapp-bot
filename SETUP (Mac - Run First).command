#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "  ALPHA BOT - FIRST TIME SETUP"
echo "============================================"
echo ""
echo "Installing components (2-5 min)..."
echo "Please keep this window open!"
echo ""

npm install

if [ $? -ne 0 ]; then
  echo ""
  echo "ERROR: Install failed."
  echo "Make sure Node.js is installed from https://nodejs.org"
  echo ""
  read -p "Press Enter to close..."
  exit 1
fi

echo ""
echo "============================================"
echo "  SETUP COMPLETE!"
echo "============================================"
echo ""
echo "From now on, just double-click:"
echo "  'START BOT (Mac).command'"
echo ""
echo "Starting now for the first time..."
echo ""

node index.js
