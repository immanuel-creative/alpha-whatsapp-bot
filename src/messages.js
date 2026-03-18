// ============================================================
//  MESSAGES — All message templates used by the bot
// ============================================================

const config = require('../config');

const G  = config.ADDRESS_GROUP;
const CO = config.COMPANY_NAME;
const ME = config.PROPRIETOR_NAME;

// ─── Sent to the CLIENT (private chat) — no emojis ────────────

function initialClientMessage(clientName, staffDisplayName, role) {
  const title = clientName.trim(); // Use name as-is; staff should include title when logging client

  if (!role || role.trim() === '') {
    return (
`Hello ${title},

Thank you for reaching out to *${CO}*. ${staffDisplayName} has passed on your details and we are glad to connect with you.

To help us serve you better, kindly fill up our form at your earliest convenience:

${config.FORM_LINK}

We have also attached our company profile for your reference. Please feel free to call or message us at any time.

Thank you.`
    );
  }

  return (
`Hello ${title},

This is ${ME} from *${CO}*. You have spoken to ${staffDisplayName} regarding a *${role}*.

Kindly fill up our form so we can understand your requirements better:

${config.FORM_LINK}

We have also attached our company profile for your reference. Please feel free to reach out at any time.

Thank you.`
  );
}

function followUpMessage(clientName, followUpNum) {
  const templates = [
    `Hi ${clientName},\n\nThis is a gentle reminder from *${CO}*.\n\nHave you had a chance to fill our form? We would love to get started on finding the right person for you.\n\n${config.FORM_LINK}\n\nThank you.`,
    `Hello ${clientName},\n\nThis is *${CO}* following up with you.\n\nWe noticed the form has not been filled yet. We are here whenever you are ready.\n\n${config.FORM_LINK}\n\nPlease fill it up and we will take it from there. Thank you.`,
    `Hi ${clientName},\n\nThis is a final follow-up from *${CO}*.\n\nWe would love to help. Please fill the form at your convenience.\n\n${config.FORM_LINK}\n\nFeel free to call or message us at any time. Thank you.`,
  ];
  return templates[Math.min(followUpNum, templates.length - 1)];
}

// ─── Auto-reply sent back to CLIENT when they respond ──────────
// Each intent gets a specific, contextual reply — not a generic one.

function clientAutoReply(clientName, intent) {
  const title = clientName.trim(); // Use name as-is; staff should include title when logging client

  switch (intent) {

    case 'form_filled':
      return (
`Thank you, ${title}.

We have received your submission. Our team will review it and get back to you shortly.

Thank you.`
      );

    case 'link_request':
      return (
`Hi ${title},

Here is our form link:

${config.FORM_LINK}

Please fill it at your convenience and our team will take it from there. Thank you.`
      );

    case 'price_inquiry':
      return (
`Thank you for your message, ${title}.

Our team has noted your query regarding the details and will get back to you shortly with the relevant information.

Thank you.`
      );

    case 'availability_query':
      return (
`Thank you for your message, ${title}.

Our team has noted your query and will get back to you shortly with more information.

Thank you.`
      );

    case 'not_interested':
      return (
`Understood, ${title}.

Thank you for letting us know. Should your requirements change in the future, please do not hesitate to reach out. We are always happy to help.

Thank you.`
      );

    case 'asking_update':
      return (
`Hi ${title},

Thank you for following up. Our team has been notified and will reach out to you shortly.

Thank you.`
      );

    case 'general_question':
      return (
`Thank you for your message, ${title}.

Our team has been notified of your query and will respond to you shortly.

Thank you.`
      );

    case 'confirmed':
      return (
`Thank you, ${title}. We will be in touch shortly.`
      );

    default:
      return (
`Thank you for your message, ${title}.

Our team will be in touch with you shortly.

Thank you.`
      );
  }
}

// ─── Auto-reply for UNKNOWN numbers (not in client list) ───────
// Responds contextually without assuming a name.

function unknownAutoReply(intent) {
  switch (intent) {
    case 'form_filled':
      return `Thank you for letting us know. Our team will review your submission and get back to you shortly.\n\nThank you.`;

    case 'link_request':
      return `Here is our form link:\n\n${config.FORM_LINK}\n\nPlease fill it at your convenience and our team will be in touch.\n\nThank you.`;

    case 'price_inquiry':
      return `Thank you for your interest. Our team will get back to you shortly with the relevant details.\n\nThank you.`;

    case 'availability_query':
      return `Thank you for reaching out. Our team will get back to you shortly with more information.\n\nThank you.`;

    case 'not_interested':
      return `Understood, thank you for letting us know. Should your requirements change, please do not hesitate to reach out.\n\nThank you.`;

    case 'asking_update':
      return `Thank you for following up. Our team will get back to you shortly.\n\nThank you.`;

    case 'general_question':
      return `Thank you for your message. Our team will get back to you shortly with more information.\n\nThank you.`;

    case 'confirmed':
      return `Thank you. Our team will be in touch shortly.`;

    default:
      return `Thank you for reaching out to *${config.COMPANY_NAME}*. How may we help you today?\n\nThank you.`;
  }
}

// ─── Sent to the GROUP ─────────────────────────────────────────

function messageSentConfirmation(client, staffDisplayName) {
  return `✅ *${client.clientName}* (${client.role || 'General'}) — message sent by ${staffDisplayName}`;
}

function duplicateWarning(client) {
  return (
`⚠️ *${G}* — *${client.clientName}* (${client.phone}) was already contacted on ` +
`${fmtDate(client.messageSentAt)} by ${client.handledBy}.\n` +
`Status: *${statusLabel(client.status)}*\n\n` +
`Type \`sorted ${client.clientName}\` to close, or \`followup ${client.phone}\` to resend.`
  );
}

