#!/bin/bash
cd "$(dirname "$0")"

echo ""
echo "============================================"
echo "  ALPHA BOT + DASHBOARD — Starting..."
echo "============================================"
echo ""
echo "Once started, the bot will show:"
echo "  📊 Dashboard URL  (open on any phone/laptop)"
echo "  📱 QR code to scan with WhatsApp Business"
echo ""
echo "To stop: press Ctrl + C"
echo "============================================"
echo ""

node index.js
