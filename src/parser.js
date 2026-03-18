// ============================================================
//  PARSER — Reads group messages and extracts meaning
// ============================================================

const config = require('../config');

// ─── Client Entry Detection ────────────────────────────────────
//
// Handles ALL of these formats (no strict labels required):
//
//   Rufuina               ← name only line
//   +60123456789          ← phone (with or without +)
//   BS                    ← role abbreviation (optional)
//
//   Client: Rufuina       ← labeled format also works
//   Ph: +60123456789
//   Cook
//
//   Rufuina +60123456789 BS   ← single line also works
//
// Returns { clientName, phone, role, roleAbbrev } or null

function parseClientEntry(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);

  let clientName = null;
  let phone      = null;
  let roleAbbrev = null;

  // ── Single-line format: "Rufuina +60123456789 BS" ──────────
  if (lines.length === 1) {
    const sl = lines[0];
    const phoneInLine = sl.match(/(\+?[\d]{10,15})/);
    if (phoneInLine) {
      phone = normalisePhone(phoneInLine[1]);
      const rest = sl.replace(phoneInLine[0], '').trim();
      // Try to split rest into name + role
      const roleKeys = Object.keys(config.ROLES);
      for (const k of roleKeys) {
        const ri = rest.search(new RegExp(`\\b${escapeRegex(k)}\\b`, 'i'));
        if (ri >= 0) {
          roleAbbrev = k;
          const namePart = (rest.slice(0, ri) + rest.slice(ri + k.length)).trim();
          if (namePart) clientName = namePart;
          break;
        }
      }
      if (!clientName && rest) clientName = rest;
    }
    if (clientName && phone) {
      const role = config.ROLES[roleAbbrev] || roleAbbrev || '';
      return { clientName: clientName.trim(), phone, role, roleAbbrev: roleAbbrev || '' };
    }
  }

  // ── Multi-line format ──────────────────────────────────────
  for (const line of lines) {

    // Labeled: "Client: Name" / "Name: X"
    const clientMatch = line.match(/^(?:client|name|naam|customer)\s*:\s*(.+)$/i);
    if (clientMatch) { clientName = clientMatch[1].trim(); continue; }

    // Labeled phone: "Ph: +60..." / "Phone:" / "No:" / "Mob:" / "HP:"
    const phoneMatch = line.match(/^(?:ph|phone|no|number|mob|mobile|num|contact|hp|tel)\s*:\s*(\+?[\d\s\-().]{7,20})$/i);
    if (phoneMatch) { phone = normalisePhone(phoneMatch[1]); continue; }

    // Bare phone number — 10+ digits, may start with + or country code
    const barePhone = line.match(/^(\+?[\d\s\-().]{10,20})$/);
    if (barePhone && !phone) { phone = normalisePhone(barePhone[1]); continue; }

    // Role abbreviation — must match config exactly (case-insensitive)
    const roleKeys = Object.keys(config.ROLES);
    const matchedRole = roleKeys.find(k => line.toLowerCase() === k.toLowerCase());
    if (matchedRole) { roleAbbrev = matchedRole; continue; }

    // Role as full word (e.g. "Cook", "Driver")
    const fullRoles = Object.values(config.ROLES);
    const matchedFull = fullRoles.find(r => line.toLowerCase() === r.toLowerCase());
    if (matchedFull) {
      // find the key for this value
      roleAbbrev = Object.keys(config.ROLES).find(k => config.ROLES[k].toLowerCase() === matchedFull.toLowerCase());
      continue;
    }

    // Name line: letters + spaces + common name chars, no digits, not too long
    if (!clientName && !line.includes(':') && /^[a-zA-Z\s'.\/\-]{2,50}$/.test(line)) {
      clientName = line;
      continue;
    }
  }

  if (!clientName || !phone) return null;

  const role = config.ROLES[roleAbbrev] || roleAbbrev || '';
  return { clientName: clientName.trim(), phone, role, roleAbbrev: roleAbbrev || '' };
}

// ─── Status Commands ───────────────────────────────────────────

