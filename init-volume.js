#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DATA_DIR = '/app/data';
const SEED_DIR = '/app/data_seed';

console.log('🌱 Initializing volume data...');

// Ensure /app/data exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  console.log('Created /app/data directory');
}

// Files to seed from data_seed to data
const seedFiles = ['clients.json', 'invoice-counter.json', 'invoiced-messages.json'];

for (const file of seedFiles) {
  const dest = path.join(DATA_DIR, file);
  const src = path.join(SEED_DIR, file);
  
  // Only copy if destination doesn't exist OR is empty/invalid
  let needsSeed = false;
  if (!fs.existsSync(dest)) {
    needsSeed = true;
    console.log(`  ${file}: not found → seeding`);
  } else {
    try {
      const content = fs.readFileSync(dest, 'utf8').trim();
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length === 0) {
        needsSeed = true;
        console.log(`  ${file}: empty array → seeding`);
      } else {
        console.log(`  ${file}: exists with data (${Array.isArray(parsed) ? parsed.length + ' items' : typeof parsed}) → keeping`);
      }
    } catch {
      needsSeed = true;
      console.log(`  ${file}: invalid JSON → seeding`);
    }
  }
  
  if (needsSeed && fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    const content = JSON.parse(fs.readFileSync(dest, 'utf8'));
    console.log(`  ✅ Seeded ${file} (${Array.isArray(content) ? content.length + ' items' : 'ok'})`);
  } else if (needsSeed && !fs.existsSync(src)) {
    console.log(`  ⚠️  No seed file for ${file} — skipping`);
  }
}

// Ensure invoices directory exists
const invoicesDir = path.join(DATA_DIR, 'invoices');
if (!fs.existsSync(invoicesDir)) {
  fs.mkdirSync(invoicesDir, { recursive: true });
  console.log('Created /app/data/invoices directory');
}

console.log('✅ Volume initialization complete\n');
