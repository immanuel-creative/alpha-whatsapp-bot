#!/usr/bin/env node
// Initialize the volume with data files if they don't exist
const fs = require('fs');
const path = require('path');

const volumeDir = '/app/data';
const gitDir = path.join(__dirname, 'data');

const files = ['clients.json', 'invoice-counter.json', 'invoiced-messages.json'];

console.log('Initializing volume at', volumeDir);

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
      console.log(`✓ Initialized ${file}`);
    } catch (e) {
      console.error(`✗ Failed to copy ${file}:`, e.message);
    }
  } else if (fs.existsSync(volumePath)) {
    console.log(`✓ ${file} already exists on volume`);
  } else {
    console.log(`? ${file} source not found, will be created on first use`);
  }
});

// Ensure invoices directory exists
const invoicesDir = path.join(volumeDir, 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
  console.log('✓ Created invoices directory');
}

console.log('✓ Volume initialization complete\n');
