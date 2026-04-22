import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { globalStorage, verifyPassword, rehashIfNeeded, type UserStorage } from "./storage";
import { insertMailAccountSchema, composeEmailSchema, insertLabelSchema, generalSettingsSchema, insertCustomFolderSchema, insertEmailRuleSchema, backupConfigSchema, type Email } from "@shared/schema";
import { fetchEmails, sendSmtpEmail, testIncomingConnection, testSmtpConnection, saveAttachmentsToDisk, getAttachmentPath } from "./mail";
import { testConnection, runBackup, listBackups, downloadBackup, restoreBackup, startScheduledBackup, stopScheduledBackup, createBackupArchive, getNextBackupTime } from "./backup";
import { resolve } from "path";
import multer from "multer";
import { existsSync, mkdirSync, unlinkSync } from "fs";
import rateLimit from "express-rate-limit";

// IP-based limiter for unauthenticated login endpoints — 10 attempts per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
});

// User-ID-based limiter for expensive authenticated backup operations — 5 per hour
const backupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req.session as any)?.userId ?? "unknown",
  message: { message: "Too many backup requests. Please wait before trying again." },
});

declare module "express-serve-static-core" {
  interface Request {
    userStorage?: UserStorage;
  }
}

const vacationRepliedTo = new Map<string, Set<string>>();

async function maybeSendVacationReply(
  userId: string,
  storage: UserStorage,
  incomingEmail: Email,
  account: { email: string; smtpHost?: string; smtpPort?: number; smtpTls?: boolean; username: string; password: string; name: string }
): Promise<void> {
  try {
    const settings = await storage.getSettings();
    if (!settings.vacationReplyEnabled) return;

    const now = new Date();
    if (settings.vacationStartDate) {
      if (now < new Date(settings.vacationStartDate)) return;
    }
    if (settings.vacationEndDate) {
      const end = new Date(settings.vacationEndDate);
      end.setHours(23, 59, 59, 999);
      if (now > end) return;
    }

    const senderEmail = (incomingEmail.sender.email || "").toLowerCase();
    if (!senderEmail) return;
    if (senderEmail === account.email.toLowerCase()) return;
    if (/no.?reply|do.not.reply|mailer.daemon|postmaster/i.test(senderEmail)) return;
    if (incomingEmail.listUnsubscribeUrl || incomingEmail.listUnsubscribeMail) return;

    if (!account.smtpHost || !account.smtpPort) return;

    const key = `${userId}:${senderEmail}`;
    if (!vacationRepliedTo.has(userId)) vacationRepliedTo.set(userId, new Set());
    const sent = vacationRepliedTo.get(userId)!;
    if (sent.has(senderEmail)) return;
    sent.add(senderEmail);

    const subject = settings.vacationSubject || "Out of Office";
    const body = settings.vacationBody || "I am currently out of office and will respond when I return.";
    const replySubject = incomingEmail.subject.startsWith("Re:")
      ? incomingEmail.subject
      : `Re: ${incomingEmail.subject}`;

    await sendSmtpEmail(
      account as any,
      senderEmail,
      replySubject,
      body,
      undefined,
      undefined,
      { inReplyTo: incomingEmail.messageId, references: incomingEmail.messageId }
    );
    addLog(userId, "info", "Vacation reply", `Auto-replied to ${senderEmail} re: "${incomingEmail.subject}"`);
  } catch {
    // best-effort
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return;
  }
  globalStorage.getUser(req.session.userId).then(user => {
    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ message: "User no longer exists" });
      return;
    }
    const storage = globalStorage.getUserStorage(req.session.userId!);
    (req as any).userStorage = storage;
    next();
  });
}

function getUserStorage(req: Request): UserStorage {
  return (req as any).userStorage as UserStorage;
}

const autoFetchTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

function getClientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return (Array.isArray(fwd) ? fwd[0] : fwd).split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

// ─── Tracking pixel detection ─────────────────────────────────────────────────

