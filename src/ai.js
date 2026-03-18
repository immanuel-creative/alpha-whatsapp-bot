// ============================================================
//  AI — Claude-powered reply generation
//  Replaces keyword templates with actual contextual responses
// ============================================================

const Anthropic = require('@anthropic-ai/sdk');
const config    = require('../config');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are the WhatsApp assistant for ${config.COMPANY_NAME}, a manpower agency in Malaysia that connects clients with domestic workers — babysitters, nannies, cooks, housekeepers, drivers, elderly care workers, patient care workers, and security staff.

You reply to incoming WhatsApp messages from clients on behalf of ${config.COMPANY_NAME}.

Rules:
- Be professional, warm, and concise — 1 to 3 sentences maximum
- Never use emojis
- Never start a message with "Hello" or "Hi"
- Always end with "Thank you." on its own line
- Never make up specific prices, salaries, timelines, or availability — say the team will follow up
- Never promise anything specific
- If they mention filling or submitting the form → acknowledge and say the team will review and be in touch
- If they ask for the form link → share it: ${config.FORM_LINK}
- If they ask about salary, pay, or cost → say the team will get back with the details
- If they ask about timing or when someone can start → say the team will follow up with more information
- If they are not interested or want to cancel → thank them and say they can reach out anytime
- If they ask for an update → say the team has been notified and will follow up shortly
- If it's a general question → say the team will get back with more information
- Write naturally — like a real person at a professional company, not a bot`;

// ─── Generate a reply for a KNOWN client ──────────────────────

async function replyToClient(clientName, clientRole, messageText) {
  const context = clientRole
    ? `Client: ${clientName}, enquiring about: ${clientRole}`
    : `Client: ${clientName}`;

  const userPrompt = `${context}\n\nTheir message: "${messageText}"\n\nWrite a reply.`;

  return await callClaude(userPrompt);
}

// ─── Generate a reply for an UNKNOWN number ───────────────────

async function replyToUnknown(messageText) {
  const userPrompt = `Someone messaged ${config.COMPANY_NAME} on WhatsApp. We do not have their name on file.\n\nTheir message: "${messageText}"\n\nWrite a reply.`;

  return await callClaude(userPrompt);
}

// ─── Extract client entries from raw group message texts ──────
// Used by the scan-backlog endpoint to find clients even in
// non-standard message formats that the regex parser misses.

async function extractClientsFromMessages(messageTexts) {
  if (!messageTexts || messageTexts.length === 0) return [];

  // Batch to avoid token overflow — Claude Haiku handles ~80 messages well
  const batches = [];
  for (let i = 0; i < messageTexts.length; i += 80) {
    batches.push(messageTexts.slice(i, i + 80));
  }

  const allClients = [];
  const seenPhones = new Set();

  for (const batch of batches) {
    const content = batch.join('\n---\n');
    let result;
    try {
      result = await anthropic.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system: `You extract client registration entries from WhatsApp messages for a Malaysian manpower agency.

A client entry is when staff registers a new client. It contains:
- A person's name (may have Ms./Mr./Mrs./Dr./Dato/Datin prefix)
- A Malaysian phone number (starts with +60, 60, or 0)
- Optionally: a role (Cook, Housekeeping/HK, Driver, Babysitter/BS, Elderly Care/EC, Patient Care/PC, Security/S, General Worker/GW, Dispatch/D, Despatch/DH, Tutor/T)

Return ONLY a valid JSON array with no extra text:
[{"clientName":"Ms. Firstname","phone":"+60XXXXXXXXX","role":"Cook","roleAbbrev":"CK"}]

Rules:
- Normalize all phone numbers to +60XXXXXXXXX format (Malaysian: 60 or 0 prefix → +60)
- Keep the name exactly as written including any title
- If no role is mentioned, use "" for role and roleAbbrev
- Skip duplicates (same phone number)
- Return [] if no client entries are found
- Do NOT include messages that are just conversations, not client registrations`,
        messages: [{ role: 'user', content: `Extract client entries from these WhatsApp messages:\n\n${content}` }],
      });
    } catch (err) {
      console.error('[AI] extractClientsFromMessages error:', err.message);
      continue;
    }

    try {
      const text = result.content[0].text.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;
      const parsed = JSON.parse(jsonMatch[0]);
      for (const c of parsed) {
        if (!c.phone) continue;
        const digits = c.phone.replace(/\D/g, '');
        if (seenPhones.has(digits)) continue;
        seenPhones.add(digits);
        allClients.push(c);
      }
    } catch (e) {
      console.error('[AI] extractClientsFromMessages JSON parse error:', e.message);
    }
  }

  return allClients;
}

// ─── Core API call ────────────────────────────────────────────

async function callClaude(userPrompt) {
  const response = await anthropic.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 220,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  });

  return response.content[0].text.trim();
}

module.exports = { replyToClient, replyToUnknown, extractClientsFromMessages };
