// ============================================================
//  ALPHA WHATSAPP BOT — CONFIGURATION
//  Edit this file to customise the bot for your business
// ============================================================

module.exports = {

  // ----- WhatsApp Group to monitor -----
  GROUP_NAME: 'Alpha the Hub',

  // ----- Your company details -----
  COMPANY_NAME: 'Alpha',
  PROPRIETOR_NAME: 'Immanuel',

  // ----- Google Form link shared with every client -----
  FORM_LINK: 'https://docs.google.com/forms/d/e/1FAIpQLScngxlRz2y4gb2Bx_EtcFL3Pz9a1GeChy8HEXJVfbb_B9jmWQ/viewform?usp=sharing',

  // ----- Company profile PDF -----
  PDF_PATH: './assets/Alpha-Profile.pdf',

  // ----- Staff (key = part of their WhatsApp display name) -----
  STAFF: {
    'Roslyn':   'Ms. Roslyn',
    'Mercy':    'Ms. Mercy',
    'Divya':    'Ms. Divya',
    'Immanuel': 'Immanuel',
  },

  // ----- Role abbreviations -----
  ROLES: {
    'BS':       'Babysitter / Nanny',
    'Bs':       'Babysitter / Nanny',
    'CK':       'Cook',
    'Ck':       'Cook',
    'HK':       'Housekeeper',
    'Hk':       'Housekeeper',
    'D':        'Driver',
    'EC':       'Elderly Care',
    'Ec':       'Elderly Care',
    'PC':       'Patient Care',
    'Pc':       'Patient Care',
    'S':        'Security',
    'Security': 'Security',
    'DH':       'Domestic Helper',
    'GW':       'General Worker',
    'T':        'Tutor',
  },

  // ----- Scheduling -----
  MORNING_BRIEFING_CRON: '30 8 * * *',   // 8:30 AM daily
  TIMEZONE: 'Asia/Kuala_Lumpur',

  // ----- Follow-up settings -----
  FOLLOW_UP_THRESHOLD_HOURS: 24,
  MAX_AUTO_FOLLOWUPS: 3,

  // ----- Web Dashboard port -----
  DASHBOARD_PORT: 3000,

  // ----- Group addressing -----
  ADDRESS_GROUP:  'Akkas',
  ADDRESS_SINGLE: 'Akka',

};