function isTrackingPixelAttrs(attrs: string): boolean {
  // 1×1 or 0×0 via HTML attributes
  const w1 = /width\s*=\s*["']?\s*1\s*["']?/i.test(attrs);
  const h1 = /height\s*=\s*["']?\s*1\s*["']?/i.test(attrs);
  const w0 = /width\s*=\s*["']?\s*0\s*["']?/i.test(attrs);
  const h0 = /height\s*=\s*["']?\s*0\s*["']?/i.test(attrs);
  if ((w1 && h1) || (w0 && h0)) return true;
  // 1px/0px via inline style
  if (/width\s*:\s*[01]px/i.test(attrs) && /height\s*:\s*[01]px/i.test(attrs)) return true;
  // Hidden via CSS
  if (/display\s*:\s*none/i.test(attrs) || /visibility\s*:\s*hidden/i.test(attrs)) return true;
  // Known tracking domains / path signatures in the src
  const srcMatch = attrs.match(/src\s*=\s*["']([^"']+)["']/i);
  if (srcMatch) {
    const src = srcMatch[1].toLowerCase();
    const patterns = [
      "/track/", "/pixel/", "/open/", "/beacon/", "/trk/", "/wf/open",
      "t.gif", "t.png", "pixel.gif", "pixel.png", "open.gif",
      "mailchimp.com/track", "list-manage.com", "sendgrid.net/wf/",
      "mandrillapp.com", "hubspot.com/track", "hsforms.com", "hscta.net",
      "exacttarget.com", "salesforce.com/track", "marketo.com/trk",
      "mktoresp.com", "mktoinsights.com", "eloqua.com/e/f", "pardot.com/l/",
      "mailgun.com/o/", "postmark.com/track", "click.pstmrk",
      "campaignmonitor.com/t/", "createsend.com", "cmail",
      "klaviyo.com/open", "kmail-", "mailerlite.com/track",
      "convertkit.com/open", "aweber.com/open", "getresponse.com/trk",
      "constantcontact.com/track", "ctct.net", "activecampaign.com/lt",
      "drip.com/p/", "track.customer.io", "go.sparkpostmail",
      "rs6.net/tn", "r20.rs6.net", "app.link/track",
    ];
    if (patterns.some(p => src.includes(p))) return true;
  }
  return false;
}

function detectAndBlockTrackingPixels(html: string): { html: string; count: number } {
  if (!html) return { html, count: 0 };
  let count = 0;
  const processed = html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    if (isTrackingPixelAttrs(attrs)) { count++; return ""; }
    return match;
  });
  return { html: processed, count };
}

type LogEntry = { timestamp: string; level: "info" | "warn" | "error" | "success"; source: string; message: string };
const userLogs: Map<string, LogEntry[]> = new Map();
const MAX_LOGS = 2000;

export function addLog(userId: string, level: LogEntry["level"], source: string, message: string) {
  if (!userLogs.has(userId)) userLogs.set(userId, []);
  const logs = userLogs.get(userId)!;
  logs.push({ timestamp: new Date().toISOString(), level, source, message });
  if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);
}

export { userLogs };

function startAutoFetch(userId: string, accountId: string, intervalMinutes: number) {
  const key = `${userId}:${accountId}`;
  stopAutoFetch(userId, accountId);

  const ms = intervalMinutes * 60 * 1000;
  addLog(userId, "info", "Auto-fetch", `Timer started for account ${accountId} (every ${intervalMinutes} min)`);
  const timer = setInterval(async () => {
    try {
      const storage = globalStorage.getUserStorage(userId);
      const account = await storage.getAccount(accountId);
      if (!account || account.autoFetchEnabled === false) {
        addLog(userId, "warn", "Auto-fetch", `Account ${accountId} disabled or removed — stopping timer`);
        stopAutoFetch(userId, accountId);
        return;
      }

      const proto = (account.protocol || "pop3").toUpperCase();
      addLog(userId, "info", "Auto-fetch", `Fetching emails for ${account.email} via ${proto}...`);
      const startTime = Date.now();
      const results = await fetchEmails(account);
      const fetchElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      addLog(userId, "info", "Auto-fetch", `${proto} server returned ${results.length} message(s) for ${account.email} in ${fetchElapsed}s`);
      let imported = 0;
      let duplicates = 0;
      for (const result of results) {
        if (result.email.messageId && storage.hasMessageId(result.email.messageId)) {
          duplicates++;
          continue;
        }
        result.email.accountEmail = account.email;
        // If the sender address matches the fetching account, treat as a sent email
        // (some servers return outgoing mail in the same mailbox as incoming)
        if (result.email.sender.email.toLowerCase() === account.email.toLowerCase()) {
          result.email.folder = "sent";
          result.email.isUnread = false;
        }
        let accountLabel = await storage.getLabelByName(account.email);
        if (!accountLabel) {
          accountLabel = await storage.createLabel({ name: account.email, color: "#1a73e8" });
        }
        const labels = [...(result.email.labels || [])];
        if (!labels.includes(accountLabel.id)) labels.push(accountLabel.id);
        result.email.labels = labels;

        result.email = storage.applyRulesToEmail(result.email);

        const created = await storage.createEmail(result.email);
        if (result.rawAttachments.length > 0) {
          saveAttachmentsToDisk(created.id, result.rawAttachments, storage.getAttachmentsDir());
          addLog(userId, "info", "Auto-fetch", `Saved ${result.rawAttachments.length} attachment(s) for "${created.subject}"`);
        }
        if (created.folder === "inbox") {
          maybeSendVacationReply(userId, storage, created, account).catch(() => {});
        }
        imported++;
      }
      await storage.updateAccount(accountId, { lastFetched: new Date().toISOString() });
      const skipMsg = duplicates > 0 ? ` (${duplicates} duplicates skipped)` : "";
      if (imported > 0) {
        addLog(userId, "success", "Auto-fetch", `${imported} new emails imported for ${account.email}${skipMsg}`);
        console.log(`Auto-fetch: ${imported} new emails for ${account.email}${skipMsg}`);
      } else {
        addLog(userId, "info", "Auto-fetch", `No new emails for ${account.email}${skipMsg}`);
      }
    } catch (err: any) {
      addLog(userId, "error", "Auto-fetch", `Error fetching ${key}: ${err.message}`);
      console.error(`Auto-fetch error for ${key}: ${err.message}`);
    }
  }, ms);

  autoFetchTimers.set(key, timer);
}

function stopAutoFetch(userId: string, accountId: string) {
  const key = `${userId}:${accountId}`;
  const timer = autoFetchTimers.get(key);
  if (timer) {
    clearInterval(timer);
    autoFetchTimers.delete(key);
  }
}

async function initScheduledBackups() {
  const users = await globalStorage.getAllUsers();
  for (const user of users) {
    try {
      const storage = globalStorage.getUserStorage(user.id);
      const config = storage.getDecryptedBackupConfig();
      if (config && config.enabled && config.schedule !== "manual") {
        startScheduledBackup(
          user.id,
          config,
          (level, message) => { addLog(user.id, level as any, "Backup", message); },
          async (success, message) => {
            try {
              const existing = storage.getBackupConfig();
              if (existing) {
                existing.lastBackup = new Date().toISOString();
                existing.lastBackupStatus = success ? "success" : "failed";
                existing.lastBackupMessage = message;
                await storage.updateBackupConfig(existing);
              }
            } catch {}
          }
        );
      }
    } catch {}
  }
}

async function initAutoFetchForAllUsers() {
  const users = await globalStorage.getAllUsers();
  for (const user of users) {
    try {
      const storage = globalStorage.getUserStorage(user.id);
      const accounts = await storage.getAccounts();
      for (const account of accounts) {
        if (account.autoFetchEnabled !== false) {
          const interval = account.autoFetchInterval || 30;
          startAutoFetch(user.id, account.id, interval);
        }
      }
    } catch {}
  }
}

function startTrashPurgeTimer() {
  setInterval(async () => {
    const users = await globalStorage.getAllUsers();
    for (const user of users) {
      try {
        const storage = globalStorage.getUserStorage(user.id);
        const purged = await storage.purgeExpiredTrash();
        if (purged > 0) {
          addLog(user.id, "info", "Trash purge", `Removed ${purged} expired emails from Trash`);
        }
        const spamPurged = await storage.purgeExpiredSpam();
        if (spamPurged > 0) {
          addLog(user.id, "info", "Spam purge", `Removed ${spamPurged} expired emails from Spam`);
          console.log(`Spam purge: Removed ${spamPurged} emails for user ${user.username}`);
        }
      } catch (err: any) {
        addLog(user.id, "error", "Trash purge", `Error: ${err.message}`);
      }
    }
  }, 60 * 60 * 1000);
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/api/auth/me", (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    globalStorage.getUser(req.session.userId).then(user => {
      if (!user) return res.status(401).json({ message: "User not found" });
      res.json({ id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin || false });
    });
  });

  app.get("/api/auth/setup-needed", (_req, res) => {
    res.json({ setupNeeded: !globalStorage.hasUsers() });
  });

  app.post("/api/auth/setup", async (req, res) => {
    if (globalStorage.hasUsers()) {
      return res.status(400).json({ message: "Setup already completed. Please log in." });
    }
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    if (username.length < 3) {
      return res.status(400).json({ message: "Username must be at least 3 characters" });
    }
    if (password.length < 4) {
      return res.status(400).json({ message: "Password must be at least 4 characters" });
    }
    const user = await globalStorage.createUser({ username, password, displayName: displayName || username });
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });

  app.post("/api/auth/register-public", async (req, res) => {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    if (username.length < 3) {
      return res.status(400).json({ message: "Username must be at least 3 characters" });
    }
    if (password.length < 4) {
      return res.status(400).json({ message: "Password must be at least 4 characters" });
    }
    const existing = await globalStorage.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ message: "Username already taken" });
    }
    const user = await globalStorage.createUser({ username, password, displayName: displayName || username });
    req.session.userId = user.id;
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });

  app.post("/api/auth/register", requireAuth, async (req, res) => {
    const { username, password, displayName } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    if (username.length < 3) {
      return res.status(400).json({ message: "Username must be at least 3 characters" });
    }
    if (password.length < 4) {
      return res.status(400).json({ message: "Password must be at least 4 characters" });
    }
    const existing = await globalStorage.getUserByUsername(username);
    if (existing) {
      return res.status(400).json({ message: "Username already taken" });
    }
    const user = await globalStorage.createUser({ username, password, displayName: displayName || username });
    addLog(req.session.userId!, "info", "Admin", `Created new user account "${username}"`);
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const user = await globalStorage.getUserByUsername(username);
    const ip = getClientIp(req);
    if (!user || !verifyPassword(password, user.password)) {
      if (user) addLog(user.id, "warn", "Auth", `Failed login attempt for "${username}" from ${ip} (wrong password)`);
      else console.warn(`[Auth] Failed login attempt for unknown username "${username}" from ${ip}`);
      return res.status(401).json({ message: "Invalid username or password" });
    }
    const newHash = rehashIfNeeded(password, user.password);
    if (newHash) {
      await globalStorage.updateUserPassword(user.id, newHash);
    }
    req.session.userId = user.id;
    addLog(user.id, "success", "Auth", `User "${user.username}" logged in successfully from ${ip}`);
    res.json({ id: user.id, username: user.username, displayName: user.displayName });
  });

  app.post("/api/auth/logout", (req, res) => {
    if (req.session.userId) {
      addLog(req.session.userId, "info", "Auth", "User logged out");
    }
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.post("/api/auth/admin-login", loginLimiter, async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const user = await globalStorage.getUserByUsername(username);
    const ip = getClientIp(req);
    if (!user || !verifyPassword(password, user.password)) {
      if (user) addLog(user.id, "warn", "Auth", `Failed admin login attempt for "${username}" from ${ip} (wrong password)`);
      return res.status(401).json({ message: "Invalid username or password" });
    }
    if (!user.isAdmin) {
      addLog(user.id, "warn", "Auth", `Non-admin user "${username}" attempted admin login from ${ip}`);
      return res.status(403).json({ message: "This account does not have admin privileges" });
    }
    const newHash = rehashIfNeeded(password, user.password);
    if (newHash) {
      await globalStorage.updateUserPassword(user.id, newHash);
    }
    req.session.userId = user.id;
    addLog(user.id, "success", "Auth", `Admin "${user.username}" logged in successfully from ${ip}`);
    res.json({ id: user.id, username: user.username, displayName: user.displayName, isAdmin: true });
  });

  function requireAdmin(req: Request, res: Response, next: NextFunction): void {
    if (!req.session?.userId) {
      res.status(401).json({ message: "Not authenticated" });
      return;
    }
    globalStorage.getUser(req.session.userId).then(user => {
      if (!user || !user.isAdmin) {
        res.status(403).json({ message: "Admin access required" });
        return;
      }
      next();
    });
  }

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const users = await globalStorage.getAllUsers();
    const safe = users.map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      isAdmin: u.isAdmin || false,
    }));
    res.json(safe);
  });

  app.post("/api/admin/users/:id/reset-password", requireAdmin, async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 4) {
      return res.status(400).json({ message: "Password must be at least 4 characters" });
    }
    const target = await globalStorage.getUser(req.params.id);
    const success = await globalStorage.resetUserPassword(req.params.id, password);
    if (!success) return res.status(404).json({ message: "User not found" });
    addLog(req.session.userId!, "warn", "Admin", `Password reset for user "${target?.username || req.params.id}"`);
    res.json({ message: "Password reset successfully" });
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    if (req.params.id === req.session.userId) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const target = await globalStorage.getUser(req.params.id);
    const success = await globalStorage.deleteUser(req.params.id);
    if (!success) return res.status(404).json({ message: "User not found" });
    addLog(req.session.userId!, "warn", "Admin", `User account "${target?.username || req.params.id}" deleted`);
    res.json({ message: "User deleted" });
  });

  app.get("/api/emails/unread-counts", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    res.json(storage.getUnreadCounts());
  });

  app.get("/api/emails", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const folder = req.query.folder as string | undefined;
    const search = req.query.search as string | undefined;
    const label = req.query.label as string | undefined;
    const account = req.query.account as string | undefined;
    const hasAttachment = req.query.hasAttachment === "1";
    const unreadOnly = req.query.unread === "1";
    const starredOnly = req.query.starred === "1";
    const dateRange = req.query.dateRange as string | undefined;
    const searchBody = req.query.searchBody === "1";
    const scopeAll = req.query.scope === "all";

    const hasFilters = search || hasAttachment || unreadOnly || starredOnly || dateRange || searchBody;

    if (hasFilters) {
      // When scope is "all", search across all folders but exclude trash unless user is in trash
      const excludeTrash = scopeAll ? (folder !== "trash") : false;
      const emails = await storage.searchEmails({
        query: search || "",
        folder: scopeAll ? undefined : folder,
        label: scopeAll ? undefined : label,
        account: scopeAll ? undefined : account,
        excludeTrash,
        hasAttachment,
        unreadOnly,
        starredOnly,
        dateRange,
        searchBody,
      });
      return res.json(emails);
    }

    if (label) {
      const emails = await storage.getEmailsByLabel(label);
      return res.json(emails);
    }

    if (account) {
      const emails = await storage.getEmailsByAccount(account);
      return res.json(emails);
    }

    const emails = await storage.getEmails(folder);
    res.json(emails);
  });

  app.get("/api/emails/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });
    const settings = await storage.getSettings();
    if (settings.blockTrackingPixels !== false && email.bodyHtml) {
      const { html, count } = detectAndBlockTrackingPixels(email.bodyHtml);
      if (count > 0) {
        addLog(userId, "info", "Privacy", `Blocked ${count} tracking pixel${count !== 1 ? "s" : ""} from ${email.sender.email} — "${email.subject}"`);
        return res.json({ ...email, bodyHtml: html, trackingPixelsBlocked: count });
      }
    }
    res.json(email);
  });

  app.get("/api/emails/:id/attachments/:attachmentId", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });

    const attachment = email.attachments?.find(a => a.id === req.params.attachmentId);
    if (!attachment) return res.status(404).json({ message: "Attachment not found" });

    const filePath = getAttachmentPath(req.params.id, req.params.attachmentId, attachment.filename, storage.getAttachmentsDir());
    if (!filePath) return res.status(404).json({ message: "Attachment file not found on disk" });

    addLog(userId, "info", "Attachments", `Downloaded "${attachment.filename}" (${(attachment.size / 1024).toFixed(1)} KB) from "${email.subject}"`);
    res.setHeader("Content-Type", attachment.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${attachment.filename}"`);
    res.sendFile(resolve(filePath));
  });

  app.get("/api/emails/:id/eml", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });

    const boundary = "----=_Part_" + Date.now().toString(36);
    const lines: string[] = [];
    lines.push(`MIME-Version: 1.0`);
    if (email.messageId) lines.push(`Message-ID: ${email.messageId}`);
    lines.push(`Date: ${new Date(email.date).toUTCString()}`);
    lines.push(`From: ${email.sender.name} <${email.sender.email}>`);
    lines.push(`To: ${email.to.map(r => `${r.name} <${r.email}>`).join(", ")}`);
    if (email.cc && email.cc.length > 0) {
      lines.push(`Cc: ${email.cc.map(r => `${r.name} <${r.email}>`).join(", ")}`);
    }
    lines.push(`Subject: ${email.subject}`);
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: quoted-printable`);
    lines.push("");
    lines.push(email.body);
    lines.push("");
    if (email.bodyHtml) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: text/html; charset="UTF-8"`);
      lines.push(`Content-Transfer-Encoding: quoted-printable`);
      lines.push("");
      lines.push(email.bodyHtml);
      lines.push("");
    }
    lines.push(`--${boundary}--`);

    const emlContent = lines.join("\r\n");
    const safeSubject = email.subject.replace(/[^a-zA-Z0-9 _-]/g, "_").substring(0, 50).trim() || "email";
    addLog(req.session.userId!, "info", "Export", `Exported "${email.subject}" as EML file`);
    res.setHeader("Content-Type", "message/rfc822");
    res.setHeader("Content-Disposition", `attachment; filename="${safeSubject}.eml"`);
    res.send(emlContent);
  });

  app.patch("/api/emails/:id/star", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const email = await storage.toggleStar(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });
    addLog(userId, "info", "Email", `${email.isStarred ? "Starred" : "Unstarred"} "${email.subject}"`);
    res.json(email);
  });

  app.patch("/api/emails/:id/read", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { isUnread } = req.body;
    const email = await storage.markRead(req.params.id, isUnread);
    if (!email) return res.status(404).json({ message: "Email not found" });
    addLog(userId, "info", "Email", `Marked "${email.subject}" as ${isUnread ? "unread" : "read"}`);
    res.json(email);
  });

  app.patch("/api/emails/:id/move", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { folder } = req.body;
    if (!folder) return res.status(400).json({ message: "folder is required" });
    const before = await storage.getEmail(req.params.id);
    const email = await storage.moveEmail(req.params.id, folder);
    if (!email) return res.status(404).json({ message: "Email not found" });
    addLog(userId, "info", "Email", `Moved "${email.subject}" from ${before?.folder || "unknown"} to ${folder}`);
    res.json(email);
  });

  app.post("/api/emails/:id/labels/:labelId", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const label = await storage.getLabel(req.params.labelId);
    if (!label) return res.status(404).json({ message: "Label not found" });
    const email = await storage.addLabel(req.params.id, req.params.labelId);
    if (!email) return res.status(404).json({ message: "Email not found" });
    addLog(userId, "info", "Labels", `Added label "${label.name}" to "${email.subject}"`);
    res.json(email);
  });

  app.delete("/api/emails/:id/labels/:labelId", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const label = await storage.getLabel(req.params.labelId);
    if (!label) return res.status(404).json({ message: "Label not found" });
    const email = await storage.removeLabel(req.params.id, req.params.labelId);
    if (!email) return res.status(404).json({ message: "Email not found" });
    addLog(userId, "info", "Labels", `Removed label "${label.name}" from "${email.subject}"`);
    res.json(email);
  });

  app.delete("/api/emails/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });

    if (email.folder === "trash") {
      await storage.deleteEmail(req.params.id);
      addLog(userId, "info", "Email", `Permanently deleted email "${email.subject}" from ${email.sender?.email || "unknown"}`);
      return res.json({ message: "Permanently deleted" });
    }

    const moved = await storage.moveEmail(req.params.id, "trash");
    addLog(userId, "info", "Email", `Moved email "${email.subject}" to Trash`);
    res.json(moved);
  });

  app.post("/api/emails/batch/delete", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ message: "ids must be an array" });
    const { trashed, deleted } = await storage.bulkDeleteEmails(ids);
    if (trashed > 0) addLog(userId, "info", "Email", `Moved ${trashed} email(s) to Trash`);
    if (deleted > 0) addLog(userId, "info", "Email", `Permanently deleted ${deleted} email(s)`);
    res.json({ trashed, deleted });
  });

  app.post("/api/emails/batch/move", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { ids, folder } = req.body;
    if (!Array.isArray(ids) || !folder) return res.status(400).json({ message: "ids and folder required" });
    const updates: Partial<Email> = { folder };
    if (folder === "trash") {
      updates.trashedAt = new Date().toISOString();
    } else {
      updates.trashedAt = undefined;
    }
    const moved = await storage.bulkUpdateEmails(ids, updates);
    addLog(userId, "info", "Email", `Moved ${moved} email(s) to ${folder}`);
    res.json({ moved });
  });

  app.post("/api/emails/batch/read", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { ids, isUnread } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ message: "ids must be an array" });
    const count = await storage.bulkUpdateEmails(ids, { isUnread });
    addLog(userId, "info", "Email", `Marked ${count} email(s) as ${isUnread ? "unread" : "read"}`);
    res.json({ updated: count });
  });

  app.post("/api/emails/batch/star", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { ids } = req.body;
    if (!Array.isArray(ids)) return res.status(400).json({ message: "ids must be an array" });
    for (const id of ids) {
      await storage.toggleStar(id);
    }
    addLog(userId, "info", "Email", `Toggled star on ${ids.length} email(s)`);
    res.json({ updated: ids.length });
  });

  app.post("/api/emails/compose", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const parsed = composeEmailSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { to, subject, body, accountId, cc, bcc, inReplyTo, references, attachments: composeAttachments, scheduledFor } = parsed.data;
    let senderEmail = "me@localmail.app";
    let senderName = "Me";
    let account: any = null;

    if (accountId) {
      account = await storage.getAccount(accountId);
      if (!account) return res.status(404).json({ message: "Account not found" });
      senderEmail = account.email;
      senderName = account.name;
    }

    const toRecipients = to.split(",").map(e => e.trim()).filter(Boolean).map(e => ({ name: e, email: e }));
    const ccRecipients = cc ? cc.split(",").map(e => e.trim()).filter(Boolean).map(e => ({ name: e, email: e })) : [];
    const bccRecipients = bcc ? bcc.split(",").map(e => e.trim()).filter(Boolean).map(e => ({ name: e, email: e })) : [];

    const isScheduled = !!scheduledFor;
    const isHtmlBody = /<[a-z][\s\S]*>/i.test(body);
    const email = await storage.createEmail({
      sender: { name: senderName, email: senderEmail },
      to: toRecipients,
      cc: ccRecipients.length > 0 ? ccRecipients : undefined,
      bcc: bccRecipients.length > 0 ? bccRecipients : undefined,
      subject,
      snippet: (isHtmlBody ? body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : body).substring(0, 120),
      body,
      bodyHtml: isHtmlBody ? body : undefined,
      date: new Date().toISOString(),
      isUnread: false,
      isStarred: false,
      folder: isScheduled ? "scheduled" : "sent",
      labels: [],
      accountEmail: accountId ? senderEmail : undefined,
      sendStatus: (!isScheduled && account) ? "sending" : undefined,
      scheduledFor: isScheduled ? new Date(scheduledFor).toISOString() : undefined,
    });

    res.json(email);

    if (isScheduled) {
      addLog(userId, "info", "Compose", `Email to ${to} scheduled for ${scheduledFor}`);
    } else if (account) {
      addLog(userId, "info", "SMTP send", `Sending email to ${to} via ${account.email}...`);
      sendSmtpEmail(account, to, subject, body, cc, bcc, { inReplyTo, references, attachments: composeAttachments })
        .then(async () => {
          addLog(userId, "success", "SMTP send", `Email sent to ${to} via ${account.email}`);
          await storage.updateEmail(email.id, { sendStatus: "sent" });
        })
        .catch(async (err: any) => {
          addLog(userId, "error", "SMTP send", `Failed to send to ${to}: ${err.message}`);
          await storage.updateEmail(email.id, { sendStatus: "failed", sendError: err.message });
        });
    } else {
      addLog(userId, "info", "Compose", `Email composed to ${to} (local only, no SMTP account)`);
    }
  });

  app.patch("/api/emails/:id/cancel-scheduled", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });
    if (email.folder !== "scheduled") return res.status(400).json({ message: "Email is not scheduled" });
    await storage.updateEmail(email.id, { folder: "drafts", scheduledFor: undefined });
    res.json({ message: "Schedule cancelled, moved to Drafts" });
  });

  app.post("/api/emails/:id/unsubscribe", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });

    const { listUnsubscribeUrl, listUnsubscribeMail, listUnsubscribeOneClick } = email;

    if (!listUnsubscribeUrl && !listUnsubscribeMail) {
      return res.status(400).json({ message: "This email has no unsubscribe information." });
    }

    if (listUnsubscribeUrl && listUnsubscribeOneClick) {
      try {
        const response = await fetch(listUnsubscribeUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "List-Unsubscribe=One-Click",
          signal: AbortSignal.timeout(10000),
        });
        if (response.ok) {
          addLog(userId, "success", "Unsubscribe", `One-click unsubscribe successful for "${email.subject}" from ${email.sender.email}`);
          return res.json({ type: "success" });
        }
      } catch {}
      addLog(userId, "info", "Unsubscribe", `Redirected to unsubscribe URL for "${email.subject}" from ${email.sender.email}`);
      return res.json({ type: "url", url: listUnsubscribeUrl });
    }

    if (listUnsubscribeUrl) {
      addLog(userId, "info", "Unsubscribe", `Redirected to unsubscribe URL for "${email.subject}" from ${email.sender.email}`);
      return res.json({ type: "url", url: listUnsubscribeUrl });
    }

    if (listUnsubscribeMail) {
      const qIndex = listUnsubscribeMail.indexOf("?");
      const to = qIndex === -1 ? listUnsubscribeMail : listUnsubscribeMail.slice(0, qIndex);
      const params = new URLSearchParams(qIndex === -1 ? "" : listUnsubscribeMail.slice(qIndex + 1));
      const subject = params.get("subject") || "Unsubscribe";
      addLog(userId, "info", "Unsubscribe", `Mailto unsubscribe initiated for "${email.subject}" from ${email.sender.email} → ${to}`);
      return res.json({ type: "mailto", to, subject });
    }
  });

  app.post("/api/emails/:id/retry-send", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const email = await storage.getEmail(req.params.id);
    if (!email) return res.status(404).json({ message: "Email not found" });
    if (email.sendStatus !== "failed" && email.sendStatus !== "sending") return res.status(400).json({ message: "Email is not in a failed or sending state" });
    if (!email.accountEmail) return res.status(400).json({ message: "No account associated with this email" });

    const accounts = await storage.getAccounts();
    const account = accounts.find(a => a.email === email.accountEmail);
    if (!account) return res.status(404).json({ message: "Associated mail account not found" });

    await storage.updateEmail(email.id, { sendStatus: "sending", sendError: undefined });
    res.json({ message: "Retrying send..." });

    const toStr = email.to.map(t => t.email).join(", ");
    const ccStr = email.cc?.map(t => t.email).join(", ");
    const bccStr = email.bcc?.map(t => t.email).join(", ");

    addLog(userId, "info", "SMTP send", `Retrying send to ${toStr} via ${account.email}...`);
    sendSmtpEmail(account, toStr, email.subject, email.body, ccStr, bccStr)
      .then(async () => {
        addLog(userId, "success", "SMTP send", `Email sent to ${toStr} via ${account.email}`);
        await storage.updateEmail(email.id, { sendStatus: "sent" });
      })
      .catch(async (err: any) => {
        addLog(userId, "error", "SMTP send", `Retry failed to ${toStr}: ${err.message}`);
        await storage.updateEmail(email.id, { sendStatus: "failed", sendError: err.message });
      });
  });

  const parseDraftRecipients = (val: any) => {
    if (!val || typeof val !== "string") return [];
    return val.split(",").map((e: string) => e.trim()).filter(Boolean).map((e: string) => ({ name: e, email: e }));
  };

  app.post("/api/drafts", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { to, cc, bcc, subject, body, accountId } = req.body || {};
    const draft = await storage.createEmail({
      sender: { name: "Me", email: "me@localmail.app" },
      to: parseDraftRecipients(to),
      cc: cc ? parseDraftRecipients(cc) : undefined,
      bcc: bcc ? parseDraftRecipients(bcc) : undefined,
      subject: typeof subject === "string" ? subject || "(no subject)" : "(no subject)",
      snippet: (typeof body === "string" ? body : "").substring(0, 120),
      body: typeof body === "string" ? body : "",
      date: new Date().toISOString(),
      isUnread: false,
      isStarred: false,
      folder: "drafts",
      labels: [],
      accountEmail: typeof accountId === "string" ? accountId : undefined,
    });
    addLog(userId, "info", "Drafts", `Draft saved: "${draft.subject}"`);
    res.json(draft);
  });

  app.put("/api/drafts/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const existing = await storage.getEmail(req.params.id);
    if (!existing) return res.status(404).json({ message: "Draft not found" });
    if (existing.folder !== "drafts") return res.status(400).json({ message: "Not a draft" });
    const { to, cc, bcc, subject, body, accountId } = req.body || {};
    const updated = await storage.updateEmail(req.params.id, {
      to: parseDraftRecipients(to),
      cc: cc ? parseDraftRecipients(cc) : undefined,
      bcc: bcc ? parseDraftRecipients(bcc) : undefined,
      subject: typeof subject === "string" ? subject || "(no subject)" : "(no subject)",
      snippet: (typeof body === "string" ? body : "").substring(0, 120),
      body: typeof body === "string" ? body : "",
      date: new Date().toISOString(),
      accountEmail: typeof accountId === "string" ? accountId : undefined,
    });
    res.json(updated);
  });

  app.delete("/api/drafts/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const existing = await storage.getEmail(req.params.id);
    if (!existing) return res.status(404).json({ message: "Draft not found" });
    if (existing.folder !== "drafts") return res.status(400).json({ message: "Not a draft" });
    await storage.deleteEmail(req.params.id);
    addLog(userId, "info", "Drafts", `Draft discarded: "${existing.subject}"`);
    res.json({ message: "Draft deleted" });
  });

  app.get("/api/labels", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const labels = await storage.getLabels();
    res.json(labels);
  });

  app.post("/api/labels", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const parsed = insertLabelSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const label = await storage.createLabel(parsed.data);
    addLog(userId, "info", "Labels", `Created label "${label.name}"`);
    res.json(label);
  });

  app.patch("/api/labels/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const label = await storage.updateLabel(req.params.id, req.body);
    if (!label) return res.status(404).json({ message: "Label not found" });
    addLog(userId, "info", "Labels", `Updated label "${label.name}"`);
    res.json(label);
  });

  app.delete("/api/labels/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const existing = await storage.getLabel(req.params.id);
    const deleted = await storage.deleteLabel(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Label not found" });
    addLog(userId, "info", "Labels", `Deleted label "${existing?.name || req.params.id}"`);
    res.json({ message: "Deleted" });
  });

  app.get("/api/settings", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const settings = await storage.getSettings();
    res.json(settings);
  });

  const handleSettingsUpdate = async (req: Request, res: Response) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const parsed = generalSettingsSchema.partial().strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid settings fields", errors: parsed.error.flatten() });
    const settings = await storage.updateSettings(parsed.data);
    const changedKeys = Object.keys(parsed.data).join(", ");
    addLog(userId, "info", "Settings", `Updated settings: ${changedKeys}`);
    res.json(settings);
  };

  app.put("/api/settings", requireAuth, handleSettingsUpdate);
  app.patch("/api/settings", requireAuth, handleSettingsUpdate);

  app.get("/api/contacts", requireAuth, (req, res) => {
    const storage = getUserStorage(req);
    const query = (req.query.q as string) || "";
    const contacts = storage.searchContacts(query);
    res.json(contacts);
  });

  app.get("/api/logs", requireAuth, (req, res) => {
    const userId = req.session.userId!;
    let logs = userLogs.get(userId) || [];
    const { level, source, search } = req.query;
    if (level && typeof level === "string") {
      const levels = level.split(",");
      logs = logs.filter(l => levels.includes(l.level));
    }
    if (source && typeof source === "string") {
      logs = logs.filter(l => l.source === source);
    }
    if (search && typeof search === "string") {
      const q = search.toLowerCase();
      logs = logs.filter(l => l.message.toLowerCase().includes(q) || l.source.toLowerCase().includes(q));
    }
    res.json(logs);
  });

  app.delete("/api/logs", requireAuth, (req, res) => {
    const userId = req.session.userId!;
    userLogs.set(userId, []);
    res.json({ message: "Logs cleared" });
  });

  app.get("/api/accounts", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const accounts = await storage.getAccounts();
    const safe = accounts.map(a => ({ ...a, password: "****", smtpPassword: a.smtpPassword ? "****" : undefined }));
    res.json(safe);
  });

  app.post("/api/accounts/test-incoming", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const { protocol, host, port, username, password, tls } = req.body;
    if (!host || !port || !username || !password) {
      return res.status(400).json({ success: false, message: "Host, port, username, and password are required" });
    }
    const proto = (protocol || "pop3").toUpperCase();
    addLog(userId, "info", "Test connection", `Testing ${proto} connection to ${host}:${port} (TLS: ${tls !== false})...`);
    const startTime = Date.now();
    const result = await testIncomingConnection({
      protocol: protocol || "pop3",
      host, port: Number(port), username, password, tls: tls !== false,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog(userId, result.success ? "success" : "error", "Test connection", `${proto} ${host}:${port} — ${result.message} (${elapsed}s)`);
    res.json(result);
  });

  app.post("/api/accounts/test-smtp", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const { host, port, username, password, tls } = req.body;
    if (!host || !port || !username || !password) {
      return res.status(400).json({ success: false, message: "Host, port, username, and password are required" });
    }
    addLog(userId, "info", "Test connection", `Testing SMTP connection to ${host}:${port} (TLS: ${tls !== false})...`);
    const startTime = Date.now();
    const result = await testSmtpConnection({
      host, port: Number(port), username, password, tls: tls !== false,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog(userId, result.success ? "success" : "error", "Test connection", `SMTP ${host}:${port} — ${result.message} (${elapsed}s)`);
    res.json(result);
  });

  app.post("/api/accounts/:id/test", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ success: false, message: "Account not found" });

    const startTime = Date.now();
    const proto = (account.protocol || "pop3").toUpperCase();
    addLog(userId, "info", "Test connection", `Testing ${proto} connection to ${account.host}:${account.port}…`);

    const result = await testIncomingConnection({
      protocol: account.protocol || "pop3",
      host: account.host,
      port: account.port,
      username: account.username,
      password: account.password || "",
      tls: account.tls !== false,
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    addLog(userId, result.success ? "success" : "error", "Test connection", `${proto} ${account.host}:${account.port} — ${result.message} (${elapsed}s)`);

    let smtpResult: { success: boolean; message: string } | undefined;
    if (account.smtpHost) {
      const smtpStart = Date.now();
      addLog(userId, "info", "Test connection", `Testing SMTP connection to ${account.smtpHost}:${account.smtpPort}…`);
      smtpResult = await testSmtpConnection({
        host: account.smtpHost,
        port: account.smtpPort || 587,
        username: account.username,
        password: account.smtpPassword || account.password || "",
        tls: account.smtpTls !== false,
      });
      const smtpElapsed = ((Date.now() - smtpStart) / 1000).toFixed(1);
      addLog(userId, smtpResult.success ? "success" : "error", "Test connection", `SMTP ${account.smtpHost}:${account.smtpPort} — ${smtpResult.message} (${smtpElapsed}s)`);
    }

    res.json({ incoming: result, smtp: smtpResult });
  });

  app.post("/api/accounts", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const parsed = insertMailAccountSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const account = await storage.createAccount(parsed.data);
    addLog(userId, "success", "Accounts", `Account "${account.name}" (${account.email}) added — ${(account.protocol || "pop3").toUpperCase()} ${account.host}:${account.port}`);

    if (account.autoFetchEnabled !== false && req.session.userId) {
      startAutoFetch(req.session.userId, account.id, account.autoFetchInterval || 30);
    }

    res.json({ ...account, password: "****", smtpPassword: account.smtpPassword ? "****" : undefined });
  });

  app.patch("/api/accounts/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const account = await storage.updateAccount(req.params.id, req.body);
    if (!account) return res.status(404).json({ message: "Account not found" });
    addLog(userId, "info", "Accounts", `Account "${account.name}" (${account.email}) updated`);

    if (req.session.userId) {
      if (account.autoFetchEnabled !== false) {
        startAutoFetch(req.session.userId, account.id, account.autoFetchInterval || 30);
      } else {
        stopAutoFetch(req.session.userId, account.id);
      }
    }

    res.json({ ...account, password: "****", smtpPassword: account.smtpPassword ? "****" : undefined });
  });

  app.delete("/api/accounts/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const existing = await storage.getAccount(req.params.id);
    if (req.session.userId) {
      stopAutoFetch(req.session.userId, req.params.id);
    }
    const deleted = await storage.deleteAccount(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Account not found" });
    addLog(userId, "warn", "Accounts", `Account "${existing?.name || req.params.id}" (${existing?.email || "unknown"}) deleted`);
    res.json({ message: "Deleted" });
  });

  app.post("/api/accounts/:id/fetch", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });

    const proto = (account.protocol || "pop3").toUpperCase();
    addLog(userId, "info", "Manual fetch", `Fetching emails for ${account.email} via ${proto}...`);
    try {
      const startTime = Date.now();
      const results = await fetchEmails(account);
      const fetchElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      addLog(userId, "info", "Manual fetch", `${proto} server returned ${results.length} message(s) for ${account.email} in ${fetchElapsed}s`);
      let imported = 0;
      let duplicates = 0;
      for (const result of results) {
        if (result.email.messageId && storage.hasMessageId(result.email.messageId)) {
          duplicates++;
          continue;
        }
        result.email.accountEmail = account.email;
        // If the sender address matches the fetching account, treat as a sent email
        if (result.email.sender.email.toLowerCase() === account.email.toLowerCase()) {
          result.email.folder = "sent";
          result.email.isUnread = false;
        }
        let accountLabel = await storage.getLabelByName(account.email);
        if (!accountLabel) {
          accountLabel = await storage.createLabel({ name: account.email, color: "#1a73e8" });
        }
        const labels = [...(result.email.labels || [])];
        if (!labels.includes(accountLabel.id)) labels.push(accountLabel.id);
        result.email.labels = labels;

        result.email = storage.applyRulesToEmail(result.email);

        const created = await storage.createEmail(result.email);
        if (result.rawAttachments.length > 0) {
          saveAttachmentsToDisk(created.id, result.rawAttachments, storage.getAttachmentsDir());
          addLog(userId, "info", "Manual fetch", `Saved ${result.rawAttachments.length} attachment(s) for "${created.subject}"`);
        }
        if (created.folder === "inbox") {
          maybeSendVacationReply(userId, storage, created, account).catch(() => {});
        }
        imported++;
      }
      await storage.updateAccount(account.id, { lastFetched: new Date().toISOString() });
      const skipMsg = duplicates > 0 ? ` (${duplicates} duplicates skipped)` : "";
      addLog(userId, "success", "Manual fetch", `${imported} new emails fetched for ${account.email} via ${proto}${skipMsg}`);
      res.json({ message: `Fetched ${imported} new emails via ${proto}${skipMsg}`, count: imported });
    } catch (err: any) {
      addLog(userId, "error", "Manual fetch", `${proto} fetch failed for ${account.email}: ${err.message}`);
      res.status(500).json({ message: `${proto} fetch failed: ${err.message}` });
    }
  });

  app.post("/api/accounts/:id/repair-attachments", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const account = await storage.getAccount(req.params.id);
    if (!account) return res.status(404).json({ message: "Account not found" });

    const proto = (account.protocol || "pop3").toUpperCase();
    addLog(userId, "info", "Repair", `Starting attachment repair for ${account.email} via ${proto}...`);
    try {
      const results = await fetchEmails(account);
      let repaired = 0;

      for (const result of results) {
        if (!result.email.messageId || result.rawAttachments.length === 0) continue;

        const existing = storage.getEmailIndexByMessageId(result.email.messageId);
        if (!existing || existing.hasAttachments) continue;

        await storage.updateEmail(existing.id, { attachments: result.email.attachments });
        saveAttachmentsToDisk(existing.id, result.rawAttachments, storage.getAttachmentsDir());
        addLog(userId, "info", "Repair", `Restored ${result.rawAttachments.length} attachment(s) on email ${existing.id}`);
        repaired++;
      }

      const msg = repaired > 0
        ? `Repaired attachments on ${repaired} email${repaired > 1 ? "s" : ""}`
        : "No emails needed attachment repair";
      addLog(userId, "success", "Repair", msg);
      res.json({ message: msg, repaired, checked: results.length });
    } catch (err: any) {
      addLog(userId, "error", "Repair", `Attachment repair failed for ${account.email}: ${err.message}`);
      res.status(500).json({ message: `Repair failed: ${err.message}` });
    }
  });

  app.get("/api/custom-folders", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const folders = await storage.getCustomFolders();
    res.json(folders);
  });

  app.post("/api/custom-folders", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const parsed = insertCustomFolderSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid folder data" });
    const folder = await storage.createCustomFolder(parsed.data);
    addLog(req.session.userId!, "info", "Folders", `Created custom folder "${folder.name}"`);
    res.json(folder);
  });

  app.patch("/api/custom-folders/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const updated = await storage.updateCustomFolder(req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Folder not found" });
    addLog(req.session.userId!, "info", "Folders", `Updated custom folder "${updated.name}"`);
    res.json(updated);
  });

  app.delete("/api/custom-folders/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const folders = await storage.getCustomFolders();
    const folderName = folders.find(f => f.id === req.params.id)?.name || req.params.id;
    const deleted = await storage.deleteCustomFolder(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Folder not found" });
    addLog(req.session.userId!, "warn", "Folders", `Deleted custom folder "${folderName}"`);
    res.json({ message: "Deleted" });
  });

  app.get("/api/rules", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const rules = await storage.getEmailRules();
    res.json(rules);
  });

  app.post("/api/rules", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const parsed = insertEmailRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid rule data", errors: parsed.error.issues });
    const rule = await storage.createEmailRule(parsed.data);
    addLog(req.session.userId!, "info", "Rules", `Created email rule "${rule.name}"`);
    res.json(rule);
  });

  app.patch("/api/rules/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const updated = await storage.updateEmailRule(req.params.id, req.body);
    if (!updated) return res.status(404).json({ message: "Rule not found" });
    addLog(req.session.userId!, "info", "Rules", `Updated email rule "${updated.name}"`);
    res.json(updated);
  });

  app.delete("/api/rules/:id", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const rules = await storage.getEmailRules();
    const ruleName = rules.find(r => r.id === req.params.id)?.name || req.params.id;
    const deleted = await storage.deleteEmailRule(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Rule not found" });
    addLog(req.session.userId!, "warn", "Rules", `Deleted email rule "${ruleName}"`);
    res.json({ message: "Deleted" });
  });

  app.post("/api/rules/run-all", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    addLog(userId, "info", "Rules", `Running all rules on existing emails...`);
    const result = await storage.applyRulesToAllEmails();
    addLog(userId, "success", "Rules", `Rules applied: ${result.matched} of ${result.total} emails matched and updated`);
    res.json(result);
  });

  app.get("/api/backup/config", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const config = storage.getBackupConfig();
    if (!config) return res.json(null);
    const safe = { ...config };
    if (safe.s3) safe.s3 = { ...safe.s3, secretAccessKey: "••••••••" };
    if (safe.azure) safe.azure = { ...safe.azure, connectionString: "••••••••" };
    if (safe.gcp) safe.gcp = { ...safe.gcp, keyJson: "••••••••" };
    res.json(safe);
  });

  app.get("/api/backup/status", requireAuth, (req, res) => {
    const userId = req.session.userId!;
    const nextAt = getNextBackupTime(userId);
    res.json({ nextBackupAt: nextAt ? new Date(nextAt).toISOString() : null, active: nextAt !== null });
  });

  app.post("/api/backup/config", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const parsed = backupConfigSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const incoming = parsed.data;
    const existing = storage.getBackupConfig();
    if (existing) {
      if (incoming.s3?.secretAccessKey === "UNCHANGED" && existing.s3) incoming.s3.secretAccessKey = existing.s3.secretAccessKey;
      if (incoming.azure?.connectionString === "UNCHANGED" && existing.azure) incoming.azure.connectionString = existing.azure.connectionString;
      if (incoming.gcp?.keyJson === "UNCHANGED" && existing.gcp) incoming.gcp.keyJson = existing.gcp.keyJson;
    }
    await storage.updateBackupConfig(incoming);
    addLog(userId, "info", "Backup", `Backup configuration updated (${parsed.data.provider.toUpperCase()})`);

    const decrypted = storage.getDecryptedBackupConfig();
    if (decrypted && decrypted.enabled && decrypted.schedule !== "manual") {
      startScheduledBackup(
        userId,
        decrypted,
        (level, message) => { addLog(userId, level as any, "Backup", message); },
        async (success, message) => {
          try {
            const existing = storage.getBackupConfig();
            if (existing) {
              existing.lastBackup = new Date().toISOString();
              existing.lastBackupStatus = success ? "success" : "failed";
              existing.lastBackupMessage = message;
              await storage.updateBackupConfig(existing);
            }
          } catch {}
        }
      );
    } else {
      stopScheduledBackup(userId);
    }

    res.json({ message: "Backup configuration saved" });
  });

  app.post("/api/backup/test", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const decrypted = storage.getDecryptedBackupConfig();
    if (!decrypted) return res.status(400).json({ message: "No backup configuration found" });
    addLog(userId, "info", "Backup", `Testing ${decrypted.provider.toUpperCase()} connection...`);
    const result = await testConnection(decrypted);
    addLog(userId, result.success ? "success" : "error", "Backup", result.message);
    res.json(result);
  });

  app.post("/api/backup/run", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const decrypted = storage.getDecryptedBackupConfig();
    if (!decrypted) return res.status(400).json({ message: "No backup configuration found" });
    addLog(userId, "info", "Backup", `Starting manual backup to ${decrypted.provider.toUpperCase()}...`);
    const result = await runBackup(userId, decrypted);
    if (result.success) {
      addLog(userId, "success", "Backup", `Manual backup completed: ${result.message} (${result.fileName})`);
      const existing = storage.getBackupConfig();
      if (existing) {
        existing.lastBackup = new Date().toISOString();
        existing.lastBackupStatus = "success";
        existing.lastBackupMessage = result.message;
        await storage.updateBackupConfig(existing);
      }
    } else {
      addLog(userId, "error", "Backup", `Manual backup failed: ${result.message}`);
      const existing = storage.getBackupConfig();
      if (existing) {
        existing.lastBackupStatus = "failed";
        existing.lastBackupMessage = result.message;
        await storage.updateBackupConfig(existing);
      }
    }
    res.json(result);
  });

  app.get("/api/backup/list", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const decrypted = storage.getDecryptedBackupConfig();
    if (!decrypted) return res.json([]);
    const backups = await listBackups(decrypted, userId);
    res.json(backups);
  });

  app.get("/api/backup/local/download", requireAuth, backupLimiter, async (req, res) => {
    const userId = req.session.userId!;
    try {
      addLog(userId, "info", "Backup", "Creating local backup archive...");
      const archivePath = await createBackupArchive(userId);
      const now = new Date();
      const dateStr = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const fileName = `localmail-backup-${dateStr}.zip`;
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      res.setHeader("Content-Type", "application/zip");
      const { createReadStream } = await import("fs");
      const stream = createReadStream(archivePath);
      stream.pipe(res);
      stream.on("end", () => {
        try { unlinkSync(archivePath); } catch {}
      });
      addLog(userId, "success", "Backup", `Local backup downloaded: ${fileName}`);
    } catch (err: any) {
      addLog(userId, "error", "Backup", `Local backup failed: ${err.message}`);
      res.status(500).json({ message: err.message || "Failed to create backup" });
    }
  });

  const uploadDir = resolve("data/.tmp");
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
  const upload = multer({ dest: uploadDir, limits: { fileSize: 500 * 1024 * 1024 } });

  app.post("/api/backup/local/restore", requireAuth, backupLimiter, upload.single("backup"), async (req, res) => {
    const userId = req.session.userId!;
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
    const safeUploadDir = resolve(uploadDir);
    const safeFilePath = resolve(req.file.path);
    if (!safeFilePath.startsWith(safeUploadDir + "/") && safeFilePath !== safeUploadDir) {
      try { unlinkSync(safeFilePath); } catch {}
      return res.status(400).json({ success: false, message: "Invalid upload path" });
    }
    try {
      addLog(userId, "info", "Backup", `Restoring from uploaded file: ${req.file.originalname}`);
      const result = await restoreBackup(userId, safeFilePath);
      addLog(userId, result.success ? "success" : "error", "Backup", result.success ? `Restored from "${req.file.originalname}"` : `Restore failed: ${result.message}`);
      res.json(result);
    } catch (err: any) {
      try { unlinkSync(safeFilePath); } catch {}
      addLog(userId, "error", "Backup", `Local restore failed: ${err.message}`);
      res.status(500).json({ success: false, message: err.message || "Restore failed" });
    }
  });

  app.post("/api/backup/restore", requireAuth, async (req, res) => {
    const storage = getUserStorage(req);
    const userId = req.session.userId!;
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ message: "fileName required" });
    const decrypted = storage.getDecryptedBackupConfig();
    if (!decrypted) return res.status(400).json({ message: "No backup configuration found" });
    addLog(userId, "info", "Backup", `Starting restore from "${fileName}"...`);
    const zipPath = await downloadBackup(decrypted, fileName);
    if (!zipPath) {
      addLog(userId, "error", "Backup", `Failed to download backup "${fileName}"`);
      return res.status(500).json({ message: "Failed to download backup file" });
    }
    const result = await restoreBackup(userId, zipPath);
    addLog(userId, result.success ? "success" : "error", "Backup", result.success ? `Restored from "${fileName}"` : `Restore failed: ${result.message}`);
    res.json(result);
  });

  function startScheduledEmailProcessor() {
    setInterval(async () => {
      const now = new Date().toISOString();
      const allStorages = globalStorage.getAllActiveStorages();
      for (const storage of allStorages) {
        try {
          const scheduled = await storage.getEmails("scheduled");
          const due = scheduled.filter(e => e.scheduledFor && e.scheduledFor <= now);
          for (const email of due) {
            if (!email.accountEmail) {
              await storage.updateEmail(email.id, { folder: "sent", scheduledFor: undefined });
              continue;
            }
            const accounts = await storage.getAccounts();
            const account = accounts.find(a => a.email === email.accountEmail);
            if (!account) {
              await storage.updateEmail(email.id, { folder: "sent", scheduledFor: undefined });
              continue;
            }
            await storage.updateEmail(email.id, { sendStatus: "sending" });
            const toStr = email.to.map(t => t.email).join(", ");
            const ccStr = email.cc?.map(t => t.email).join(", ");
            const bccStr = email.bcc?.map(t => t.email).join(", ");
            sendSmtpEmail(account, toStr, email.subject, email.body, ccStr, bccStr)
              .then(async () => {
                await storage.updateEmail(email.id, { folder: "sent", scheduledFor: undefined, sendStatus: "sent" });
              })
              .catch(async (err: any) => {
                await storage.updateEmail(email.id, { folder: "sent", scheduledFor: undefined, sendStatus: "failed", sendError: err.message });
              });
          }
        } catch (_) {}
      }
    }, 60000);
  }

  setTimeout(() => {
    initAutoFetchForAllUsers();
    startTrashPurgeTimer();
    initScheduledBackups();
    startScheduledEmailProcessor();
  }, 2000);

  return httpServer;
}
