// ============================================================
//  ALPHA WHATSAPP BOT — Main Entry Point
//  Run with:  node index.js
// ============================================================

require('dotenv').config();
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

const client = new Client({
  authStrategy: new LocalAuth({ clientId: 'alpha-bot', dataPath: AUTH_PATH }),
  puppeteer: {
    headless: true,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    protocolTimeout: 180000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-default-apps',
      '--no-first-run',
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

// ─── Ready ─────────────────────────────────────────────────────

client.on('ready', async () => {
  console.log('\n\n✅ Alpha Bot is online!\n');
  botReady = true;

  try {
    const chats = await Promise.race([
      client.getChats(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getChats timeout')), 10000))
    ]);
    groupChat = chats.find(c => c.name === config.GROUP_NAME);

    if (groupChat) {
      console.log(`📍 Monitoring: "${config.GROUP_NAME}"`);
    } else {
      console.error(`\n❌ Group "${config.GROUP_NAME}" not found! Check config.js\n`);
    }

    cron.schedule(config.MORNING_BRIEFING_CRON, sendMorningBriefing, { timezone: config.TIMEZONE });
    console.log(`⏰ Morning briefing: ${config.MORNING_BRIEFING_CRON} (${config.TIMEZONE})`);
    if (dashboardUrl) console.log(`📊 Dashboard: ${dashboardUrl}\n`);
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
      console.warn(`\n⚠️  Health check failed (${healthCheckFailures}/3): ${err.message}`);
      if (healthCheckFailures >= 3) {
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

// Start health check after 3 minutes (give bot time to connect first)
setTimeout(() => {
  setInterval(runHealthCheck, 2 * 60 * 1000); // every 2 minutes
}, 3 * 60 * 1000);

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

  // 1. Invoice entry? (numbered format 1.Name 2.Address … 7.Date)
  const invoiceEntry = invoice.parseInvoiceMessage(text);
  if (invoiceEntry) {
    await processInvoiceEntry(message, invoiceEntry, senderName);
    return;
  }

  // 2. Client entry?
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

  // Unknown number — AI-generated contextual reply
  if (!record) {
    console.log(`   ↳ Unknown number — generating AI reply...`);
    try {
      const reply = await ai.replyToUnknown(message.body);
      await client.sendMessage(message.from, reply);
      console.log(`   ↳ AI reply sent to unknown number`);
    } catch (err) {
      console.error(`   ↳ AI reply failed:`, err.message);
    }
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

  // 1. Notify the group ONLY if the reply is actionable
  const groupAlert = msg.clientRepliedAlert(record, intent);
  if (groupAlert) {
    await safeGroupSend(groupAlert);
  }

  // 2. AI-generated reply back to the client
  if (botPaused) { console.log(`⏸️  [PAUSED] Blocked reply to ${record.clientName}`); return; }
  const replyDigits = record.phone.replace(/\D/g, '');
  if (BLOCKED_NUMBERS.has(replyDigits)) { console.log(`🚫 [BLOCKED] Suppressed reply to ${record.clientName} (${record.phone})`); return; }
  try {
    const reply = await ai.replyToClient(record.clientName, record.role, message.body);
    await client.sendMessage(message.from, reply);
    console.log(`   ↳ AI reply sent to ${record.clientName}`);
  } catch (err) {
    console.error(`   ↳ AI reply FAILED for ${record.clientName}:`, err.message);
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
    const whatsappId  = phone.replace('+', '') + '@c.us';
    const messageText = msg.initialClientMessage(clientName, staff, role);
    const pdfPath     = path.resolve(config.PDF_PATH);

    if (fs.existsSync(pdfPath)) {
      const media = MessageMedia.fromFilePath(pdfPath);
      await client.sendMessage(whatsappId, media, { caption: messageText });
    } else {
      await client.sendMessage(whatsappId, messageText);
    }

    console.log(`✅ Sent to ${clientName} (${phone})`);

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

      if (fs.existsSync(pdfPath)) {
        const media = MessageMedia.fromFilePath(pdfPath);
        await client.sendMessage(whatsappId, media, { caption: messageText });
      } else {
        await client.sendMessage(whatsappId, messageText);
      }

      // Only save to DB after message sent successfully
      const record = tracker.upsertClient({ clientName, phone, role, roleAbbrev: roleAbbrev || '', handledBy: handledBy || 'Dashboard' });
      console.log(`✅ Dashboard sent to ${clientName}`);
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
    await client.sendMessage(c.phone.replace('+', '') + '@c.us', followUpText);
    tracker.updateStatus(c.phone, 'message_sent', { followUpCount: c.followUpCount + 1, lastFollowUpAt: new Date().toISOString() });
    res.json({ success: true });
  });

  // ── API: Scan backlog — find uncovered clients from the group ──
  // POST /api/scan-backlog
  // Optional body: { "since": "2026-03-02" }  (defaults to last Monday)
  app.post('/api/scan-backlog', async (req, res) => {
    if (!botReady || !groupChat) {
      return res.status(503).json({ error: 'WhatsApp not connected or group not found.' });
    }
    if (botPaused) {
      return res.status(503).json({ error: 'Bot is paused — resume it before scanning backlog.' });
    }

    // Default: last Monday (March 2, 2026) 00:00 Malaysia time (UTC+8)
    const sinceDate = req.body && req.body.since
      ? new Date(req.body.since)
      : new Date('2026-03-02T00:00:00+08:00');
    const sinceTimestamp = Math.floor(sinceDate.getTime() / 1000);

    console.log(`\n🔍 Scanning backlog since ${sinceDate.toISOString()}...`);

    let messages;
    try {
      messages = await groupChat.fetchMessages({ limit: 500 });
    } catch (err) {
      return res.status(500).json({ error: 'Failed to fetch messages: ' + err.message });
    }

    // Only messages within our time window
    const inRange = messages.filter(m => m.timestamp >= sinceTimestamp);
    console.log(`   ${inRange.length} messages in range (out of ${messages.length} fetched)`);

    const results = { sent: [], skipped: [], errors: [] };

    for (const m of inRange) {
      let clientName = null;
      let phone      = null;
      let role       = '';
      let roleAbbrev = '';

      if (m.type === 'chat' && m.body) {
        // ── Text message: try to parse as client entry ──────────
        const entry = parser.parseClientEntry(m.body);
        if (!entry) continue;
        clientName = entry.clientName;
        phone      = entry.phone;
        role       = entry.role;
        roleAbbrev = entry.roleAbbrev;

      } else if (m.type === 'vcard' && m.body) {
        // ── Shared contact (vCard) ──────────────────────────────
        const vcard = m.body;

        // FN: Full Name
        const fnMatch = vcard.match(/^FN:(.+)$/m);
        if (fnMatch) clientName = fnMatch[1].trim();

        // Prefer waid= (WhatsApp ID — clean digits)
        const waidMatch = vcard.match(/waid=(\d+)/);
        if (waidMatch) {
          phone = '+' + waidMatch[1];
        } else {
          // Fall back to TEL field
          const telMatch = vcard.match(/^TEL[^:]*:([+\d\s\-().]+)/m);
          if (telMatch) {
            const digits = telMatch[1].replace(/[\s\-().]/g, '');
            phone = digits.startsWith('+') ? digits : '+' + digits;
          }
        }

        if (!clientName || !phone) continue;

      } else {
        continue; // ignore stickers, images, audio, etc.
      }

      // ── Already in tracker? ─────────────────────────────────
      if (tracker.getByPhone(phone)) {
        results.skipped.push({ clientName, phone, reason: 'Already contacted' });
        console.log(`   ↳ Skip: ${clientName} (${phone}) — already in tracker`);
        continue;
      }

      // ── Send form + company profile ─────────────────────────
      try {
        const whatsappId  = phone.replace('+', '') + '@c.us';
        const messageText = msg.initialClientMessage(clientName, 'the team', role);
        const pdfPath     = path.resolve(config.PDF_PATH);

        if (fs.existsSync(pdfPath)) {
          const media = MessageMedia.fromFilePath(pdfPath);
          await client.sendMessage(whatsappId, media, { caption: messageText });
        } else {
          await client.sendMessage(whatsappId, messageText);
        }

        tracker.upsertClient({ clientName, phone, role, roleAbbrev, handledBy: 'Backlog Scan' });
        results.sent.push({ clientName, phone, role: role || 'General' });
        console.log(`   ✅ Sent to ${clientName} (${phone})`);

        // Small delay between sends to avoid WhatsApp rate-limiting
        await new Promise(r => setTimeout(r, 1500));

      } catch (err) {
        results.errors.push({ clientName, phone, error: err.message });
        console.error(`   ❌ Failed: ${clientName} (${phone}):`, err.message);
      }
    }

    const summary = `${results.sent.length} sent, ${results.skipped.length} already contacted, ${results.errors.length} errors`;
    console.log(`\n📊 Backlog scan complete: ${summary}\n`);
    res.json({ scanned: inRange.length, summary, ...results });
  });

  // ── API: Generate invoice manually ──────────────────────────
  // POST /api/generate-invoice
  // Body: { clientName, clientAddress, clientPhone, staffName, roleAbbrev,
  //         joiningDate, salary, regFeePaid, sendToGroup }
  app.post('/api/generate-invoice', async (req, res) => {
    const { clientName, clientAddress, clientPhone, staffName,
            roleAbbrev, joiningDate, salary, regFeePaid, sendToGroup,
            markMsgId } = req.body || {};

    if (!clientName || !staffName || !salary) {
      return res.status(400).json({ error: 'clientName, staffName and salary are required.' });
    }

    try {
      const result = await invoice.generateInvoicePDF({
        clientName, clientAddress, clientPhone,
        staffName, roleAbbrev: (roleAbbrev || '').toUpperCase(),
        joiningDate, salary: Number(salary), regFeePaid: !!regFeePaid,
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
    if (!botReady || !groupChat) {
      return res.status(503).json({ error: 'WhatsApp not connected.' });
    }

    const sinceDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000); // last 10 days
    const sinceTs   = Math.floor(sinceDate.getTime() / 1000);

    let messages;
    try {
      messages = await groupChat.fetchMessages({ limit: 500 });
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
    if (!botReady || !groupChat) {
      return res.status(503).json({ error: 'WhatsApp not connected.' });
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
    res.status(200).json({ ready: botReady, hasQR: !!latestQR, paused: botPaused });
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
  app.listen(port, '0.0.0.0', () => {
    const ip = getLocalIP();
    dashboardUrl = process.env.RAILWAY_STATIC_URL
      ? `https://${process.env.RAILWAY_STATIC_URL}`
      : `http://${ip}:${port}`;
    console.log(`\n📊 Dashboard running at:`);
    console.log(`   Local:   http://localhost:${port}`);
    if (process.env.RAILWAY_STATIC_URL) {
      console.log(`   Live:    https://${process.env.RAILWAY_STATIC_URL}`);
    } else {
      console.log(`   Network: ${dashboardUrl}  (open on any phone on same WiFi)`);
    }
    console.log();
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
startDashboard();

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

startWhatsApp();

// ─── Global Safety Net ─────────────────────────────────────────
// Keeps the process alive even if something unexpected crashes.

process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught exception (bot stays up):', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled promise rejection (bot stays up):', reason);
});

process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  try { await client.destroy(); } catch {}
  process.exit(0);
});
