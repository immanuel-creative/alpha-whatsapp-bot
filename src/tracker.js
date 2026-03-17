// ============================================================
//  TRACKER — Client status database (stored in data/clients.json)
// ============================================================

const fs   = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '../data/clients.json');

// Ensure data directory and file exist on startup
function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir))       fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function load() {
  ensureDataFile();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function save(clients) {
  ensureDataFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(clients, null, 2), 'utf8');
}

// ─── Status values ─────────────────────────────────────────────
// message_sent  → initial message delivered
// replied       → client replied privately
// positive      → client replied positively (likely to convert)
// question      → client has questions (needs manual attention)
// negative      → client not interested
// sorted        → staff manually marked as done
// dropped       → gave up after max follow-ups

// ─── Add / Update a client ─────────────────────────────────────

function upsertClient({ clientName, phone, role, roleAbbrev, handledBy }) {
  const clients = load();
  const existing = clients.findIndex(c => normalise(c.phone) === normalise(phone));

  const now = new Date().toISOString();

  const record = {
    id:             existing >= 0 ? clients[existing].id : Date.now().toString(),
    clientName,
    phone,
    role,
    roleAbbrev:     roleAbbrev || '',
    handledBy,
    status:         'message_sent',
    messageSentAt:  now,
    lastActivityAt: now,
    clientRepliedAt:   null,
    clientReplyIntent: null,   // positive | negative | question | neutral
    sortedAt:          null,
    droppedAt:         null,
    followUpCount:     0,
    lastFollowUpAt:    null,
    notes:             existing >= 0 ? (clients[existing].notes || []) : [],
  };

  if (existing >= 0) {
    clients[existing] = record;
  } else {
    clients.push(record);
  }

  save(clients);
  return record;
}

// ─── Update status ─────────────────────────────────────────────

function updateStatus(identifier, status, extra = {}) {
  const clients = load();
  const idx = findIndex(clients, identifier);
  if (idx < 0) return null;

  const now = new Date().toISOString();
  clients[idx].status         = status;
  clients[idx].lastActivityAt = now;

  if (status === 'replied' || status === 'positive' || status === 'question' || status === 'negative') {
    clients[idx].clientRepliedAt = clients[idx].clientRepliedAt || now;
  }
  if (status === 'sorted')  clients[idx].sortedAt  = now;
  if (status === 'dropped') clients[idx].droppedAt = now;

  Object.assign(clients[idx], extra);
  save(clients);
  return clients[idx];
}

// ─── Add a note ────────────────────────────────────────────────

function addNote(identifier, noteText, author) {
  const clients = load();
  const idx = findIndex(clients, identifier);
  if (idx < 0) return null;

  clients[idx].notes.push({ text: noteText, author, at: new Date().toISOString() });
  clients[idx].lastActivityAt = new Date().toISOString();
  save(clients);
  return clients[idx];
}

// ─── Queries ───────────────────────────────────────────────────

function getByPhone(phone) {
  return load().find(c => normalise(c.phone) === normalise(phone)) || null;
}

function find(identifier) {
  const clients = load();
  const idx = findIndex(clients, identifier);
  return idx >= 0 ? clients[idx] : null;
}

function getAll() { return load(); }

function getActive() {
  return load().filter(c => c.status !== 'dropped');
}

function getSortedToday() {
  const midnight = new Date(); midnight.setHours(0,0,0,0);
  return load().filter(c => c.status === 'sorted' && new Date(c.sortedAt) >= midnight);
}

function getWaiting() {
  return load().filter(c => c.status === 'message_sent');
}

function getReplied() {
  return load().filter(c => ['replied','positive','question','neutral'].includes(c.status));
}

function getNeedingFollowUp(thresholdHours = 24) {
  const cutoff = Date.now() - thresholdHours * 60 * 60 * 1000;
  return load().filter(c => {
    if (['sorted','dropped','negative'].includes(c.status)) return false;
    return new Date(c.lastActivityAt).getTime() < cutoff;
  });
}

function isDuplicate(phone) {
  const existing = getByPhone(phone);
  return existing && !['completed','sorted','not_needed','dropped','negative'].includes(existing.status);
}

function deleteClient(phone) {
  const clients = load();
  const idx = clients.findIndex(c => normalise(c.phone) === normalise(phone));
  if (idx < 0) return null;
  const [removed] = clients.splice(idx, 1);
  save(clients);
  return removed;
}

// ─── Helpers ───────────────────────────────────────────────────

function normalise(phone) {
  // Strip spaces, dashes, dots, parens, AND the + prefix so
  // "+60123456789" and "60123456789" match each other
  return (phone || '').replace(/[\s\-().+]/g, '');
}

function findIndex(clients, identifier) {
  const norm = normalise(identifier);
  return clients.findIndex(c =>
    normalise(c.phone) === norm ||
    c.clientName.toLowerCase() === identifier.toLowerCase() ||
    c.clientName.toLowerCase().includes(identifier.toLowerCase())
  );
}

module.exports = {
  upsertClient,
  updateStatus,
  addNote,
  deleteClient,
  getByPhone,
  find,
  getAll,
  getActive,
  getSortedToday,
  getWaiting,
  getReplied,
  getNeedingFollowUp,
  isDuplicate,
};
