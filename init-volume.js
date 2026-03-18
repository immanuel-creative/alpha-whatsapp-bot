#!/usr/bin/env node
// Initialize the volume with data files if they don't exist
const fs = require('fs');
const path = require('path');

const volumeDir = '/app/data';
const gitDir = path.join(__dirname, 'data');

const files = ['clients.json', 'invoice-counter.json', 'invoiced-messages.json'];

console.error('\n⏳ [INIT] Initializing volume at', volumeDir);
console.error('[INIT] Git data directory:', gitDir);

// Create directory if it doesn't exist
if (!fs.existsSync(volumeDir)) {
  fs.mkdirSync(volumeDir, { recursive: true });
  console.log('✓ Created', volumeDir);
}

// Copy data files
files.forEach(file => {
  const volumePath = path.join(volumeDir, file);
  const gitPath = path.join(gitDir, file);
  
  if (!fs.existsSync(volumePath) && fs.existsSync(gitPath)) {
    try {
      const data = fs.readFileSync(gitPath, 'utf8');
      fs.writeFileSync(volumePath, data, 'utf8');
      console.error(`[INIT] ✓ Initialized ${file}`);
    } catch (e) {
      console.error(`[INIT] ✗ Failed to copy ${file}:`, e.message);
    }
  } else if (fs.existsSync(volumePath)) {
    console.error(`[INIT] ✓ ${file} already exists on volume`);
  } else {
    console.error(`[INIT] ? ${file} source not found, will be created on first use`);
  }
});

// Ensure invoices directory exists
const invoicesDir = path.join(volumeDir, 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
  console.error('[INIT] ✓ Created invoices directory');
}

console.error('[INIT] ✓ Volume initialization complete\n');