function parseCommand(text) {
  const t = text.trim();

  if (/^status\s*$/i.test(t))     return { command: 'status',   identifier: null };
  if (/^help\s*$/i.test(t))       return { command: 'help',     identifier: null };
  if (/^briefing\s*$/i.test(t))   return { command: 'briefing', identifier: null };

  const sorted   = t.match(/^sorted\s+(.+)$/i);
  if (sorted)   return { command: 'sorted',   identifier: sorted[1].trim() };

  const followup = t.match(/^followup\s+(.+)$/i);
  if (followup) return { command: 'followup', identifier: followup[1].trim() };

  const drop     = t.match(/^drop\s+(.+)$/i);
  if (drop)     return { command: 'drop',     identifier: drop[1].trim() };

  const note     = t.match(/^note\s+([^\s]+)\s+(.+)$/i);
  if (note)     return { command: 'note',     identifier: note[1].trim(), note: note[2].trim() };

  return null;
}

// ─── Smart Response Analysis ───────────────────────────────────
//
// Returns one of:
//   form_filled      — client says they filled / submitted the form
//   link_request     — client is asking for the form link again
//   price_inquiry    — asking about salary, pay, cost, rate
//   availability_query — asking about timing, when, how long
//   not_interested   — declining, not needed, cancel
//   asking_update    — asking for a status update / follow-up
//   general_question — has a question (contains ?) but doesn't fit above
//   confirmed        — simple ack: ok, noted, thanks (NOT actionable)
//   neutral          — anything else (NOT actionable)

function analyseClientReply(replyText) {
  const t = replyText.toLowerCase().trim();

  // ── Form filled ──────────────────────────────────────────────
  if (/fill(ed)?|submit(ted)?|done|completed?|sent (it|form)|already (sent|filled|submitted)|i (have |did )?fill|(form|application) (done|sent|submitted|filled)/.test(t)) {
    return 'form_filled';
  }

  // ── Asking to resend the link ────────────────────────────────
  if (/send.*(link|form)|link.*(again|please|pls|send)|(resend|re-send)|what.*(link|url)|can (i|you) (have|get) (the )?link|(form|link) (please|pls)|where.*(form|link)/.test(t)) {
    return 'link_request';
  }

  // ── Asking about not wanting the service ─────────────────────
  if (/not (interested|required|needed|looking)|don'?t (need|want|require)|no (longer|need|thank)|cancel|stop (message|contact|sending)|remove (me|my)|unsubscribe|not (now|anymore)|nope|decline/.test(t)) {
    return 'not_interested';
  }

  // ── Asking about pay / salary / cost ────────────────────────
  if (/salary|pay(ment)?|how much|cost|rate|fee|charges|price|budget|monthly|per (month|day|hour)|ringgit|rm \d|wages/.test(t)) {
    return 'price_inquiry';
  }

  // ── Asking about timing / availability ──────────────────────
  if (/(how (long|soon)|when (can|will|do|would)|how (many days|quickly)|start date|available (from|when)|can (you|they) start|how fast|timeline|urgently?|asap)/.test(t)) {
    return 'availability_query';
  }

  // ── Asking for an update / follow-up ─────────────────────────
  if (/(any (update|news|progress|reply)|still waiting|following up|heard back|any response|update please|what happened|checking in|just checking|get back to me)/.test(t)) {
    return 'asking_update';
  }

  // ── General question (has a ? or question words) ─────────────
  if (/\?|what |how |when |where |who |which |can you |could you |do you |is there |are there |tell me/.test(t)) {
    return 'general_question';
  }

  // ── Simple acknowledgement — NOT actionable ──────────────────
  if (/^(ok|okay|k|noted|thanks|thank you|tq|ty|alright|sure|received|got it|understood|will do|np|no problem|fine|good|great|noted\.?|👍|😊|🙏)\.?\s*$/.test(t)) {
    return 'confirmed';
  }

  return 'neutral';
}

// ─── Helpers ───────────────────────────────────────────────────

function normalisePhone(raw) {
  const digits = raw.replace(/[\s\-().]/g, '');
  return digits.startsWith('+') ? digits : '+' + digits;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getStaffDisplayName(senderName) {
  if (!senderName) return 'a team member';
  for (const [key, display] of Object.entries(config.STAFF)) {
    if (senderName.toLowerCase().includes(key.toLowerCase())) return display;
  }
  return senderName;
}

module.exports = { parseClientEntry, parseCommand, analyseClientReply, getStaffDisplayName };
