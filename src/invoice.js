// ============================================================
//  INVOICE — Generate Alpha invoices (Puppeteer PNG)
// ============================================================

const fs   = require('fs');
const path = require('path');

const COUNTER_FILE   = path.resolve(__dirname, '../data/invoice-counter.json');
const INVOICES_DIR   = path.resolve(__dirname, '../data/invoices');
const PROCESSED_FILE = path.resolve(__dirname, '../data/invoiced-messages.json');

// ─── Processed Message Tracking ───────────────────────────────

function getProcessedIds() {
  try { return new Set(JSON.parse(fs.readFileSync(PROCESSED_FILE, 'utf8'))); }
  catch { return new Set(); }
}
function markProcessed(messageId) {
  const ids = getProcessedIds();
  ids.add(messageId);
  fs.writeFileSync(PROCESSED_FILE, JSON.stringify([...ids]));
}
function isProcessed(messageId) {
  return getProcessedIds().has(messageId);
}

// ─── Invoice Number Counter ────────────────────────────────────

function getNextInvoiceNumber() {
  try { return JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).next || 175; }
  catch { return 175; }
}
function saveInvoiceNumber(n) {
  fs.writeFileSync(COUNTER_FILE, JSON.stringify({ next: n }));
}

// ─── Parse group message ───────────────────────────────────────

function parseInvoiceMessage(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const numberedLines = lines.filter(l => /^\d+[.)]\s*.+/.test(l));
  if (numberedLines.length < 5) return null;

  const result = {};
  let regFeePaid = false;

  for (const line of lines) {
    // Match any variation: "(reg. fee paid)", "reg fee paid", "reg paid", "reg.paid" etc.
    if (/\(?reg\.?\s*(?:fee\s*)?paid\)?/i.test(line)) { regFeePaid = true; continue; }
    const m = line.match(/^(\d+)[.)]\s*(.+)$/);
    if (!m) continue;
    const num = parseInt(m[1]);
    const val = m[2].trim();
    switch (num) {
      case 1: result.clientName    = val; break;
      case 2: result.clientAddress = val; break;
      case 3: result.clientPhone   = val; break;
      case 4: result.roleAbbrev    = val.toUpperCase(); break;
      case 5: result.staffName     = val; break;
      case 6: result.salary        = parseSalary(val); break;
      case 7: result.joiningDate   = parseJoiningDate(val); break;
    }
  }

  if (!result.clientName || !result.staffName || !result.salary) return null;
  result.regFeePaid = regFeePaid;
  return result;
}

// ─── Helpers ───────────────────────────────────────────────────

function parseSalary(raw) {
  if (!raw) return 0;
  const s = raw.toString().toLowerCase().trim();

  // Match "22k", "22k/-", "22 k", "22K", "22,000k" — k anywhere after digits
  const kMatch = s.match(/(\d[\d,]*)\s*k/i);
  if (kMatch) {
    return parseInt(kMatch[1].replace(/,/g, '')) * 1000;
  }

  // Match plain numbers: "22000", "22,000", "₹22,000", "22,000/-"
  const numMatch = s.match(/(\d[\d,]*)/);
  if (numMatch) {
    const val = parseInt(numMatch[1].replace(/,/g, '')) || 0;
    // Sanity check: Indian domestic salaries are typically > ₹1,000
    // If parsed value looks like it was in thousands without a 'k' suffix
    // (e.g. someone wrote "22" meaning 22,000), we can't know for sure —
    // so just return what was parsed and let the reviewer catch it.
    return val;
  }

  return 0;
}
function parseJoiningDate(raw) {
  const parts = raw.split('.');
  if (parts.length === 3 && parts[2].length === 2)
    return `${parts[0]}.${parts[1]}.20${parts[2]}`;
  return raw;
}
function getRoleLabel(abbrev) {
  const roles = {
    'BS': 'Babysitter', 'CK': 'Cook', 'HK': 'Housekeeper',
    'D': 'Driver', 'EC': 'Elderly Care', 'PC': 'Patient Care',
    'S': 'Security', 'DH': 'Domestic Helper', 'GW': 'General Worker', 'T': 'Tutor',
  };
  return roles[abbrev?.toUpperCase()] || abbrev || 'Service';
}
function getStaffPrefix(roleAbbrev) {
  return roleAbbrev?.toUpperCase() === 'D' ? 'Mr.' : 'Ms.';
}

