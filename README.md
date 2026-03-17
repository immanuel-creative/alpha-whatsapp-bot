# 🤖 Alpha WhatsApp Bot

Automated client outreach, follow-up tracking, and daily briefings for **Alpha Manpower Agency**.

---

## What it does

| Feature | How it works |
|---|---|
| **Auto-send** | Staff posts a client entry in the group → bot instantly sends personalised message + company profile PDF + form link to the client |
| **Duplicate guard** | If the same client number is posted again, the bot warns the team instead of spamming the client |
| **Client reply detection** | When a client replies privately, the bot analyses their intent (interested / has questions / not interested) and alerts the group |
| **Morning briefing** | Every morning at 8:30 AM the bot posts a full status roundup to the group — who's sorted, who needs chasing |
| **6-hour stale check** | If any client has had no activity for 24+ hours, the bot nudges the team |
| **Manual commands** | Staff can type commands in the group to update client status, send follow-ups, add notes, and more |

---

## Setup (One-time, 10 minutes)

### 1. Install Node.js
Download and install **Node.js 18+** from https://nodejs.org (LTS version).

### 2. Install the bot
Open **Terminal** (Mac) or **Command Prompt** (Windows), navigate to this folder, and run:

```
npm install
```

This downloads all dependencies (~5 min first time, includes a headless Chrome).

### 3. Start the bot
```
npm start
```

A QR code will appear in the terminal.

### 4. Link your WhatsApp Business
1. Open **WhatsApp Business** on your phone
2. Tap **⋮ (three dots)** → **Linked Devices** → **Link a Device**
3. Scan the QR code in the terminal

The bot is now live! ✅

### 5. Keep it running
- Leave the terminal window open while working
- To stop: press `Ctrl + C`
- Next time you start it, no QR scan needed (session is saved automatically)

> **Tip:** If you want the bot running 24/7 on a computer, install [PM2](https://pm2.keymetrics.io/) and run `pm2 start index.js --name alpha-bot`

---

## How to log a client (in the group)

Type this in **Alpha the Hub**:

```
Client: Rufuina
Ph: +919962896903
Bs
```

The bot will:
1. Send Rufuina a personalised message from the staff member who posted
2. Attach the Alpha company profile PDF
3. Share the Google Form link
4. Confirm in the group: ✅ Message sent to Rufuina

**Role abbreviations:**

| Code | Role |
|---|---|
| Bs | Babysitter |
| DH | Domestic Helper |
| CG | Caregiver |
| EC | Elderly Caregiver |
| D | Driver |
| Cook | Cook |
| GW | General Worker |
| SG | Security Guard |
| Cl | Cleaner |
| G | Gardener |
| T | Tutor |

Need a new role? Add it to `config.js` → `ROLES`.

---

## Group commands

Type these in **Alpha the Hub**:

| Command | What it does |
|---|---|
| `sorted Rufuina` | Mark client as done ✅ |
| `followup Rufuina` | Send a follow-up message to the client |
| `drop Rufuina` | Close/drop a lead |
| `note Rufuina Spoke to her, waiting on husband` | Add a private note |
| `status` | Show all active clients and their status |
| `briefing` | Trigger the morning briefing right now |
| `help` | Show all commands |

You can use a client's name or their phone number in any command.

---

## Client status flow

```
📨 message_sent
      ↓ (client replies)
💬 replied / ✅ positive / ❓ question / ❌ negative
      ↓ (staff action)
✔️  sorted  or  🗂️ dropped
```

---

## Files

```
alpha-whatsapp-bot/
├── index.js          ← Main bot (don't need to edit)
├── config.js         ← All your settings (edit this)
├── src/
│   ├── parser.js     ← Reads group messages
│   ├── tracker.js    ← Client database
│   └── messages.js   ← All message templates
├── data/
│   └── clients.json  ← Client records (auto-managed)
├── assets/
│   └── Alpha-Profile.pdf   ← Your company profile
└── package.json
```

To change any message wording, edit `src/messages.js`.

---

## 🔍 Pain Points Identified (Beyond the Bot)

Based on how a manpower agency operates, here are additional inefficiencies the bot is designed to handle, plus future upgrades to consider:

### Already solved by this bot
- ✅ Forgetting to send the intro message and form
- ✅ Sending duplicate messages to the same client
- ✅ Not knowing which staff member handled which client
- ✅ Forgetting to follow up with clients who haven't replied
- ✅ No visibility into which clients are "waiting", "replied", or "sorted"

### Future upgrades (Phase 2)

**1. Placement tracking**
When a client confirms a placement, log the candidate name, role, start date, and monthly salary. The bot can then send automatic monthly payment reminders to clients.

**2. Google Forms webhook**
Set up a Google Apps Script on your form so the bot is notified when a client fills it — removing the need to manually mark them as sorted.

**3. Candidate pool**
Track available workers (name, role, experience, availability date). Staff can type `find Bs` to see all available babysitters.

**4. Contract/permit expiry alerts**
Track worker permit and contract end dates. Bot sends a reminder 30 days before expiry.

**5. Weekly analytics**
Every Monday morning: how many inquiries came in, how many converted, average response time, which staff handled the most clients.

**6. Multi-group support**
If you operate in multiple cities/regions, the bot can monitor multiple groups and tag records by region.

---

## Troubleshooting

**QR code expired?** Just wait — it refreshes automatically.

**"Group not found"?** Make sure `GROUP_NAME` in `config.js` exactly matches your WhatsApp group name (case-sensitive).

**PDF not attaching?** Make sure `Alpha-Profile.pdf` is inside the `assets/` folder.

**Bot went offline?** WhatsApp occasionally disconnects linked devices. The bot will try to reconnect automatically. If it doesn't, restart with `npm start` (no QR scan needed if the session was saved).

---

*Built for Alpha Manpower Agency · Questions? Contact Immanuel*
