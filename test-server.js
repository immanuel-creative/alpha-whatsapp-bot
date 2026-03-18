#!/usr/bin/env node
const express = require('express');
const app = express();

console.log('[TEST] Starting minimal test server');

app.get('/api/status', (req, res) => {
  console.log('[TEST] Health check requested');
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

const port = process.env.PORT || 3000;
console.log(`[TEST] Attempting to listen on port ${port}...`);

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[TEST] ✅ Successfully listening on port ${port}`);
  console.log(`[TEST] Test server ready for requests`);
});

server.on('error', (err) => {
  console.error(`[TEST] ❌ Server error:`, err.message);
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  console.error(`[TEST] Uncaught exception:`, err);
});

process.on('unhandledRejection', (err) => {
  console.error(`[TEST] Unhandled rejection:`, err);
});

console.log('[TEST] Setup complete - waiting for requests...');