// Ensure client name always has Mr./Ms. prefix
// If the name already starts with a title, keep it. Otherwise default to Ms.
function ensureClientPrefix(name) {
  if (!name) return name;
  // Match "Ms. Name" OR "Ms.Name" (with or without space after period)
  if (/^(Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)/i.test(name.trim())) return name.trim();
  return 'Ms. ' + name.trim();
}

// Format Indian mobile: "9176270007" or "919176270007" → "+91 91762 70007"
function formatIndianPhone(raw) {
  if (!raw) return raw;
  let digits = String(raw).replace(/\D/g, '');
  // Strip country code if present
  if (digits.startsWith('91') && digits.length === 12) digits = digits.slice(2);
  if (digits.length !== 10) return raw; // can't format, return as-is
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

function formatCurrency(amount) {
  return '₹ ' + Number(amount).toLocaleString('en-IN');
}
function todayInvoiceDate() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${d.getFullYear()}`;
}
function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── HTML Template ─────────────────────────────────────────────

function buildInvoiceHTML(data) {
  const {
    invoiceNo, invoiceDate,
    clientName, clientAddress, clientPhone,
    staffName, roleAbbrev, joiningDate,
    salary, regFeePaid,
  } = data;

  const roleLabel      = getRoleLabel(roleAbbrev);
  const prefix         = getStaffPrefix(roleAbbrev);
  const clientNameFull = ensureClientPrefix(clientName);
  const clientPhoneFmt = formatIndianPhone(clientPhone);
  const serviceFee     = salary;
  const regFeeAmt      = regFeePaid ? 1000 : 0;
  const total          = serviceFee - regFeeAmt;

  const addressHTML = clientAddress
    ? esc(clientAddress).replace(/,\s*/g, ',<br>')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
  width: 794px;
  background: #fff;
  font-family: Arial, Helvetica, sans-serif;
  color: #111;
  font-size: 13px;
}
.header {
  background: #111;
  color: #fff;
  display: table;
  width: 100%;
  table-layout: fixed;
}
.header-left, .header-right {
  display: table-cell;
  vertical-align: middle;
  padding: 28px 36px;
}
.header-left { width: 55%; }
.header-right { width: 45%; text-align: right; }
.praise {
  font-size: 8.5px;
  letter-spacing: 3px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.35);
  margin-bottom: 14px;
}
.invoice-box {
  display: inline-block;
  border: 1px solid rgba(255,255,255,0.55);
  padding: 7px 22px 6px 22px;
  font-size: 22px;
  letter-spacing: 11px;
  font-weight: 300;
  color: #fff;
}
.alpha-logo {
  font-size: 54px;
  font-weight: 900;
  letter-spacing: -3px;
  line-height: 1;
  color: #fff;
  margin-bottom: 10px;
}
.company-address {
  font-size: 9px;
  line-height: 2;
  color: rgba(255,255,255,0.5);
  letter-spacing: 0.2px;
}
.accent-bar { height: 3px; background: #c9a84c; width: 100%; }
.meta {
  display: table;
  width: 100%;
  table-layout: fixed;
  padding: 26px 36px 22px;
  border-bottom: 1px solid #ebebeb;
}
.meta-left, .meta-right {
  display: table-cell;
  vertical-align: top;
  width: 50%;
}
.meta-right { text-align: right; }
.invoice-number { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; margin-bottom: 5px; }
.invoice-date { font-size: 11.5px; color: #888; letter-spacing: 0.2px; }
.billed-label {
  font-size: 8.5px; letter-spacing: 2.5px;
  text-transform: uppercase; color: #bbb; margin-bottom: 7px; font-weight: 600;
}
.billed-name { font-size: 14px; font-weight: 700; margin-bottom: 4px; color: #111; }
.billed-address { font-size: 11px; line-height: 1.75; color: #777; }
.billed-phone { font-size: 12px; color: #444; margin-top: 4px; font-weight: 600; }
.section { padding: 24px 36px 0; }
.svc-table { width: 100%; border-collapse: collapse; }
.svc-table th {
  text-align: left; font-size: 8.5px; letter-spacing: 2px;
  text-transform: uppercase; color: #bbb; font-weight: 600;
  padding-bottom: 10px; border-bottom: 1px solid #ebebeb;
}
.svc-table td { padding: 14px 0 0; font-size: 13px; color: #222; vertical-align: top; }
.role-tag {
  display: inline-block; background: #111; color: #fff;
  font-size: 9.5px; padding: 3px 9px; border-radius: 2px; margin-top: 6px;
  letter-spacing: 0.5px;
}
.col-date { text-align: center; }
.col-salary { text-align: right; font-size: 15px; font-weight: 700; letter-spacing: -0.5px; }
.amount-wrap { padding: 28px 36px 0; }
.amount-table {
  width: 400px; margin: 0 auto;
  border-collapse: collapse; border: 1px solid #e0e0e0;
}
.amount-table th {
  background: #f9f9f9; font-size: 8.5px; letter-spacing: 2px;
  text-transform: uppercase; color: #bbb; font-weight: 600;
  padding: 11px 20px; border-bottom: 1px solid #e0e0e0; text-align: center;
}
.amount-table th.c1 { border-right: 1px solid #e0e0e0; width: 55%; }
.amount-table td { padding: 16px 20px; font-size: 13px; text-align: center; color: #333; }
.amount-table td.c1 { border-right: 1px solid #e0e0e0; font-weight: 600; color: #222; }
.sub-line { display: block; font-size: 11px; color: #bbb; margin-top: 6px; }
.spacer td { padding: 4px; }
.total-wrap { width: 400px; margin: 0 auto; }
.total-inner {
  display: table; width: 100%;
  border-top: 2px solid #111; margin-top: 12px; padding-top: 11px;
}
.total-inner .tl, .total-inner .tr { display: table-cell; font-size: 15px; font-weight: 700; letter-spacing: -0.3px; }
.total-inner .tr { text-align: right; }
.divider { margin: 26px 36px; border: none; border-top: 1px solid #ebebeb; }
.payment-wrap { text-align: center; padding: 0 36px; }
.pay-title {
  font-size: 8.5px; letter-spacing: 3px; text-transform: uppercase;
  color: #ccc; margin-bottom: 16px; font-weight: 600;
}
.pay-grid { display: inline-block; text-align: left; }
.pay-row { font-size: 12px; margin-bottom: 9px; color: #666; line-height: 1; }
.pay-row b { color: #111; margin-right: 6px; font-weight: 700; }
.note {
  text-align: center; padding: 20px 60px 26px;
  font-size: 11px; color: #aaa; line-height: 1.9;
}
.note strong { color: #555; font-weight: 600; }
.footer {
  background: #111; color: rgba(255,255,255,0.4);
  text-align: center; font-size: 9.5px;
  letter-spacing: 2.5px; padding: 14px;
}
</style>
</head>
<body>

<div class="header">
  <div class="header-left">
    <div class="praise">Praise the Lord</div>
    <div class="invoice-box">Invoice</div>
  </div>
  <div class="header-right">
    <div class="alpha-logo">alpha</div>
    <div class="company-address">
      7/4, Venkataswamy Street, Santhome<br>
      Chennai 600 004<br>
      reachus@alphathehub.com<br>
      8072585058 &nbsp;/&nbsp; 8056445058 &nbsp;/&nbsp; 8056635058
    </div>
  </div>
</div>

<div class="accent-bar"></div>

<div class="meta">
  <div class="meta-left">
    <div class="invoice-number">Invoice No. ${invoiceNo}</div>
    <div class="invoice-date">Date: ${esc(invoiceDate)}</div>
  </div>
  <div class="meta-right">
    <div class="billed-label">Billed to</div>
    <div class="billed-name">${esc(clientNameFull)}</div>
    ${addressHTML    ? `<div class="billed-address">${addressHTML}</div>` : ''}
    ${clientPhoneFmt ? `<div class="billed-phone">${esc(clientPhoneFmt)}</div>` : ''}
  </div>
</div>

<div class="section">
  <table class="svc-table">
    <thead>
      <tr>
        <th style="width:42%;">Staff &amp; Service</th>
        <th style="width:33%;text-align:center;">Date of Joining</th>
        <th style="width:25%;text-align:right;">Salary</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>
          ${esc(prefix)} ${esc(staffName)}
          <div class="role-tag">${esc(roleLabel)}</div>
        </td>
        <td class="col-date">${esc(joiningDate || '—')}</td>
        <td class="col-salary">${formatCurrency(salary)}</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="amount-wrap">
  <table class="amount-table">
    <thead>
      <tr>
        <th class="c1">For</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="c1">
          Service Fee
          ${regFeePaid ? '<span class="sub-line">Reg. Fee (Paid)</span>' : ''}
        </td>
        <td>
          ${formatCurrency(serviceFee)}
          ${regFeePaid ? '<span class="sub-line">- ₹ 1,000</span>' : ''}
        </td>
      </tr>
      <tr class="spacer"><td></td><td></td></tr>
    </tbody>
  </table>
  <div class="total-wrap">
    <div class="total-inner">
      <div class="tl">Total</div>
      <div class="tr">${formatCurrency(total)}</div>
    </div>
  </div>
</div>

<hr class="divider">

<div class="payment-wrap">
  <div class="pay-title">Payment Details</div>
  <div class="pay-grid">
    <div class="pay-row"><b>Account Name:</b> Alpha the Hub</div>
    <div class="pay-row"><b>Account Number:</b> 44190854401</div>
    <div class="pay-row"><b>IFSC Code:</b> SBIN0005797</div>
    <div class="pay-row"><b>UPI ID:</b> alphathehub@sbi</div>
  </div>
</div>

<div class="note">
  We don't do refunds but can provide with a replacement.<br>
  Thank you for choosing <strong>Alpha!</strong>
</div>

<div class="footer">www.alphathehub.com</div>

</body>
</html>`;
}

