// ============================================================
//  ALPHA WHATSAPP BOT — Main Entry Point
//  Run with:  node index.js
// ============================================================

console.log('[INIT] Starting Alpha Bot index.js at', new Date().toISOString());
require('dotenv').config();
console.log('[INIT] dotenv loaded');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode   = require('qrcode-terminal');
const cron     = require('node-cron');
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const os       = require('os');

const config   = require('./config');
const parser   = require('./src/parser');
const tracker  = require('./src/tracker');
const msg      = require('./src/messages');
const ai       = require('./src/ai');
const invoice  = require('./src/invoice');

// ─── State ─────────────────────────────────────────────────────

let groupChat    = null;
let botReady     = false;
let dashboardUrl = null;
let latestQR     = null;   // stored so /qr page can show it
let botPaused    = false;  // when true, bot receives but sends NOTHING

// ─── Backlog cache (auto-refreshes every 20 min when bot ready) ─
let backlogCache = null;       // { clients: [], fetchedAt: Date }
let backlogScanRunning = false;

async function runBacklogScan() {
  if (!botReady || !groupChat || backlogScanRunning) return;
  backlogScanRunning = true;
  console.log('[BACKLOG-CACHE] Running background scan...');
  try {
    const now = new Date();
    const klOffset = 8 * 60 * 60 * 1000;
    const startOfTodayKL = new Date(Math.floor((now.getTime() + klOffset) / 86400000) * 86400000 - klOffset);
    const weekAgo = new Date(startOfTodayKL.getTime() - 6 * 24 * 60 * 60 * 1000);
    const sinceTs = Math.floor(weekAgo.getTime() / 1000);

    const messages = await groupChat.fetchMessages({ limit: 2000 });
    const recent = messages.filter(m => m.timestamp >= sinceTs);
    console.log(`[BACKLOG-CACHE] ${recent.length} messages in past 7 days`);

    const merged = new Map();
    for (const m of recent) {
      let clientName, phone, role = '', roleAbbrev = '';
      if (m.type === 'chat' && m.body) {
        const entry = parser.parseClientEntry(m.body);
        if (!entry) continue;
        clientName = entry.clientName; phone = entry.phone;
        role = entry.role || ''; roleAbbrev = entry.roleAbbrev || '';
      } else if (m.type === 'vcard' && m.body) {
        const fnMatch = m.body.match(/^FN:(.+)$/m);
        if (fnMatch) clientName = fnMatch[1].trim();
        const waidMatch = m.body.match(/waid=(\d+)/);
        if (waidMatch) phone = '+' + waidMatch[1];
        else {
          const telMatch = m.body.match(/^TEL[^:]*:([+\d\s\-().]+)/m);
          if (telMatch) { const d = telMatch[1].replace(/[\s\-().]/g, ''); phone = d.startsWith('+') ? d : '+' + d; }
        }
        if (!clientName || !phone) continue;
      } else continue;
      if (!phone) continue;
      const digits = phone.replace(/\D/g, '');
      if (!merged.has(digits)) merged.set(digits, { clientName: clientName || 'Unknown', phone, role, roleAbbrev });
    }

    const chatTexts = recent.filter(m => m.type === 'chat' && m.body && m.body.trim().length > 5).map(m => m.body.trim());
    try {
      const aiResult = await Promise.race([
        ai.extractClientsFromMessages(chatTexts),
        new Promise((_, reject) => setTimeout(() => reject(new Error('AI timeout')), 25000)),
      ]);
      let aiAdded = 0;
      for (const c of aiResult) {
        if (!c.phone) continue;
        const digits = c.phone.replace(/\D/g, '');
        if (!merged.has(digits)) { merged.set(digits, { clientName: c.clientName || 'Unknown', phone: c.phone, role: c.role || '', roleAbbrev: c.roleAbbrev || '' }); aiAdded++; }
      }
      console.log(`[BACKLOG-CACHE] AI added ${aiAdded} extra entries`);
    } catch (err) { console.warn(`[BACKLOG-CACHE] AI skipped: ${err.message}`); }

    const unsent = [];
    for (const [, c] of merged) {
      if (!tracker.getByPhone(c.phone)) unsent.push(c);
    }
    backlogCache = { clients: unsent, fetchedAt: new Date() };
    console.log(`[BACKLOG-CACHE] Done — ${unsent.length} unsent clients cached`);
  } catch (err) {
    console.error('[BACKLOG-CACHE] Error:', err.message);
  } finally {
    backlogScanRunning = false;
  }
}

// Numbers that must never receive any private message from the bot.
// Add full international format without + e.g. '918758836925'
const BLOCKED_NUMBERS = new Set([
  '918758836925', // Annes — hold off per Manny
]);

// Timestamp of when the bot came online — used to ignore backlog messages
// that WhatsApp delivers on reconnect (they were already seen by the team)
const BOT_START_TIME = Math.floor(Date.now() / 1000);



// ─── WhatsApp Client ───────────────────────────────────────────

// Use a path that works both locally (Mac) and in Docker/Railway
const AUTH_PATH = process.env.WWEBJS_AUTH_PATH || path.join(__dirname, '.wwebjs_auth');

console.log('[INIT] Creating WhatsApp client...');
const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'alpha-bot', dataPath: AUTH_PATH }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',        // Critical - prevents OOM crashes
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',                    // Important for containers
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-browser-check',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--mute-audio',
      '--safebrowsing-disable-auto-update',
      '--disable-web-resources',
    ],
  },
});

// ─── QR Code ───────────────────────────────────────────────────

client.on('qr', (qr) => {
  latestQR = qr;
  console.clear();
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║          ALPHA BOT — SCAN TO CONNECT            ║');
  console.log('╚══════════════════════════════════════════════════╝\n');
  qrcode.generate(qr, { small: true });
  console.log('\n📱 OR open the dashboard → /qr to scan from your browser\n');
});

client.on('loading_screen', (pct) => process.stdout.write(`\r⏳ Loading... ${pct}%`));

// ─── Helper: Find Group Chat with Retry Logic ──────────────────

