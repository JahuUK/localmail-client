#!/usr/bin/env node
/**
 * Seed script for the demo user.
 * Run once: node scripts/seed-demo.js
 *
 * - Removes all existing demo emails
 * - Seeds labels into the metadata file
 * - Writes 50+ encrypted email files with accountEmail set
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DEMO_USER_ID = "77b65245-8d5d-4662-8517-2c736a543597";
const EMAILS_DIR = `data/users/${DEMO_USER_ID}/emails`;
const META_FILE = `data/users/${DEMO_USER_ID}/storage.json`;
const KEY_FILE = "data/.encryption-key";

// ---------------------------------------------------------------------------
// Crypto helpers (mirrors server/storage.ts)
// ---------------------------------------------------------------------------
function getKey() {
  return Buffer.from(fs.readFileSync(KEY_FILE, "utf8").trim(), "hex");
}

function encrypt(text) {
  const key = getKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  let enc = cipher.update(text, "utf-8", "hex");
  enc += cipher.final("hex");
  return iv.toString("hex") + ":" + enc;
}

function uuid() {
  return crypto.randomUUID();
}

// ---------------------------------------------------------------------------
// Accounts & labels
// ---------------------------------------------------------------------------
const ACCOUNTS = {
  personal: "demo.user@gmail.com",
  work:     "james@acme-corp.co.uk",
  hobby:    "maker@protonmail.com",
};

const LABEL_DEFS = [
  { name: "Work",       color: "#1a73e8" },
  { name: "Personal",   color: "#16a765" },
  { name: "Finance",    color: "#f5a623" },
  { name: "Travel",     color: "#a142f4" },
  { name: "Updates",    color: "#e37400" },
  { name: "Social",     color: "#e91e63" },
  { name: "Promotions", color: "#4caf50" },
];

// Build label map with stable IDs
const LABELS = {};
for (const l of LABEL_DEFS) {
  const id = uuid();
  LABELS[l.name] = { id, name: l.name, color: l.color };
}

function L(...names) {
  return names.map(n => LABELS[n].id);
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------
function daysAgo(n, h = 9, m = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Email definitions
// ---------------------------------------------------------------------------
const emails = [
  // ── PERSONAL (demo.user@gmail.com) ── inbox, varied ─────────────────────
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Personal"),
    date: daysAgo(0, 8, 42),
    sender: { name: "Mum", email: "mum@familymail.co.uk" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Sunday lunch this weekend?",
    snippet: "Hi love, are you free this Sunday? Dad's doing a roast.",
    body: "<p>Hi love,</p><p>Are you free this Sunday? Dad's doing a roast and your sister is coming down with the kids. Let me know by Friday so I can sort the shopping.</p><p>Love, Mum 💕</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: true,
    accountEmail: ACCOUNTS.personal, labels: L("Finance"),
    date: daysAgo(0, 10, 15),
    sender: { name: "Monzo", email: "noreply@monzo.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Your May statement is ready",
    snippet: "You spent £1,842.50 in May. Tap to see your full breakdown.",
    body: "<p><strong>Your May statement is ready</strong></p><p>You spent <strong>£1,842.50</strong> this month. Here's your top categories:</p><ul><li>Groceries — £340</li><li>Transport — £210</li><li>Eating out — £187</li><li>Subscriptions — £64</li></ul><p>View your full statement in the app.</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Social"),
    date: daysAgo(1, 19, 5),
    sender: { name: "LinkedIn", email: "notifications@linkedin.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Sarah Mitchell and 4 others viewed your profile",
    snippet: "Your profile is getting attention this week — 12 views.",
    body: "<p>Hi Demo,</p><p>Your profile received <strong>12 views</strong> this week, including from:</p><ul><li>Sarah Mitchell — Engineering Manager at Stripe</li><li>Tom Reeves — Recruiter at Google DeepMind</li><li>Priya Nair — Senior Developer at Monzo</li></ul><p>Stand out by keeping your profile up to date.</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: true,
    accountEmail: ACCOUNTS.personal, labels: L("Travel"),
    date: daysAgo(2, 14, 30),
    sender: { name: "Booking.com", email: "noreply@booking.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Your booking in Lisbon is confirmed ✈️",
    snippet: "Confirmation #BK-99402 — Hotel Bairro Alto, 14–21 June 2026.",
    body: "<p><strong>Booking Confirmed</strong></p><p>Thank you for your booking. Here are your details:</p><ul><li><strong>Hotel:</strong> Hotel Bairro Alto, Lisbon</li><li><strong>Check-in:</strong> 14 June 2026</li><li><strong>Check-out:</strong> 21 June 2026</li><li><strong>Confirmation:</strong> #BK-99402</li></ul><p>We look forward to hosting you!</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Promotions"),
    date: daysAgo(2, 9, 0),
    sender: { name: "Spotify", email: "no-reply@spotify.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "3 months of Premium for £0.99 — offer ends Sunday",
    snippet: "Limited time offer: get Spotify Premium for almost nothing.",
    body: "<p><strong>Limited time offer</strong></p><p>Get <strong>3 months of Spotify Premium</strong> for just <strong>£0.99</strong> — then £10.99/month. Cancel anytime.</p><p>Offer ends Sunday 12 May 2026 at midnight.</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Finance"),
    date: daysAgo(3, 7, 50),
    sender: { name: "HMRC", email: "noreply@hmrc.gov.uk" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Your Self Assessment tax return is due",
    snippet: "Your 2025/26 Self Assessment return must be filed by 31 January 2027.",
    body: "<p>Dear Taxpayer,</p><p>This is a reminder that your <strong>Self Assessment tax return for 2025/26</strong> must be submitted and any tax owed paid by <strong>31 January 2027</strong>.</p><p>To file online, visit your Personal Tax Account at gov.uk.</p><p>HMRC</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Social"),
    date: daysAgo(3, 18, 22),
    sender: { name: "GitHub", email: "noreply@github.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Alex Turner starred your repository localmail",
    snippet: "localmail now has 47 stars ⭐",
    body: "<p><strong>alex-turner</strong> starred your repository <strong>demo-user/localmail</strong>.</p><p>Your repository now has <strong>47 stars</strong>.</p><p>View repository → github.com/demo-user/localmail</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Updates"),
    date: daysAgo(5, 11, 0),
    sender: { name: "Netflix", email: "info@netflix.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "New this week on Netflix — don't miss these",
    snippet: "Top picks for you: Adolescence S2, Ripley S2, and more.",
    body: "<p><strong>New this week</strong></p><ul><li>Adolescence — Season 2</li><li>Ripley — Season 2</li><li>The Diplomat — Season 3</li><li>Squid Game — Season 3</li></ul><p>Start watching now.</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: [],
    date: daysAgo(6, 14, 3),
    sender: { name: "Ben Davies", email: "ben.d@outlook.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Lads trip — September?",
    snippet: "Hey mate, thinking September for a lads trip? Ibiza or Croatia?",
    body: "<p>Hey mate,</p><p>Was thinking we should organise a proper lads trip for September. Toss-up between <strong>Ibiza</strong> or <strong>Croatia (Split or Dubrovnik)</strong>. Reckon we could get 6-8 people on board.</p><p>What do you reckon? Can do a group chat once we've got a rough plan.</p><p>Ben</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Promotions"),
    date: daysAgo(7, 10, 45),
    sender: { name: "Amazon", email: "orders@amazon.co.uk" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Your order has been dispatched",
    snippet: "Order #204-8763210-9921 is on its way — arrives tomorrow.",
    body: "<p>Your order <strong>#204-8763210-9921</strong> has been dispatched and is on its way.</p><p><strong>Estimated delivery:</strong> Tomorrow by 9pm</p><p>Items: Sony WH-1000XM6 Headphones (1x)</p><p>Track your parcel in the Amazon app.</p>",
  },

  // ── PERSONAL — sent ───────────────────────────────────────────────────────
  {
    folder: "sent", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: [],
    date: daysAgo(1, 9, 30),
    sender: { name: "Demo User", email: ACCOUNTS.personal },
    to: [{ name: "Mum", email: "mum@familymail.co.uk" }],
    subject: "Re: Sunday lunch this weekend?",
    snippet: "Sounds great, Mum! I'll be there for 1pm. Can I bring anything?",
    body: "<p>Sounds great, Mum! I'll be there for 1pm. Can I bring anything?</p><p>Love you x</p>",
  },
  {
    folder: "sent", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Travel"),
    date: daysAgo(4, 16, 0),
    sender: { name: "Demo User", email: ACCOUNTS.personal },
    to: [{ name: "Emma Walsh", email: "emma.walsh@gmail.com" }, { name: "Jake Morton", email: "jake.m@gmail.com" }],
    subject: "Lisbon trip — sharing hotel details",
    snippet: "Hotel Bairro Alto, confirmed for 14–21 June. Let's plan the itinerary!",
    body: "<p>Hey both,</p><p>Sharing the hotel details — <strong>Hotel Bairro Alto</strong>, 14–21 June. Costs come out to ~£420pp including breakfast.</p><p>Let's get on a call this week to plan out the days. I'm thinking Sintra on day 2 and a day trip to Setúbal.</p><p>Demo</p>",
  },

  // ── PERSONAL — starred (older) ────────────────────────────────────────────
  {
    folder: "inbox", isUnread: false, isStarred: true,
    accountEmail: ACCOUNTS.personal, labels: L("Finance"),
    date: daysAgo(14, 9, 15),
    sender: { name: "Vanguard UK", email: "noreply@vanguard.co.uk" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Quarterly portfolio summary — Q1 2026",
    snippet: "Your ISA portfolio is up 8.3% YTD. View your full statement.",
    body: "<p><strong>Q1 2026 Portfolio Summary</strong></p><p>Your Stocks & Shares ISA is up <strong>8.3%</strong> year-to-date.</p><table><tr><td>Global All-Cap</td><td>+9.1%</td></tr><tr><td>S&P 500 ETF</td><td>+7.8%</td></tr><tr><td>UK Equity</td><td>+4.2%</td></tr></table><p>Log in to view your full statement and update your allocation.</p>",
  },

  // ── PERSONAL — archive ────────────────────────────────────────────────────
  {
    folder: "archive", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: L("Promotions"),
    date: daysAgo(30, 8, 0),
    sender: { name: "Adobe", email: "mail@adobe.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Your Creative Cloud renewal",
    snippet: "Your annual Creative Cloud plan renewed for £599.88.",
    body: "<p>Your <strong>Adobe Creative Cloud All Apps</strong> plan has been renewed.</p><p><strong>Amount charged:</strong> £599.88 (annual)</p><p>Next renewal date: April 2027</p>",
  },

  // ── WORK (james@acme-corp.co.uk) ── inbox ─────────────────────────────────
  {
    folder: "inbox", isUnread: true, isStarred: true,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(0, 8, 5),
    sender: { name: "Rachel Kim", email: "r.kim@acme-corp.co.uk" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "ACTION REQUIRED: Q2 board deck — slides due today 5pm",
    snippet: "James, the board presentation is today. Can you send your slides by 5pm?",
    body: "<p>Hi James,</p><p>Just a reminder that the <strong>Q2 board deck is due today at 5pm</strong>. Can you send over your engineering slides? I'll compile everything and have it to the board by EOD.</p><p>Key sections needed from you:</p><ul><li>Infrastructure spend vs. budget</li><li>Incident summary (April–May)</li><li>Hiring pipeline update</li><li>Q3 roadmap highlight</li></ul><p>Cheers,<br>Rachel</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(0, 9, 18),
    sender: { name: "PagerDuty", email: "alerts@pagerduty.com" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "[TRIGGERED] P1 — API Gateway latency spike (>2000ms p99)",
    snippet: "Incident #INC-4419 triggered. API gateway p99 latency is 2,340ms.",
    body: "<p><strong>🔴 P1 Incident Triggered</strong></p><p><strong>Incident:</strong> #INC-4419<br><strong>Service:</strong> API Gateway — Production<br><strong>Alert:</strong> p99 latency spike (2,340ms, threshold 500ms)<br><strong>Duration:</strong> 4 minutes and counting</p><p>Acknowledge and investigate immediately.</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(0, 10, 30),
    sender: { name: "Jira", email: "jira@acme-corp.atlassian.net" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "James, you have 7 tickets assigned to you",
    snippet: "ENG-4102, ENG-4089, ENG-3998 and 4 more are waiting for your attention.",
    body: "<p>You have <strong>7 open tickets</strong> assigned to you:</p><ul><li><strong>ENG-4102</strong> — Redis cache eviction bug (In Progress)</li><li><strong>ENG-4089</strong> — Update auth middleware to OAuth 2.0 (To Do)</li><li><strong>ENG-3998</strong> — Migrate legacy REST endpoints to GraphQL (In Review)</li><li><strong>ENG-3941</strong> — Investigate memory leak in worker service</li><li><strong>ENG-3912</strong> — Write ADR for new message queue (Blocked)</li><li><strong>ENG-3870</strong> — Fix flaky integration tests</li><li><strong>ENG-3821</strong> — Add rate limiting to public API</li></ul>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: true,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(1, 15, 0),
    sender: { name: "David Park", email: "d.park@acme-corp.co.uk" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "Offer letter approved — senior engineer hire",
    snippet: "Good news — HR have signed off on the senior engineer offer. Details inside.",
    body: "<p>Hi James,</p><p>Good news — HR and finance have approved the offer for <strong>Priya Sharma</strong> (Senior Software Engineer, Platform Team).</p><p>Offer details:<br>Base: £95,000<br>Equity: 0.1% options (4yr vest)<br>Start date: 1 July 2026</p><p>I'll have contracts sent out this afternoon.</p><p>David</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(1, 11, 45),
    sender: { name: "Confluence", email: "confluence@acme-corp.atlassian.net" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "Sophie has shared 'Platform Architecture v2' with you",
    snippet: "Sophie Chen shared a Confluence page with you: Platform Architecture v2.",
    body: "<p><strong>Sophie Chen</strong> shared the Confluence page <strong>'Platform Architecture v2'</strong> with you and left a comment:</p><blockquote><em>\"James — can you review the messaging section? Specifically the trade-offs between Kafka and SQS for our use case.\"</em></blockquote><p>View page →</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(2, 8, 0),
    sender: { name: "HR Team", email: "hr@acme-corp.co.uk" },
    to: [{ name: "All Staff", email: "all@acme-corp.co.uk" }],
    subject: "Annual leave policy update — effective 1 June",
    snippet: "We're updating our annual leave policy to 28 days for all staff from 1 June.",
    body: "<p>Dear Team,</p><p>We're pleased to confirm that from <strong>1 June 2026</strong>, all permanent staff will receive <strong>28 days annual leave</strong> (up from 25), plus bank holidays.</p><p>Please update your leave bookings in Workday accordingly.</p><p>HR Team</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(2, 16, 30),
    sender: { name: "DataDog", email: "alerts@datadoghq.com" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "[Monitor] Worker service CPU > 80% for 10+ minutes",
    snippet: "The worker service on prod-eu-west-2 has sustained >80% CPU for 12 minutes.",
    body: "<p><strong>⚠️ Monitor Alert</strong></p><p><strong>Monitor:</strong> Worker Service — High CPU<br><strong>Host:</strong> prod-eu-west-2b<br><strong>Value:</strong> 84% CPU (threshold: 80%)<br><strong>Duration:</strong> 12 minutes</p><p>Check your DataDog dashboard for details.</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(3, 12, 0),
    sender: { name: "Slack", email: "noreply@slack.com" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "You were mentioned in #engineering-platform",
    snippet: "@james-acme can you review the PR for the new caching layer? Blocks the sprint.",
    body: "<p>You were mentioned in <strong>#engineering-platform</strong></p><p><strong>Sophie Chen:</strong> @james-acme can you review PR #418 for the new Redis caching layer? It's blocking the rest of the sprint.</p><p>View message in Slack →</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(4, 9, 0),
    sender: { name: "Rachel Kim", email: "r.kim@acme-corp.co.uk" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "1:1 notes — 6 May",
    snippet: "Notes from our 1:1 today. Action items for you listed inside.",
    body: "<p>Hi James,</p><p>Notes from today's 1:1:</p><p><strong>Discussion points:</strong></p><ul><li>Engineering headcount — approved 2 more hires for H2</li><li>Incident review process — agreed to add blameless post-mortem template</li><li>Platform roadmap — need ADRs done before end of May</li></ul><p><strong>Your action items:</strong></p><ul><li>Finalise Q2 board slides by Friday</li><li>Review and close ADR backlog (5 outstanding)</li><li>Set up interview loop for senior engineer candidates</li></ul><p>Rachel</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: true,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(5, 11, 0),
    sender: { name: "AWS Billing", email: "billing@aws.amazon.com" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "Your AWS invoice for April 2026 — $12,440.82",
    snippet: "Your AWS bill for April is ready. EC2 and RDS were the top spend categories.",
    body: "<p><strong>AWS Invoice — April 2026</strong></p><p>Total: <strong>$12,440.82</strong></p><table><tr><td>EC2</td><td>$5,210.00</td></tr><tr><td>RDS</td><td>$3,180.00</td></tr><tr><td>CloudFront</td><td>$1,420.00</td></tr><tr><td>S3</td><td>$890.00</td></tr><tr><td>Other</td><td>$1,740.82</td></tr></table><p>Download invoice as PDF.</p>",
  },

  // ── WORK — sent ───────────────────────────────────────────────────────────
  {
    folder: "sent", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(0, 11, 30),
    sender: { name: "James", email: ACCOUNTS.work },
    to: [{ name: "Rachel Kim", email: "r.kim@acme-corp.co.uk" }],
    subject: "Re: ACTION REQUIRED: Q2 board deck — slides due today 5pm",
    snippet: "Hi Rachel — will have the slides over to you by 4pm. Almost done.",
    body: "<p>Hi Rachel,</p><p>Will have them over to you by 4pm — just finishing the hiring pipeline section. Almost done.</p><p>James</p>",
  },
  {
    folder: "sent", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(1, 16, 45),
    sender: { name: "James", email: ACCOUNTS.work },
    to: [{ name: "Engineering Team", email: "engineering@acme-corp.co.uk" }],
    subject: "Post-mortem: API gateway incident #INC-4392 — 2 May",
    snippet: "Summary and action items from last week's incident. Please review.",
    body: "<p>Team,</p><p><strong>Summary:</strong> On 2 May 2026 at 14:12 UTC, the API gateway experienced a latency spike (p99 > 3,000ms) for 22 minutes. Root cause was a misconfigured connection pool limit deployed in the 14:00 release.</p><p><strong>Impact:</strong> ~8% of requests returned 504s. No data loss.</p><p><strong>Action items:</strong></p><ol><li>Add connection pool config validation to CI pipeline (Owner: Sophie)</li><li>Implement canary deployments for gateway changes (Owner: James)</li><li>Update runbook with connection pool diagnostics (Owner: Yaw)</li></ol><p>James</p>",
  },

  // ── WORK — archive ────────────────────────────────────────────────────────
  {
    folder: "archive", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: L("Work"),
    date: daysAgo(21, 10, 0),
    sender: { name: "Rachel Kim", email: "r.kim@acme-corp.co.uk" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "Performance review — James Wilson",
    snippet: "Hi James, your Q1 performance review is attached. Overall rating: Exceeds Expectations.",
    body: "<p>Hi James,</p><p>Please find your Q1 2026 performance review attached. Your overall rating is <strong>Exceeds Expectations</strong>.</p><p>Key highlights:</p><ul><li>Led successful platform migration ahead of schedule</li><li>Reduced incident MTTR by 40%</li><li>Grew team from 4 to 8 engineers</li></ul><p>We'll discuss the salary review outcome in our next 1:1.</p><p>Rachel</p>",
  },

  // ── HOBBY (maker@protonmail.com) ── inbox ─────────────────────────────────
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: L("Updates"),
    date: daysAgo(0, 7, 30),
    sender: { name: "Raspberry Pi Forums", email: "noreply@raspberrypi.org" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "New reply on your thread: Pi 5 NAS build — thermal throttling",
    snippet: "RPi_Tom replied: Try undervolting slightly — helped me get temps down to 42°C.",
    body: "<p><strong>RPi_Tom</strong> replied to your thread <em>Pi 5 NAS build — thermal throttling under load</em>:</p><blockquote>\"Try undervolting slightly and make sure the active cooler is seated properly. Got mine down to 42°C under full Plex transcode load. Also worth checking your case airflow — the official case can get warm.\"</blockquote><p>View full thread →</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: true,
    accountEmail: ACCOUNTS.hobby, labels: L("Updates"),
    date: daysAgo(0, 11, 22),
    sender: { name: "Hackster.io", email: "newsletter@hackster.io" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Your project 'LocalMail' is featured this week 🎉",
    snippet: "Congratulations — your project was picked for Hackster's Weekly Digest!",
    body: "<p>🎉 <strong>Congratulations!</strong></p><p>Your project <strong>'LocalMail — Self-hosted Gmail Clone'</strong> has been selected as a <strong>featured project</strong> in this week's Hackster Weekly Digest, sent to 280,000+ makers.</p><p>Your project page has already received 1,200 views since this morning.</p><p>Keep building great things!</p><p>The Hackster Team</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(1, 14, 10),
    sender: { name: "Pimoroni", email: "orders@pimoroni.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Your order has shipped — PIM-9982",
    snippet: "Your Pimoroni order is on its way! Dispatched via Royal Mail 24.",
    body: "<p>Great news — your order <strong>PIM-9982</strong> has been dispatched.</p><p><strong>Items:</strong></p><ul><li>Raspberry Pi 5 Active Cooler (x1)</li><li>NVMe Base for Raspberry Pi 5 (x1)</li><li>Pico W (x3)</li><li>Female header 2.54mm 40-pin (x5)</li></ul><p><strong>Carrier:</strong> Royal Mail 24<br><strong>Expected:</strong> 1–2 business days</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: L("Updates"),
    date: daysAgo(1, 18, 0),
    sender: { name: "Docker Hub", email: "noreply@hub.docker.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "jahuuk/localmail-app just hit 500 pulls",
    snippet: "Your Docker Hub image jahuuk/localmail-app has reached 500 pulls!",
    body: "<p>Milestone reached!</p><p>Your Docker Hub image <strong>jahuuk/localmail-app</strong> has just been pulled <strong>500 times</strong>.</p><p>Keep sharing and the community will keep using it!</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(2, 10, 30),
    sender: { name: "GitHub", email: "noreply@github.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Issue opened: SMTP authentication failing with Gmail App Passwords",
    snippet: "user98712 opened issue #42 on your localmail repo.",
    body: "<p><strong>user98712</strong> opened issue <strong>#42</strong> on <strong>demo-user/localmail</strong>:</p><p><em>SMTP authentication failing with Gmail App Passwords</em></p><blockquote>\"Getting 535 authentication failed when I use my Gmail App Password. IMAP fetch works fine. Docker setup following the README exactly.\"</blockquote><p>View issue →</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: true,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(3, 9, 0),
    sender: { name: "Hackaday", email: "newsletter@hackaday.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Hackaday Prize 2026 — entries now open",
    snippet: "The Hackaday Prize is back! $200,000 in prizes. Submit your project by July 31.",
    body: "<p><strong>Hackaday Prize 2026 is open!</strong></p><p>The world's greatest hardware design competition is back. <strong>$200,000 in prizes</strong> across 5 categories:</p><ul><li>Wildcard</li><li>Sustainable Development</li><li>Assistive Technology</li><li>Connectivity</li><li>Best Product</li></ul><p>Submissions open until <strong>31 July 2026</strong>. Enter now →</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: L("Updates"),
    date: daysAgo(4, 16, 30),
    sender: { name: "GitHub Sponsors", email: "noreply@github.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "You have a new sponsor — $5/month",
    snippet: "Someone is now sponsoring your work on GitHub. Thank you! 🙏",
    body: "<p>🎉 <strong>You have a new GitHub Sponsor!</strong></p><p>An anonymous sponsor has started supporting your open-source work at <strong>$5/month</strong>.</p><p>Your total monthly sponsorship is now <strong>$23/month</strong>.</p><p>Thank you for everything you contribute to the open-source community.</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(5, 13, 0),
    sender: { name: "Tom Kowalski", email: "tkowalski@fastmail.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Re: LocalMail — could this run on an old Thinkpad?",
    snippet: "Tom: Tried it on my X220 running Debian 12. Works perfectly — sub 1s load times!",
    body: "<p>Hey,</p><p>Just wanted to report back — got LocalMail running on my old <strong>Thinkpad X220</strong> (i5-2520M, 8GB RAM) on <strong>Debian 12</strong> via Docker Compose.</p><p>Works perfectly! Load times are under 1 second even with ~2,000 emails. Genuinely impressed.</p><p>One request — any chance of adding a keyboard shortcut reference? Coming from Mutt I miss having shortcuts for everything.</p><p>Thanks for building this,<br>Tom</p>",
  },
  {
    folder: "inbox", isUnread: true, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: L("Updates"),
    date: daysAgo(6, 8, 0),
    sender: { name: "npm", email: "npm@npmjs.com" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Security advisory: high severity vulnerability in express",
    snippet: "A high severity vulnerability was found in express@4.18.2. Update recommended.",
    body: "<p><strong>⚠️ Security Advisory</strong></p><p>A <strong>high severity</strong> vulnerability has been disclosed in <strong>express@4.18.2</strong> (CVE-2026-XXXXX).</p><p>Packages affected in your projects: <strong>localmail</strong></p><p><strong>Recommended action:</strong> Update to express@4.21.0 or later.</p><p>Run <code>npm audit fix</code> to apply the fix automatically.</p>",
  },
  {
    folder: "inbox", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(7, 11, 0),
    sender: { name: "Mouser Electronics", email: "noreply@mouser.co.uk" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Order MSR-2841-UK confirmed",
    snippet: "Your Mouser order is confirmed. Estimated dispatch: 2 business days.",
    body: "<p>Thank you for your order <strong>MSR-2841-UK</strong>.</p><p><strong>Items:</strong></p><ul><li>RP2040 microcontroller (x10)</li><li>WS2812B LED strip 1m 60 LED/m (x2)</li><li>3.3V LDO regulator SOT-223 (x20)</li><li>0.1µF ceramic capacitor 0402 (x100)</li></ul><p><strong>Total:</strong> £47.82 inc. VAT<br><strong>Estimated dispatch:</strong> 2 business days</p>",
  },

  // ── HOBBY — sent ──────────────────────────────────────────────────────────
  {
    folder: "sent", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(2, 11, 30),
    sender: { name: "maker", email: ACCOUNTS.hobby },
    to: [{ name: "user98712", email: "user98712@protonmail.com" }],
    subject: "Re: SMTP authentication failing with Gmail App Passwords",
    snippet: "Hi! Gmail requires 2FA to be on before App Passwords are available. Steps inside.",
    body: "<p>Hi,</p><p>Thanks for the report! This is a Gmail-side requirement. To use App Passwords with Gmail SMTP:</p><ol><li>Make sure <strong>2-Step Verification is enabled</strong> on your Google Account (this is required before App Passwords appear)</li><li>Go to: Google Account → Security → App Passwords</li><li>Generate a new password for 'Mail' and use that in LocalMail's SMTP settings</li><li>The SMTP password field should be the 16-character code (no spaces)</li></ol><p>Hope that helps — let me know if you're still stuck!</p>",
  },
  {
    folder: "sent", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(5, 14, 0),
    sender: { name: "maker", email: ACCOUNTS.hobby },
    to: [{ name: "Tom Kowalski", email: "tkowalski@fastmail.com" }],
    subject: "Re: LocalMail — could this run on an old Thinkpad?",
    snippet: "Great to hear! Keyboard shortcuts are on the roadmap for v0.9.",
    body: "<p>That's awesome to hear — the X220 is a proper workhorse!</p><p>Keyboard shortcuts are definitely on the roadmap for v0.9. Gmail-style bindings (j/k to navigate, e to archive, etc.) are what I'm aiming for. No ETA yet but it's near the top of the list.</p><p>Cheers for the feedback!</p>",
  },

  // ── HOBBY — archive ───────────────────────────────────────────────────────
  {
    folder: "archive", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.hobby, labels: [],
    date: daysAgo(20, 9, 0),
    sender: { name: "Let's Encrypt", email: "expiry@letsencrypt.org" },
    to: [{ name: "maker", email: ACCOUNTS.hobby }],
    subject: "Your certificate for localmail.example.com expires in 20 days",
    snippet: "Certificate expiry reminder for localmail.example.com — renew soon.",
    body: "<p>Your certificate (or certificates) for the names listed below will expire in <strong>20 days</strong>. Please make sure you renew your certificate before then, or visitors to your website will encounter errors.</p><p>Domains: <strong>localmail.example.com</strong></p><p>For most <strong>Certbot</strong> users, a cron job or systemd timer handles automatic renewal. If you're having trouble, check the community forums.</p>",
  },

  // ── SPAM (across accounts) ────────────────────────────────────────────────
  {
    folder: "spam", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: [],
    date: daysAgo(1, 3, 14),
    sender: { name: "PayPal Support", email: "support@paypal-secure-account.com" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "URGENT: Your account has been limited",
    snippet: "Your PayPal account has been limited. Verify now to avoid suspension.",
    body: "<p>Dear Customer,</p><p>Your PayPal account has been <strong>limited</strong> due to suspicious activity. Please verify your identity within 24 hours to avoid permanent suspension.</p><p>Click here to verify →</p>",
  },
  {
    folder: "spam", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: [],
    date: daysAgo(2, 6, 0),
    sender: { name: "Nigerian Prince Office", email: "prince@royaltr.biz" },
    to: [{ name: "James", email: ACCOUNTS.work }],
    subject: "Confidential Business Proposal — $14.5M",
    snippet: "I am reaching out about a confidential transfer of funds totalling $14.5 million.",
    body: "<p>Dear Sir/Madam,</p><p>I am Dr Emmanuel Okafor, legal representative of the late Mr David Okafor. I am reaching out regarding a confidential transfer of funds totalling <strong>USD $14.5 million</strong>. Your cooperation is required...</p>",
  },

  // ── TRASH ─────────────────────────────────────────────────────────────────
  {
    folder: "trash", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.personal, labels: [],
    trashedAt: daysAgo(3, 8, 0),
    date: daysAgo(10, 9, 0),
    sender: { name: "Groupon", email: "deals@groupon.co.uk" },
    to: [{ name: "Demo User", email: ACCOUNTS.personal }],
    subject: "Up to 80% off spa days near you",
    snippet: "Treat yourself — massive discounts on spa days, dining, and activities.",
    body: "<p>Treat yourself to an amazing spa day! <strong>Up to 80% off</strong> top-rated spas near you.</p>",
  },

  // ── DRAFTS ────────────────────────────────────────────────────────────────
  {
    folder: "drafts", isUnread: false, isStarred: false,
    accountEmail: ACCOUNTS.work, labels: [],
    date: daysAgo(0, 16, 0),
    sender: { name: "James", email: ACCOUNTS.work },
    to: [{ name: "Rachel Kim", email: "r.kim@acme-corp.co.uk" }],
    subject: "Q2 board deck — engineering slides",
    snippet: "[Draft] Engineering update for Q2 board meeting...",
    body: "<p>Hi Rachel,</p><p>Please find the engineering slides for the Q2 board deck attached:</p><p>[Draft — content in progress]</p>",
  },
];

// ---------------------------------------------------------------------------
// Write helpers
// ---------------------------------------------------------------------------
function writeEmail(email) {
  const id = uuid();
  const fullEmail = {
    id,
    sender: email.sender,
    to: email.to,
    cc: email.cc || [],
    bcc: email.bcc || [],
    subject: email.subject,
    snippet: email.snippet,
    body: email.body,
    bodyHtml: email.body,
    date: email.date,
    isUnread: email.isUnread,
    isStarred: email.isStarred,
    folder: email.folder,
    labels: email.labels || [],
    hasAttachments: false,
    attachments: [],
    accountEmail: email.accountEmail,
    trashedAt: email.trashedAt || undefined,
    messageId: `<${id}@localmail.app>`,
  };
  const filePath = path.join(EMAILS_DIR, `${id}.json`);
  const json = JSON.stringify(fullEmail, null, 2);
  fs.writeFileSync(filePath, encrypt(json), "utf-8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
// 1. Delete existing emails
const existingFiles = fs.readdirSync(EMAILS_DIR).filter(f => f.endsWith(".json"));
for (const f of existingFiles) {
  fs.unlinkSync(path.join(EMAILS_DIR, f));
}
console.log(`Deleted ${existingFiles.length} existing email files.`);

// 2. Write labels into metadata
const meta = JSON.parse(fs.readFileSync(META_FILE, "utf-8"));
meta.labels = {};
for (const l of Object.values(LABELS)) {
  meta.labels[l.id] = l;
}
fs.writeFileSync(META_FILE, JSON.stringify(meta, null, 2), "utf-8");
console.log(`Wrote ${Object.keys(meta.labels).length} labels to metadata.`);

// 3. Write email files
for (const email of emails) {
  writeEmail(email);
}
console.log(`Wrote ${emails.length} encrypted email files.`);
console.log("Done — restart the server to pick up changes.");
