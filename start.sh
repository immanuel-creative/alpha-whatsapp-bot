#!/bin/bash
node /app/init-volume.js 2>/dev/null || true
while :; do
  node /app/index.js || true
  sleep 2
done