// ─── Generate Invoice PNG via Puppeteer ────────────────────────

async function generateInvoicePDF(invoiceData) {
  if (!fs.existsSync(INVOICES_DIR)) fs.mkdirSync(INVOICES_DIR, { recursive: true });

  const invoiceNo   = getNextInvoiceNumber();
  const invoiceDate = invoiceData.invoiceDate || todayInvoiceDate();
  const data        = { ...invoiceData, invoiceNo, invoiceDate };

  const html     = buildInvoiceHTML(data);
  const safeName = (data.clientName || 'Client').replace(/[^\w .\-]/g, '').trim();
  const filename = `${invoiceNo}-${safeName}.png`;
  const outPath  = path.join(INVOICES_DIR, filename);

  const puppeteer = require('puppeteer');
  const browser   = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-web-security'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });

    // Wait a tick for layout to settle
    await new Promise(r => setTimeout(r, 300));

    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    await page.setViewport({ width: 794, height: bodyHeight, deviceScaleFactor: 2 });

    const pngBuffer = await page.screenshot({
      type: 'png',
      fullPage: true,
    });

    fs.writeFileSync(outPath, pngBuffer);
  } finally {
    await browser.close();
  }

  saveInvoiceNumber(invoiceNo + 1);
  return { invoiceNo, filename, path: outPath };
}

module.exports = {
  parseInvoiceMessage,
  generateInvoicePDF,
  getRoleLabel,
  getStaffPrefix,
  ensureClientPrefix,
  formatIndianPhone,
  getNextInvoiceNumber,
  markProcessed,
  isProcessed,
};
