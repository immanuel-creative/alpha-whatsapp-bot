#!/usr/bin/env node
console.log('[TEST] Starting minimal test server...');

const express = require('express');
const app = express();

app.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[TEST] Server listening on port ${port}`);
});

server.on('error', (err) => {
  console.error(`[TEST] Server error: ${err.message}`);
});

// Keep alive
setInterval(() => {
  console.log(`[TEST] Still alive on port ${port}`);
}, 10000);