async function findGroupChat() {
  const GROUP_NAME = config.GROUP_NAME;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`[GROUP] Looking for group chat (attempt ${attempt}/5)...`);
      const chats = await Promise.race([
        client.getChats(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('getChats timeout')), 30000))
      ]);
      const found = chats.find(c => c.isGroup && c.name === GROUP_NAME);
      if (found) {
        groupChat = found;
        console.log(`[GROUP] ✅ Found group: "${found.name}"`);
        return true;
      } else {
        console.warn(`[GROUP] Group "${GROUP_NAME}" not found in ${chats.length} chats`);
        return false;
      }
    } catch (err) {
      console.warn(`[GROUP] Attempt ${attempt} failed: ${err.message}`);
      if (attempt < 5) {
        const delay = attempt * 15000; // 15s, 30s, 45s, 60s, 75s
        console.log(`[GROUP] Retrying in ${delay/1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  console.error('[GROUP] Failed to find group after 5 attempts');
  return false;
}

// On-demand: call this at the start of any API endpoint that needs groupChat.
// If groupChat is already set → returns true immediately.
// If botReady but groupChat missing → tries once with 20s timeout.
// If not botReady → returns false.
async function ensureGroupChat() {
  if (groupChat) return true;
  if (!botReady) return false;
  console.log('[GROUP] ensureGroupChat() called on-demand...');
  return await findGroupChat();
}

// ─── Ready ─────────────────────────────────────────────────────

client.on('ready', async () => {
  console.log('\n\n✅ Alpha Bot is online!\n');
  botReady = true;

  try {
    // Try to find group chat with retry logic
    const found = await findGroupChat();

    if (groupChat) {
      console.log(`📍 Monitoring: "${config.GROUP_NAME}"`);
    } else {
      console.error(`\n⚠️  Group "${config.GROUP_NAME}" not found yet. Will retry every 2 minutes...\n`);
      
      // Background retry: check every 2 minutes
      const retryInterval = setInterval(async () => {
        if (groupChat) {
          console.log('[GROUP] ✅ Group found during background retry!');
          clearInterval(retryInterval);
          return;
        }
        if (!botReady) {
          clearInterval(retryInterval);
          return;
        }
        console.log('[GROUP] Background retry: looking for group chat...');
        const ok = await findGroupChat();
        if (ok) clearInterval(retryInterval);
      }, 2 * 60 * 1000);
    }

    cron.schedule(config.MORNING_BRIEFING_CRON, sendMorningBriefing, { timezone: config.TIMEZONE });
    console.log(`⏰ Morning briefing: ${config.MORNING_BRIEFING_CRON} (${config.TIMEZONE})`);
    if (dashboardUrl) console.log(`📊 Dashboard: ${dashboardUrl}\n`);

    // Kick off first backlog scan 30s after ready, then every 20 minutes
    setTimeout(runBacklogScan, 30_000);
    setInterval(runBacklogScan, 20 * 60 * 1000);
  } catch (err) {
    console.error('⚠️  Error in ready handler:', err.message);
    console.log('   Bot is still online, continuing anyway...');
  }
});

// ─── Disconnect ────────────────────────────────────────────────

client.on('disconnected', () => {
  console.warn('\n⚠️  Disconnected — reconnecting in 10s...');
  botReady = false;
  groupChat = null;
  clearBrowserLocks();
  setTimeout(() => {
    try { client.initialize(); } catch (err) {
      console.error('Reconnect failed:', err.message);
    }
  }, 10_000);
});

// ─── Client Error ────────────────────────────────────────────────

client.on('error', (err) => {
  console.error('⚠️  Client error (continuing):', err.message);
});

client.on('auth_failure', () => {
  console.error('⚠️  Auth failure - need to rescan QR');
  botReady = false;
});

// ─── Health Check ──────────────────────────────────────────────
// Runs every 2 minutes. If the Puppeteer browser page has silently
// detached (common after long uptime), the bot appears "ready" but
// can't send or receive anything. We catch this and force a restart.

let healthCheckFailures = 0;

async function runHealthCheck() {
  if (!botReady) return; // Not ready yet — nothing to check
  try {
    // Try a lightweight WhatsApp API call to verify the browser is alive
    await client.getState();
    healthCheckFailures = 0; // Reset on success
  } catch (err) {
    const isDetached = /detached|Frame|context/i.test(err.message);
    const isTimeout  = /timeout|timed out/i.test(err.message);
    if (isDetached || isTimeout) {
      healthCheckFailures++;
      console.warn(`\n⚠️  Health check failed (${healthCheckFailures}/5): ${err.message}`);
      if (healthCheckFailures >= 5) {
        console.warn('🔄 Bot appears frozen — forcing restart...');
        botReady = false;
        groupChat = null;
        healthCheckFailures = 0;
        clearBrowserLocks();
        try { await client.destroy(); } catch {}
        setTimeout(startWhatsApp, 5_000);
      }
    }
  }
}

// Start health check after 5 minutes (give bot time to connect first)
setTimeout(() => {
  setInterval(runHealthCheck, 5 * 60 * 1000); // every 5 minutes
}, 5 * 60 * 1000);

// ─── Messages ──────────────────────────────────────────────────

client.on('message', async (message) => {
  if (!botReady) return;
  try {
    const chat    = await message.getChat();
    const contact = await message.getContact();
    const sender  = contact.pushname || contact.name || message.from;

    if (groupChat && chat.id._serialized === groupChat.id._serialized) {
      await handleGroupMessage(message, sender);
    } else if (!chat.isGroup) {
      await handlePrivateReply(message);
    }
  } catch (err) {
    console.error('Message error:', err.message);
  }
});

// ─── Group Message Handler ─────────────────────────────────────

async function handleGroupMessage(message, senderName) {
  const text = message.body.trim();
  if (!text) return;

  // 1. Salary batch? (e.g. "March month Salary details:\n1.)Gayathri:\n*Jesintha=20000")
  const salaryBatch = invoice.parseSalaryMessage(text);
  if (salaryBatch) {
    await processSalaryBatch(message, salaryBatch, senderName);
    return;
  }

  // 2. Invoice entry? (numbered format 1.Name 2.Address … 7.Date)
  const invoiceEntry = invoice.parseInvoiceMessage(text);
  if (invoiceEntry) {
    await processInvoiceEntry(message, invoiceEntry, senderName);
    return;
  }

  // 3. Client entry?
  const entry = parser.parseClientEntry(text);
  if (entry) { await processClientEntry(message, entry, senderName); return; }

  // 3. Bot command?
  const command = parser.parseCommand(text);
  if (command) { await processCommand(message, command, senderName); return; }

  // 4. Free-text update mentioning a known client?
  await parseFreetextUpdate(text, senderName);
}

// ─── Invoice Auto-Generator ────────────────────────────────────
// Triggered when a numbered 1–7 format message is posted in the group.
// Generates a PDF invoice and sends it back to the group.

async function processInvoiceEntry(message, data, senderName) {
  const msgId = message.id?._serialized || message.id?.id || null;

  // Skip if already processed (duplicate group post or re-scan)
  if (msgId && invoice.isProcessed(msgId)) {
    console.log(`🧾 Invoice already sent for message ${msgId} — skipping`);
    return;
  }

  const clientNameFull = invoice.ensureClientPrefix(data.clientName);
  const clientPhoneFmt = invoice.formatIndianPhone(data.clientPhone);

  console.log(`\n🧾 Invoice format detected from ${senderName}:`, clientNameFull);

  // ── Immediate confirmation in group ──────────────────────────
  const roleLabel = invoice.getRoleLabel(data.roleAbbrev);
  const confirmMsg =
    `✅ *Invoice received & being generated*\n` +
    `*Client:* ${clientNameFull}\n` +
    `*Staff:* ${data.staffName} (${roleLabel})\n` +
    `*Salary:* ₹ ${Number(data.salary).toLocaleString('en-IN')}` +
    (data.regFeePaid ? ` _(Reg. fee deducted)_` : '') + `\n` +
    `*Joining:* ${data.joiningDate || '—'}`;
  await safeGroupSend(confirmMsg);

  try {
    const result = await invoice.generateInvoicePDF({ ...data, clientName: clientNameFull, clientPhone: clientPhoneFmt });
    console.log(`   ✅ Invoice #${result.invoiceNo} generated: ${result.filename}`);

    const media   = MessageMedia.fromFilePath(result.path);
    const caption = `Invoice No. ${result.invoiceNo} — ${clientNameFull}`;
    await safeGroupSend(media, { caption });

    // Mark so the scan button won't re-process this message
    if (msgId) invoice.markProcessed(msgId);

  } catch (err) {
    console.error(`   ❌ Invoice generation failed:`, err.message);
    await safeGroupSend(`❌ Invoice generation failed: ${err.message}`);
  }
}

// ─── Free-text Update Parser ───────────────────────────────────
// Akkas post things like "Rufuina sorted" or "Kumar still waiting"
// Bot picks this up, updates status, and logs a note.

async function parseFreetextUpdate(text, senderName) {
  const lc = text.toLowerCase();
  const clients = tracker.getActive();

  for (const c of clients) {
    const nameLc = c.clientName.toLowerCase();
    if (!lc.includes(nameLc.split(' ')[0].toLowerCase())) continue;

    const staff = parser.getStaffDisplayName(senderName);
    let newStatus = null;

    if (/sorted|done|confirmed|placed|closed|hired/.test(lc))          newStatus = 'sorted';
    else if (/drop|not interested|cancel|no go|declined/.test(lc))     newStatus = 'dropped';
    else if (/follow.?up|called|trying|contacted|reached/.test(lc))    newStatus = null; // just log note
    else continue;

    if (newStatus) {
      tracker.updateStatus(c.phone, newStatus);
    }

    // Always log the free-text as a note
    tracker.addNote(c.phone, text, staff);
    console.log(`📝 Note logged for ${c.clientName}: "${text}"`);
    break;
  }
}

// ─── Private Reply Handler ─────────────────────────────────────

async function handlePrivateReply(message) {
  // Ignore messages sent BY the bot (outgoing)
  if (message.fromMe) return;

  // Only respond to actual text messages
  // Ignore stickers, voice notes, reactions, images without captions, etc.
  if (message.type !== 'chat') return;

  // Ignore empty or whitespace-only messages
  if (!message.body || !message.body.trim()) return;

  // Ignore messages that arrived before the bot started (backlog from reconnect)
  if (message.timestamp && message.timestamp < BOT_START_TIME) return;

  // ── Resolve the real phone number ────────────────────────────
  // message.from may be an @lid address (WhatsApp internal ID) for
  // newer accounts — NOT a real phone number. Always use getContact()
  // to get the actual number, regardless of address format.
  let phone;
  try {
    const contact = await message.getContact();
    // contact.number is the real phone digits, always without +
    phone = contact.number ? '+' + contact.number : '+' + message.from.replace(/@.*$/, '');
  } catch {
    phone = '+' + message.from.replace(/@.*$/, '');
  }

  console.log(`📩 Private message from ${phone}: "${message.body.substring(0, 60)}"`);

  const record = tracker.getByPhone(phone);

  // Unknown number — no action (not a tracked client)
  if (!record) {
    console.log(`   ↳ Unknown number ${phone} — no action (not a tracked client)`);
    return;
  }

  console.log(`   ↳ Matched client: ${record.clientName} (status: ${record.status})`);

  // Ignore if already closed
  if (['completed', 'sorted', 'not_needed', 'dropped', 'negative'].includes(record.status)) {
    console.log(`   ↳ Client is closed — no action.`);
    return;
  }

  const intent = parser.analyseClientReply(message.body);
  console.log(`   ↳ Intent detected: ${intent}`);

  // Map intent → internal status
  const statusMap = {
    form_filled:        'positive',
    link_request:       'replied',
    price_inquiry:      'question',
    availability_query: 'question',
    not_interested:     'negative',
    asking_update:      'replied',
    general_question:   'question',
    confirmed:          'replied',
    neutral:            'replied',
  };
  const newStatus = statusMap[intent] || 'replied';

  tracker.updateStatus(record.phone, newStatus, { clientReplyIntent: intent });
  console.log(`🔔 ${record.clientName} replied — intent: ${intent}`);

  // 1. Notify the group ONLY if the reply is actionable — include the client's actual message
  const groupAlert = msg.clientRepliedAlert(record, intent, message.body);
  if (groupAlert) {
    await safeGroupSend(groupAlert);
  }

  // No private reply to client — all communications go through group only
}

// ─── Process Salary Batch ─────────────────────────────────────
// Triggered when staff posts "March month Salary details:" format.
// Generates one salary invoice per client and sends each to group.

async function processSalaryBatch(message, batch, senderName) {
  const { month, clients } = batch;
  const count = clients.length;
  const label = month ? `${month} salary` : 'salary';

  await safeGroupSend(`📊 *${label} details received* — generating ${count} invoice${count > 1 ? 's' : ''}...`);

  const results = { sent: [], failed: [] };

  for (const c of clients) {
    const clientInfo   = invoice.getSalaryClient(c.rawClientName);
    const clientBilled = clientInfo ? clientInfo.billed
      : (c.rawClientName.match(/^(mr|ms|mrs|dr)\./i) ? c.rawClientName : `Ms. ${c.rawClientName}`);

    try {
      const result = await invoice.generateSalaryInvoicePDF({
        clientBilled,
        clientAddress : clientInfo ? clientInfo.address : '',
        clientPhone   : clientInfo ? clientInfo.phone   : '',
        month,
        items: c.items,
      });

      const media   = MessageMedia.fromFilePath(result.path);
      const caption = `Salary Invoice No. ${result.invoiceNo} — ${clientBilled}${month ? ' | ' + month : ''}`;
      await safeGroupSend(media, { caption });

      results.sent.push(clientBilled);
      console.log(`✅ Salary invoice #${result.invoiceNo} sent for ${clientBilled}`);

      // Small gap between sends
      await new Promise(r => setTimeout(r, 1500));

    } catch (err) {
      console.error(`❌ Salary invoice failed for ${clientBilled}:`, err.message);
      results.failed.push(clientBilled);
    }
  }

  if (results.failed.length) {
    await safeGroupSend(`⚠️ Could not generate invoice for: ${results.failed.join(', ')}`);
  }
}

// ─── Process Client Entry ──────────────────────────────────────

async function processClientEntry(message, entry, senderName) {
  const { clientName, phone, role } = entry;
  const staff = parser.getStaffDisplayName(senderName);

  if (tracker.isDuplicate(phone)) {
    await safeGroupSend(msg.duplicateWarning(tracker.getByPhone(phone)));
    return;
  }

  const record = tracker.upsertClient({ clientName, phone, role, roleAbbrev: entry.roleAbbrev, handledBy: staff });

  // Don't send if bot is paused
  if (botPaused) { console.log(`⏸️  [PAUSED] Suppressed initial message to ${clientName}`); return; }

  // Don't send anything to blocked numbers
  const entryDigits = phone.replace(/\D/g, '');
  if (BLOCKED_NUMBERS.has(entryDigits)) {
    console.log(`🚫 [BLOCKED] Suppressed initial message to ${clientName} (${phone})`);
    return;
  }

  try {
    const whatsappId  = phone.replace(/[\s\-().+]/g, '') + '@c.us';
    const messageText = msg.initialClientMessage(clientName, staff, role);
    const pdfPath     = path.resolve(config.PDF_PATH);
    const hasPdf      = fs.existsSync(pdfPath);

    if (hasPdf) {
      const media = MessageMedia.fromFilePath(pdfPath);
      await client.sendMessage(whatsappId, media, { caption: messageText });
    } else {
      await client.sendMessage(whatsappId, messageText);
      console.warn(`⚠️  PDF not found at ${pdfPath} — sent text only`);
    }

    console.log(`✅ Sent to ${clientName} (${phone})`);
    await safeGroupSend(msg.messageSentConfirmation(record, staff) + (hasPdf ? '' : ' _(profile PDF missing — form link sent only)_'));

  } catch (err) {
    await safeGroupSend(`❌ Failed to reach *${clientName}* (${phone}) — check the number.`);
    console.error(`Send failed ${phone}:`, err.message);
  }
}

// ─── Process Command ───────────────────────────────────────────

async function processCommand(message, command, senderName) {
  const { command: cmd, identifier } = command;
  const staff = parser.getStaffDisplayName(senderName);

  switch (cmd) {
    case 'help':     await safeGroupSend(msg.helpMessage(dashboardUrl)); break;
    case 'status':   await safeGroupSend(msg.statusReport(tracker.getActive())); break;
    case 'briefing': await sendMorningBriefing(); break;

    case 'sorted': {
      const c = tracker.find(identifier);
      tracker.updateStatus(c.phone, 'sorted');
      break;
    }
    case 'drop': {
      const c = tracker.find(identifier);
      if (c) tracker.updateStatus(c.phone, 'dropped');
      break;
    }
    case 'followup': {
      const c = tracker.find(identifier);
      if (!c) break;
      const followUpText = msg.followUpMessage(c.clientName, c.followUpCount);
      await client.sendMessage(c.phone.replace('+', '') + '@c.us', followUpText);
      tracker.updateStatus(c.phone, 'message_sent', { followUpCount: c.followUpCount + 1, lastFollowUpAt: new Date().toISOString() });
      break;
    }
    case 'note': {
      const c = tracker.find(identifier);
      if (c) tracker.addNote(c.phone, command.note, staff);
      break;
    }
  }
}

// ─── Morning Briefing ──────────────────────────────────────────

async function sendMorningBriefing() {
  // Morning briefing disabled — no automatic group messages
  console.log(`☀️  Morning briefing skipped (auto group posts disabled)`);
}

// ─── Utility ───────────────────────────────────────────────────

async function safeGroupSend(content, options) {
  if (botPaused) { console.log('⏸️  [PAUSED] Blocked outgoing group message'); return; }
  try { if (groupChat) await groupChat.sendMessage(content, options || {}); }
  catch (err) { console.error('Group send failed:', err.message); }
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

// ─── Web Dashboard (Express) ────────────────────────────────────

function startDashboard() {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  // ── Root route (for Railway health checks) ──
  app.get('/', (req, res) => {
    console.log('[HTTP] GET / - health check');
    res.status(200).json({ alive: true, timestamp: new Date().toISOString() });
  });

  // ── Health endpoint ──
  app.get('/health', (req, res) => {
    console.log('[HTTP] GET /health');
    res.status(200).json({ status: 'healthy', botReady, uptime: process.uptime() });
  });

  // ── API: Get all clients ──
  app.get('/api/clients', (req, res) => {
    res.json(tracker.getAll());
  });

  // ── API: Stats ──
  app.get('/api/stats', (req, res) => {
    const all = tracker.getAll();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const thisMonth = all.filter(c => new Date(c.messageSentAt) >= monthStart);
    res.json({
      total:         all.filter(c => !['dropped'].includes(c.status)).length,
      sortedToday:   tracker.getSortedToday().length,
      needsAttention: tracker.getNeedingFollowUp(config.FOLLOW_UP_THRESHOLD_HOURS).length,
      thisMonth:     thisMonth.length,
      sortedMonth:   thisMonth.filter(c => c.status === 'sorted').length,
      byMonth:       getMonthlyStats(all),
    });
  });

  // ── API: Update status ──
  app.patch('/api/clients/:phone/status', (req, res) => {
    const phone = decodeURIComponent(req.params.phone);
    const { status, note, author } = req.body;
    const updated = tracker.updateStatus(phone, status);
    if (!updated) return res.status(404).json({ error: 'Not found' });
    if (note) tracker.addNote(phone, note, author || 'Dashboard');
    res.json(updated);
  });

  // ── API: Add new client (triggers WhatsApp send) ──
  app.post('/api/clients', async (req, res) => {
    const { clientName, phone, role, roleAbbrev, handledBy, force } = req.body;
    if (!clientName || !phone) return res.status(400).json({ error: 'Missing fields' });

    // Check WhatsApp is ready BEFORE saving anything
    if (!botReady) {
      return res.status(503).json({ error: 'WhatsApp not connected yet — please scan the QR code first.' });
    }

    if (!force && tracker.isDuplicate(phone)) {
      return res.status(409).json({ error: 'Duplicate', client: tracker.getByPhone(phone) });
    }

    // Block if number is on the no-contact list
    if (BLOCKED_NUMBERS.has(phone.replace(/\D/g, ''))) {
      return res.status(403).json({ error: 'This number is currently blocked from receiving messages.' });
    }

    // Send WhatsApp message FIRST — only save to DB if it succeeds
    try {
      const whatsappId  = phone.replace(/[\s\-().+]/g, '') + '@c.us';
      const messageText = msg.initialClientMessage(clientName, handledBy || 'the team', role);
      const pdfPath     = path.resolve(config.PDF_PATH);
      const hasPdf      = fs.existsSync(pdfPath);

      const sendPromise = hasPdf
        ? client.sendMessage(whatsappId, MessageMedia.fromFilePath(pdfPath), { caption: messageText })
        : client.sendMessage(whatsappId, messageText);
      await Promise.race([
        sendPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('WhatsApp send timed out — check the number and try again')), 30000)),
      ]);

      // Only save to DB after message sent successfully
      const record = tracker.upsertClient({ clientName, phone, role, roleAbbrev: roleAbbrev || '', handledBy: handledBy || 'Dashboard' });
      console.log(`✅ Dashboard sent to ${clientName}`);

      // Notify group so staff know the send happened
      const staffLabel = handledBy || 'Dashboard';
      await safeGroupSend(msg.messageSentConfirmation(record, staffLabel) + (hasPdf ? '' : ' _(profile PDF missing — form link sent only)_'));

      res.json({ success: true, client: record });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Delete client ──
  app.delete('/api/clients/:phone', (req, res) => {
    const phone = decodeURIComponent(req.params.phone);
    const deleted = tracker.deleteClient(phone);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });

  // ── API: Send follow-up ──
  app.post('/api/clients/:phone/followup', async (req, res) => {
    if (!botReady) return res.status(503).json({ error: 'WhatsApp not connected yet — please scan the QR code first.' });
    const phone = decodeURIComponent(req.params.phone);
    if (BLOCKED_NUMBERS.has(phone.replace(/\D/g, ''))) return res.status(403).json({ error: 'This number is currently blocked from receiving messages.' });
    const c = tracker.find(phone);
    if (!c) return res.status(404).json({ error: 'Not found' });

    const followUpText = msg.followUpMessage(c.clientName, c.followUpCount);
    await Promise.race([
      client.sendMessage(c.phone.replace('+', '') + '@c.us', followUpText),
      new Promise((_, reject) => setTimeout(() => reject(new Error('WhatsApp send timed out')), 30000)),
    ]);
    tracker.updateStatus(c.phone, 'message_sent', { followUpCount: c.followUpCount + 1, lastFollowUpAt: new Date().toISOString() });
    res.json({ success: true });
  });

  // ── API: Scan backlog — find uncovered clients from the group ──
  // POST /api/scan-backlog
  // Optional body: { "since": "2026-03-02" }  (defaults to last Monday)
  // ── API: Scan backlog (GET) — returns list of clients who haven't received profile+form ──

  app.get('/api/scan-backlog', async (req, res) => {
    if (!botReady) {
      return res.status(503).json({ error: 'WhatsApp not connected — scan QR first.' });
    }
    if (!groupChat) {
      const found = await ensureGroupChat();
      if (!found) {
        return res.status(503).json({ error: 'Connected but still finding your group — wait 15s and try again.' });
      }
    }

    const forceRefresh = req.query.refresh === '1';
    const cacheAgeMs = backlogCache ? (Date.now() - backlogCache.fetchedAt.getTime()) : Infinity;
    const cacheStale = cacheAgeMs > 25 * 60 * 1000; // stale after 25 min

    // If cache is fresh and not forcing refresh, return instantly
    if (backlogCache && !cacheStale && !forceRefresh) {
      // Also remove any that have since been sent (tracker was updated)
      const fresh = backlogCache.clients.filter(c => !tracker.getByPhone(c.phone));
      console.log(`[SCAN-BACKLOG] Serving cache (${Math.round(cacheAgeMs/60000)}m old) — ${fresh.length} unsent`);
      return res.json({ clients: fresh, total: fresh.length, cached: true, cachedAgo: Math.round(cacheAgeMs / 60000) });
    }

    // Cache missing or stale — run scan now (but don't block if already running)
    if (!backlogScanRunning) {
      runBacklogScan(); // fire and don't await — let it update cache
    }

    // If we have stale cache, return it immediately while fresh scan runs in background
    if (backlogCache && !forceRefresh) {
      const fresh = backlogCache.clients.filter(c => !tracker.getByPhone(c.phone));
      console.log(`[SCAN-BACKLOG] Returning stale cache while refreshing in background`);
      return res.json({ clients: fresh, total: fresh.length, cached: true, refreshing: true, cachedAgo: Math.round(cacheAgeMs / 60000) });
    }

    // No cache at all — wait for first scan (with timeout)
    console.log(`[SCAN-BACKLOG] No cache yet — waiting for first scan...`);
    let waited = 0;
    while (backlogScanRunning && waited < 40000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
    }
    if (backlogCache) {
      const fresh = backlogCache.clients.filter(c => !tracker.getByPhone(c.phone));
      return res.json({ clients: fresh, total: fresh.length, cached: false });
    }
    return res.status(503).json({ error: 'Scan still loading — try again in a moment.' });
  });
  // ── Helper: send profile PDF + form link to one client (30s timeout) ──
  async function sendProfileToClient(phone, clientName, role, roleAbbrev) {
    const whatsappId  = phone.replace('+', '') + '@c.us';
    const messageText = msg.initialClientMessage(clientName, 'the team', role || '');
    const pdfPath     = path.resolve(config.PDF_PATH);
    const sendPromise = fs.existsSync(pdfPath)
      ? client.sendMessage(whatsappId, MessageMedia.fromFilePath(pdfPath), { caption: messageText })
      : client.sendMessage(whatsappId, messageText);
    await Promise.race([
      sendPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('sendMessage timed out after 30s')), 30000)),
    ]);
    tracker.upsertClient({ clientName, phone, role: role || '', roleAbbrev: roleAbbrev || '', handledBy: 'Backlog Scan' });
    // After sending, invalidate cache so next GET reflects the change
    if (backlogCache) backlogCache.clients = backlogCache.clients.filter(c => c.phone.replace(/\D/g,'') !== phone.replace(/\D/g,''));
    // Notify group
    await safeGroupSend(`Message sent to ${clientName}`);
  }

  app.post('/api/scan-backlog', async (req, res) => {
    if (!botReady) return res.status(503).json({ error: 'WhatsApp not connected — scan QR first.' });
    if (!groupChat) {
      const found = await ensureGroupChat();
      if (!found) return res.status(503).json({ error: 'Connected but still finding your group — wait 15s and try again.' });
    }
    if (botPaused) return res.status(503).json({ error: 'Bot is paused — resume it before sending.' });

    // ── Single send (backlog panel "Send →" button) ──────────────
    if (req.body && req.body.single) {
      const { phone, clientName, role, roleAbbrev } = req.body.single;
      try {
        await sendProfileToClient(phone, clientName, role, roleAbbrev);
        console.log(`[SCAN-BACKLOG] ✅ Sent to ${clientName} (${phone})`);
        return res.json({ ok: true });
      } catch (err) {
        console.error(`[SCAN-BACKLOG] ❌ Failed single send: ${err.message}`);
        return res.status(500).json({ error: err.message });
      }
    }

    // ── Send-all (backlog panel "Send to All" button) ────────────
    if (req.body && req.body.sendAll && Array.isArray(req.body.sendAll)) {
      const list = req.body.sendAll;
      const results = { sent: [], errors: [] };
      for (const c of list) {
        try {
          await sendProfileToClient(c.phone, c.clientName, c.role, c.roleAbbrev);
          results.sent.push(c.clientName);
          console.log(`[SCAN-BACKLOG] ✅ Sent to ${c.clientName}`);
          await new Promise(r => setTimeout(r, 1500)); // avoid rate-limit
        } catch (err) {
          results.errors.push({ name: c.clientName, error: err.message });
          console.error(`[SCAN-BACKLOG] ❌ Failed ${c.clientName}: ${err.message}`);
        }
      }
      return res.json({ ok: true, summary: `${results.sent.length} sent, ${results.errors.length} errors`, ...results });
    }

    return res.status(400).json({ error: 'Provide single or sendAll in request body.' });
  });

  // ── API: Generate invoice manually ──────────────────────────
  // POST /api/generate-invoice
  // Body: { clientName, clientAddress, clientPhone, staffName, roleAbbrev,
  //         joiningDate, salary, regFeePaid, sendToGroup }
  app.post('/api/generate-invoice', async (req, res) => {
    const { clientName, clientAddress, clientPhone, staffName,
            roleAbbrev, joiningDate, salary, regFeePaid, sendToGroup,
            markMsgId, extraItems, skipClientPrefix } = req.body || {};

    if (!clientName || !staffName || !salary) {
      return res.status(400).json({ error: 'clientName, staffName and salary are required.' });
    }

    try {
      const result = await invoice.generateInvoicePDF({
        clientName, clientAddress, clientPhone,
        staffName, roleAbbrev: (roleAbbrev || '').toUpperCase(),
        joiningDate, salary: Number(salary), regFeePaid: !!regFeePaid,
        extraItems: Array.isArray(extraItems) ? extraItems : [],
        skipClientPrefix: !!skipClientPrefix,
      });

      console.log(`🧾 Manual invoice #${result.invoiceNo} generated for ${clientName}`);

      // Optionally send to group
      if (sendToGroup && botReady && groupChat) {
        const media   = MessageMedia.fromFilePath(result.path);
        const caption = `Invoice No. ${result.invoiceNo} — ${clientName}${joiningDate ? ' | ' + joiningDate : ''}`;
        await safeGroupSend(media, { caption });
        console.log(`   ✅ Sent Invoice #${result.invoiceNo} to group`);
      }

      // Mark original group message as processed so it won't appear in pending again
      if (markMsgId) invoice.markProcessed(markMsgId);

      res.json({ success: true, invoiceNo: result.invoiceNo, filename: result.filename });

    } catch (err) {
      console.error('Invoice generation error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: Download a generated invoice PDF ───────────────────
  // GET /api/invoices/:filename
  app.get('/api/invoices/:filename', (req, res) => {
    const invoicesDir = path.resolve(__dirname, 'data/invoices');
    const filename    = path.basename(req.params.filename); // strip any path traversal
    const filepath    = path.join(invoicesDir, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Invoice not found.' });
    res.download(filepath, filename);
  });

  // ── API: Send a test invoice to a phone number ───────────────
  // POST /api/test-invoice   (no body needed — uses hardcoded test data)
  app.post('/api/test-invoice', async (req, res) => {
    if (!botReady) return res.status(503).json({ error: 'WhatsApp not connected.' });
    try {
      const result = await invoice.generateInvoicePDF({
        clientName:    'Mr. Immanuel',
        clientAddress: 'Alpha the Hub, Chennai',
        clientPhone:   '+917299997905',
        staffName:     'Test Staff',
        roleAbbrev:    'BS',
        joiningDate:   '01.03.2026',
        salary:        20000,
        regFeePaid:    false,
      });
      const media   = MessageMedia.fromFilePath(result.path);
      const caption = `Test Invoice No. ${result.invoiceNo} — please ignore`;
      await client.sendMessage('917299997905@c.us', media, { caption });
      console.log(`🧪 Test invoice #${result.invoiceNo} sent to +917299997905`);
      res.json({ success: true, invoiceNo: result.invoiceNo, filename: result.filename });
    } catch (err) {
      console.error('Test invoice error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── API: List recent invoices ────────────────────────────────
  // GET /api/invoices
  app.get('/api/invoices', (req, res) => {
    const invoicesDir = path.resolve(__dirname, 'data/invoices');
    if (!fs.existsSync(invoicesDir)) return res.json([]);
    const files = fs.readdirSync(invoicesDir)
      .filter(f => f.endsWith('.pdf'))
      .map(f => {
        const stat = fs.statSync(path.join(invoicesDir, f));
        return { filename: f, createdAt: stat.birthtime, size: stat.size };
      })
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);
    res.json(files);
  });

  // ── API: Get pending (unprocessed) invoices for review ────────
  // GET /api/pending-invoices
  app.get('/api/pending-invoices', async (req, res) => {
    if (!botReady) {
      return res.status(503).json({ error: 'WhatsApp not connected — scan QR first.' });
    }
    if (!groupChat) {
      const found = await ensureGroupChat();
      if (!found) {
        return res.status(503).json({ error: 'Connected but still finding your group — wait 15s and try again.' });
      }
    }

    const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // last 30 days
    const sinceTs   = Math.floor(sinceDate.getTime() / 1000);

    let messages;
    try {
      messages = await groupChat.fetchMessages({ limit: 1000 });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch messages: ' + err.message });
    }

    const pending = [];

    for (const m of messages) {
      if (m.timestamp < sinceTs || m.type !== 'chat' || !m.body) continue;
      const msgId = m.id?._serialized || m.id?.id || null;

      const data = invoice.parseInvoiceMessage(m.body);
      if (!data) continue;

      const alreadySent    = msgId ? invoice.isProcessed(msgId) : false;
      const clientNameFull = invoice.ensureClientPrefix(data.clientName);
      const clientPhoneFmt = invoice.formatIndianPhone(data.clientPhone);
      const serviceFee     = data.salary;
      const total          = serviceFee - (data.regFeePaid ? 1000 : 0);

      pending.push({
        msgId,
        alreadySent,
        clientName    : clientNameFull,
        clientAddress : data.clientAddress || '',
        clientPhone   : clientPhoneFmt    || '',
        staffName     : data.staffName,
        roleAbbrev    : data.roleAbbrev,
        roleLabel     : invoice.getRoleLabel(data.roleAbbrev),
        joiningDate   : data.joiningDate  || '',
        salary        : data.salary,
        regFeePaid    : data.regFeePaid,
        total,
        sentAt        : new Date(m.timestamp * 1000).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }),
      });
    }

    // Sort: unsent first, then sent
    pending.sort((a, b) => (a.alreadySent ? 1 : 0) - (b.alreadySent ? 1 : 0));

    res.json({ pending, nextInvoiceNo: invoice.getNextInvoiceNumber() });
  });

  // ── API: Scan group for unsent invoices ──────────────────────
  // POST /api/scan-invoices
  // Optional body: { "since": "2026-03-01" }  (defaults to last 30 days)
  app.post('/api/scan-invoices', async (req, res) => {
    if (!botReady) {
      return res.status(503).json({ error: 'WhatsApp not connected — scan QR first.' });
    }
    if (!groupChat) {
      const found = await ensureGroupChat();
      if (!found) {
        return res.status(503).json({ error: 'Connected but still finding your group — wait 15s and try again.' });
      }
    }

    // Default: last 30 days
    const sinceDate = req.body?.since
      ? new Date(req.body.since)
      : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sinceTs = Math.floor(sinceDate.getTime() / 1000);

    console.log(`\n🔍 Scanning group for unsent invoices since ${sinceDate.toDateString()}...`);

    let messages;
    try {
      messages = await groupChat.fetchMessages({ limit: 500 });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch messages: ' + err.message });
    }

    const inRange = messages.filter(m =>
      m.timestamp >= sinceTs && m.type === 'chat' && m.body
    );
    console.log(`   ${inRange.length} text messages in range`);

    const results = { generated: [], skipped: [], errors: [] };

    for (const m of inRange) {
      const msgId = m.id?._serialized || m.id?.id || null;

      // Already processed?
      if (msgId && invoice.isProcessed(msgId)) {
        results.skipped.push({ reason: 'Already invoiced', preview: m.body.substring(0, 40) });
        continue;
      }

      // Does it match invoice format?
      const data = invoice.parseInvoiceMessage(m.body);
      if (!data) continue;

      console.log(`   → Generating invoice for ${data.clientName}...`);
      try {
        const result = await invoice.generateInvoicePDF(data);

        const media   = MessageMedia.fromFilePath(result.path);
        const caption = `Invoice No. ${result.invoiceNo} — ${data.clientName} | ${invoice.getRoleLabel(data.roleAbbrev)} | ${data.joiningDate || ''}`.trim();
        await safeGroupSend(media, { caption });

        if (msgId) invoice.markProcessed(msgId);

        results.generated.push({
          invoiceNo: result.invoiceNo,
          filename:  result.filename,
          client:    data.clientName,
        });
        console.log(`   ✅ Invoice #${result.invoiceNo} sent for ${data.clientName}`);

        // Small gap between sends
        await new Promise(r => setTimeout(r, 2000));

      } catch (err) {
        results.errors.push({ client: data.clientName, error: err.message });
        console.error(`   ❌ Failed for ${data.clientName}:`, err.message);
      }
    }

    const summary = results.generated.length > 0
      ? `✅ ${results.generated.length} invoice(s) sent${results.skipped.length ? `, ${results.skipped.length} already done` : ''}`
      : results.skipped.length > 0
        ? `All ${results.skipped.length} invoice(s) already sent — nothing new to send`
        : `No invoice-format messages found in the last 30 days`;
    console.log(`\n📊 Invoice scan complete: ${summary}\n`);
    res.json({ scanned: inRange.length, summary, generated: results.generated, skipped: results.skipped, errors: results.errors });
  });

  // ── QR Code page (for cloud/Railway setup) ──
  app.get('/qr', (req, res) => {
    if (botReady) {
      return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Alpha Bot</title>
        <style>body{background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px}
        .ok{font-size:64px;margin-bottom:16px}.msg{font-size:20px;font-weight:600}.sub{color:#888;margin-top:8px}</style>
        </head><body><div class="ok">✅</div><div class="msg">WhatsApp Connected!</div>
        <div class="sub">The bot is live. <a href="/" style="color:#fff">Go to dashboard →</a></div></body></html>`);
    }
    if (!latestQR) {
      return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Alpha Bot</title>
        <meta http-equiv="refresh" content="3">
        <style>body{background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px}
        .spin{font-size:48px;animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}
        .msg{font-size:18px;margin-top:16px;color:#888}</style>
        </head><body><div class="spin">⟳</div><div class="msg">Starting up… refreshing in 3 seconds</div></body></html>`);
    }
    // Generate QR as SVG/HTML using qrcode package
    const QRCode = (() => { try { return require('qrcode'); } catch { return null; } })();
    if (!QRCode) return res.send('Install qrcode package: npm install qrcode');

    QRCode.toDataURL(latestQR, { width: 300, margin: 2, color: { dark:'#000', light:'#fff' } }, (err, url) => {
      if (err) return res.status(500).send('QR error');
      res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Alpha Bot — Scan QR</title>
        <meta http-equiv="refresh" content="30">
        <style>body{background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:40px 20px}
        h2{font-size:22px;margin-bottom:6px}p{color:#888;font-size:14px;margin-bottom:24px}
        img{border-radius:16px;border:6px solid #fff;max-width:280px}
        .steps{margin-top:24px;color:#888;font-size:13px;line-height:2}</style>
        </head><body>
        <h2>Scan to Connect WhatsApp</h2>
        <p>Page refreshes every 30 seconds</p>
        <img src="${url}" alt="QR Code">
        <div class="steps">
          1. Open <strong style="color:#fff">WhatsApp Business</strong> on your phone<br>
          2. Tap ⋮ → <strong style="color:#fff">Linked Devices</strong> → <strong style="color:#fff">Link a Device</strong><br>
          3. Point your camera at the QR code above
        </div>
        </body></html>`);
    });
  });

  // ── API: Bot status ──
  app.get('/api/status', (req, res) => {
    // Railway health check — return 200 OK as long as the app is running.
    // The bot may still be initializing, but the app itself is healthy.
    try {
      res.status(200).json({ ready: botReady, groupReady: !!groupChat, hasQR: !!latestQR, paused: botPaused });
    } catch (err) {
      console.error('[HEALTH] Error in status endpoint:', err);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ── API: Pause / Resume ──
  app.post('/api/pause',  (req, res) => { botPaused = true;  console.log('⏸️  Bot PAUSED — no outgoing messages'); res.json({ paused: true }); });
  app.post('/api/resume', (req, res) => { botPaused = false; console.log('▶️  Bot RESUMED');                        res.json({ paused: false }); });

  // ── API: Export CSV ──
  app.get('/api/export.csv', (req, res) => {
    const all = tracker.getAll();
    const header = 'Name,Phone,Role,Handled By,Status,Contacted,Last Activity,Notes';
    const rows = all.map(c => [
      `"${c.clientName}"`, `"${c.phone}"`, `"${c.role}"`,
      `"${c.handledBy}"`, `"${msg.statusLabel(c.status)}"`,
      `"${fmtCsvDate(c.messageSentAt)}"`, `"${fmtCsvDate(c.lastActivityAt)}"`,
      `"${(c.notes || []).map(n => n.text).join(' | ')}"`,
    ].join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="alpha-clients-${Date.now()}.csv"`);
    res.send([header, ...rows].join('\n'));
  });

  const port = process.env.PORT || config.DASHBOARD_PORT;
  console.log(`[INIT] PORT env: ${process.env.PORT}, DASHBOARD_PORT config: ${config.DASHBOARD_PORT}, final: ${port}`);
  process.stderr.write(`[INIT] Binding to port ${port}... (stderr)\n`);
  
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[INIT] ✅ Server bound successfully on port ${port}`);
    process.stderr.write(`[INIT-STDERR] ✅ Server bound on ${port}\n`);
    const ip = getLocalIP();
    dashboardUrl = process.env.RAILWAY_STATIC_URL
      ? `https://${process.env.RAILWAY_STATIC_URL}`
      : `http://${ip}:${port}`;
    console.log(`📊 Dashboard: ${dashboardUrl}`);
  });
  
  server.on('error', (err) => {
    console.error(`[ERROR] Server error: ${err.code} - ${err.message}`);
  });
  
  server.on('clientError', (err) => {
    console.error(`[ERROR] Client error: ${err.message}`);
  });
}

function getMonthlyStats(all) {
  const map = {};
  all.forEach(c => {
    const d = new Date(c.messageSentAt);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!map[key]) map[key] = { month: key, total: 0, sorted: 0 };
    map[key].total++;
    if (c.status === 'sorted') map[key].sorted++;
  });
  return Object.values(map).sort((a,b) => a.month.localeCompare(b.month));
}

function fmtCsvDate(isoString) {
  if (!isoString) return '';
  return new Date(isoString).toLocaleDateString('en-MY');
}

// ─── Start ─────────────────────────────────────────────────────

// Dashboard ALWAYS starts first — so Railway health checks pass
// even if WhatsApp / Chrome haven't connected yet.
console.log('[INIT] Calling startDashboard...');
process.stderr.write('[INIT] Calling startDashboard (stderr)\n');
try {
  startDashboard();
  console.log('[INIT] startDashboard() completed (listening on port)');
  process.stderr.write('[INIT] startDashboard() completed (stderr)\n');
} catch (dashboardErr) {
  console.error('[INIT] startDashboard() ERROR:', dashboardErr);
  process.stderr.write(`[INIT] startDashboard() ERROR: ${dashboardErr.message}\n`);
}

function clearBrowserLocks() {
  // Remove stale Chromium singleton lock files so retries don't get blocked
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
  for (const f of lockFiles) {
    try { fs.unlinkSync(path.join(AUTH_PATH, 'session-alpha-bot', f)); } catch {}
  }
}

async function startWhatsApp() {
  clearBrowserLocks();
  try {
    fs.mkdirSync(AUTH_PATH, { recursive: true });
  } catch {}
  try {
    console.log('🚀 Starting Alpha Bot...\n');
    await client.initialize();
  } catch (err) {
    console.error('⚠️  WhatsApp init failed:', err.message);
    console.log('   Dashboard is still running. Will retry in 30 seconds...');
    clearBrowserLocks();
    setTimeout(startWhatsApp, 30_000);
  }
}

console.log('[INIT] About to call startWhatsApp...');
startWhatsApp().catch(err => {
  console.error('[INIT] startWhatsApp error:', err);
});
console.log('[INIT] startWhatsApp() called (async)');

// ─── Global Safety Net ─────────────────────────────────────────
// Keeps the process alive even if something unexpected crashes.

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught exception (bot stays up):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled promise rejection (bot stays up):', reason);
});

// Absolutely final fallback - keep process alive no matter what
process.on('exit', (code) => {
  console.error('❌ PROCESS EXIT EVENT:', code);
  if (code !== 0) process.exitCode = 0;  // Don't actually exit on error
});



process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  try { await client.destroy(); } catch {}
  process.exit(0);
});

// Final safety: if anything goes wrong, keep the process alive
let lastWatchdog = Date.now();
setInterval(() => {
  const now = Date.now();
  const elapsed = (now - lastWatchdog) / 1000;
  lastWatchdog = now;
  console.log(`[WATCHDOG] Still alive - uptime: ${Math.floor(process.uptime())}s, botReady: ${botReady}, elapsed since last check: ${elapsed.toFixed(1)}s`);
}, 5000);

console.log('[INIT] ✅ Index.js loaded successfully - all startup code executed');

// Send a signal that the app is ready
console.log('READY');
process.stdout.write('');