// Returns null if this reply is NOT worth notifying the group about.
// Caller should check: if (msg) safeGroupSend(msg)
function clientRepliedAlert(client, intent) {
  const name = client.clientName;
  const role = client.role ? ` (${client.role})` : '';
  const handler = client.handledBy ? ` — handled by ${client.handledBy}` : '';

  switch (intent) {
    case 'form_filled':
      return `${name}${role} has filled the form. Good to proceed${handler}.`;

    case 'link_request':
      return `${name}${role} asked for the form link again. Link has been resent${handler}.`;

    case 'price_inquiry':
      return `${name}${role} is asking about the salary or details. Please follow up${handler}.`;

    case 'availability_query':
      return `${name}${role} has a question about timing. Please follow up${handler}.`;

    case 'not_interested':
      return `${name}${role} has declined our service. Consider closing this lead${handler}.`;

    case 'asking_update':
      return `${name}${role} is asking for an update. Please follow up${handler}.`;

    case 'general_question':
      return `${name}${role} has a question. Please check and reply${handler}.`;

    // 'confirmed' and 'neutral' are NOT worth pinging the group about
    default:
      return null;
  }
}

function followUpSentConfirmation(client, staffDisplayName) {
  return `Follow-up #${client.followUpCount + 1} sent to *${client.clientName}* by ${staffDisplayName}`;
}

function sortedAck(client, staffDisplayName) {
  return `*${client.clientName}* marked as completed by ${staffDisplayName}.`;
}

function droppedAck(client, staffDisplayName) {
  return `*${client.clientName}* marked as not needed by ${staffDisplayName}.`;
}

function noteAck(client, noteText, staffDisplayName) {
  return `Note on *${client.clientName}* by ${staffDisplayName}: _"${noteText}"_`;
}

function notFoundMsg(identifier) {
  return `Cannot find "*${identifier}*". Check the name or number.`;
}

// ─── Morning Briefing ──────────────────────────────────────────

function morningBriefing(waiting, replied, needsFollowUp, dashboardUrl) {
  const today = new Date().toLocaleDateString('en-MY', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  let msg = `Good morning, *${G}!* — ${today}\n`;

  if (!waiting.length && !replied.length && !needsFollowUp.length) {
    msg += `\nAll clear! No pending clients. Great work!\n`;
  } else {
    if (needsFollowUp.length) {
      msg += `\n*Needs follow-up (${needsFollowUp.length}):*\n`;
      needsFollowUp.forEach(c => {
        msg += `- *${c.clientName}* — ${c.role || 'General'} | ${timeSince(c.lastActivityAt)} | ${c.handledBy}\n`;
      });
    }
    if (replied.length) {
      msg += `\n*Replied — action needed (${replied.length}):*\n`;
      replied.forEach(c => msg += `- *${c.clientName}* — ${c.role || 'General'} | ${c.handledBy}\n`);
    }
    if (waiting.length) {
      msg += `\n*Awaiting reply (${waiting.length}):*\n`;
      waiting.forEach(c => msg += `- *${c.clientName}* — ${c.role || 'General'} | sent ${timeSince(c.messageSentAt)}\n`);
    }
    msg += `\nReply here with updates, e.g. _"Rufuina sorted"_`;
  }

  if (dashboardUrl) msg += `\n\nDashboard: ${dashboardUrl}`;
  return msg;
}

// ─── Status Report ─────────────────────────────────────────────

function statusReport(clients) {
  if (!clients.length) return `No active clients tracked yet.`;
  let msg = `*Client Status (${clients.length})*\n`;
  clients.forEach(c => {
    msg += `\n- *${c.clientName}* — ${c.role || 'General'}\n  ${statusLabel(c.status)} | ${timeSince(c.lastActivityAt)} ago | ${c.handledBy}`;
  });
  return msg;
}

// ─── Help ──────────────────────────────────────────────────────

function helpMessage(dashboardUrl) {
  let msg =
`*Alpha Bot Commands*\n\n` +
`*Log a client:*\nClient: [Name]\nPh: [+number]\n[Role: BS / CK / HK / D / EC / PC / S]\n\n` +
`\`sorted [name]\` — mark completed\n` +
`\`followup [name]\` — send follow-up\n` +
`\`drop [name]\` — mark not needed\n` +
`\`note [name] text\` — add note\n` +
`\`status\` — see all clients\n` +
`\`briefing\` — morning report now\n` +
`\`help\` — this list`;
  if (dashboardUrl) msg += `\n\nDashboard: ${dashboardUrl}`;
  return msg;
}

// ─── Utilities ─────────────────────────────────────────────────

function statusLabel(status) {
  return {
    new:              'New',
    message_sent:     'New',
    followed_up:      'New',
    replied:          'New',
    neutral:          'New',
    positive:         'New',
    trial_period:     'Trial Period',
    awaiting_payment: 'Trial Period',
    completed:        'Completed',
    sorted:           'Completed',
    issues:           'Issues',
    question:         'Issues',
    not_needed:       'Not Needed',
    negative:         'Not Needed',
    dropped:          'Not Needed',
  }[status] || status;
}

function timeSince(isoString) {
  if (!isoString) return '?';
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)  return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function fmtDate(isoString) {
  if (!isoString) return '?';
  return new Date(isoString).toLocaleDateString('en-MY', { day:'numeric', month:'short' });
}

module.exports = {
  initialClientMessage, followUpMessage, clientAutoReply, unknownAutoReply,
  messageSentConfirmation, duplicateWarning,
  clientRepliedAlert, followUpSentConfirmation,
  sortedAck, droppedAck, noteAck, notFoundMsg,
  morningBriefing, statusReport, helpMessage,
  statusLabel, timeSince,
};
