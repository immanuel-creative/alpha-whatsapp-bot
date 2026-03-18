#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "=== Syncing local data to Railway ==="
echo ""

# Check data
echo "📊 Local data:"
python3 -c "
import json, os
c = json.load(open('data/clients.json'))
print(f'  Clients: {len(c)}')
counter = json.load(open('data/invoice-counter.json'))
print(f'  Next invoice: #{counter[\"next\"]}')
inv = json.load(open('data/invoiced-messages.json'))
print(f'  Processed messages: {len(inv)}')
files = [f for f in os.listdir('data/invoices/') if f.endswith('.png') or f.endswith('.pdf')]
print(f'  Invoice files: {len(files)}')
"

echo ""
echo "📦 Adding data files to git..."
git add -f data/clients.json data/invoice-counter.json data/invoiced-messages.json
git commit -m "Seed Railway with existing client data" || echo "(nothing new to commit)"

echo ""
echo "🚀 Deploying to Railway..."
/usr/local/bin/railway up --detach

echo ""
echo "⏳ Waiting 90 seconds for deploy to finish..."
sleep 90

echo ""
echo "✅ Checking Railway:"
curl -s https://hopeful-enthusiasm-production-4b84.up.railway.app/api/status
echo ""
curl -s https://hopeful-enthusiasm-production-4b84.up.railway.app/api/clients | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'{len(d)} clients now on Railway')"
echo ""
echo "Done! Open https://hopeful-enthusiasm-production-4b84.up.railway.app to see your dashboard."
