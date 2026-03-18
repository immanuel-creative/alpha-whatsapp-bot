#!/bin/sh
node /app/init-volume.js 2>/dev/null || true
while true; do
  node /app/index.js
  echo "Restarting in 5s..."
  sleep 5
done
