import { type Email, type InsertEmail, type MailAccount, type InsertMailAccount, type User, type InsertUser, type EmailLabel, type InsertLabel, type GeneralSettings, type CustomFolder, type InsertCustomFolder, type EmailRule, type InsertEmailRule, type BackupConfig } from "@shared/schema";
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync, unlinkSync, rmSync } from "fs";
import { dirname, join } from "path";
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "crypto";
import bcrypt from "bcryptjs";

const DATA_DIR = "data";
const USERS_FILE = join(DATA_DIR, "users.json");
const ENCRYPTION_KEY_FILE = join(DATA_DIR, ".encryption-key");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidId(id: string): boolean {
  return UUID_RE.test(id);
}

function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    const isValidHex = /^[0-9a-fA-F]{64}$/.test(envKey);
    if (isValidHex) {
      return Buffer.from(envKey, "hex");
    }
    console.warn(
      "[LocalMail] WARNING: ENCRYPTION_KEY is set but does not look like a valid 64-character hex string. " +
      "Generate one with: openssl rand -hex 32\n" +
      "[LocalMail] Falling back to auto-generated key stored in data/.encryption-key"
    );
  }
  if (existsSync(ENCRYPTION_KEY_FILE)) {
    return Buffer.from(readFileSync(ENCRYPTION_KEY_FILE, "utf-8").trim(), "hex");
  }
  const key = randomBytes(32);
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(ENCRYPTION_KEY_FILE, key.toString("hex"), "utf-8");
  console.log("[LocalMail] Generated new encryption key. Saved to data/.encryption-key — back this file up!");
  return key;
}

function encryptString(text: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  let encrypted = cipher.update(text, "utf-8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptString(encrypted: string): string {
  try {
    if (!encrypted.includes(":")) return encrypted;
    const key = getEncryptionKey();
    const [ivHex, data] = encrypted.split(":");
    const iv = Buffer.from(ivHex, "hex");
    if (iv.length !== 16) return encrypted;
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    let decrypted = decipher.update(data, "hex", "utf-8");
    decrypted += decipher.final("utf-8");
    return decrypted;
  } catch {
    return encrypted;
  }
}

function isEncrypted(value: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]+$/.test(value);
}

function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

function isLegacySha256(hash: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash);
}

function verifyLegacySha256(password: string, hash: string): boolean {
  return createHash("sha256").update(password).digest("hex") === hash;
}

export function verifyPassword(password: string, hash: string): boolean {
  if (isLegacySha256(hash)) {
    return verifyLegacySha256(password, hash);
  }
  return bcrypt.compareSync(password, hash);
}

export function rehashIfNeeded(password: string, currentHash: string): string | null {
  if (isLegacySha256(currentHash)) {
    return hashPassword(password);
  }
  return null;
}

interface EmailIndex {
  id: string;
  sender: { name: string; email: string };
  to: { name: string; email: string }[];
  subject: string;
  snippet: string;
  date: string;
  isUnread: boolean;
  isStarred: boolean;
  folder: string;
  labels?: string[];
  hasAttachments?: boolean;
  accountEmail?: string;
  trashedAt?: string;
  spammedAt?: string;
  messageId?: string;
  sendStatus?: "sending" | "sent" | "failed";
  sendError?: string;
}

interface UserMeta {
  accounts: Record<string, MailAccount>;
  labels: Record<string, EmailLabel>;
  settings?: GeneralSettings;
  contacts?: Record<string, { name: string; email: string }>;
  customFolders?: Record<string, CustomFolder>;
  emailRules?: Record<string, EmailRule>;
  deletedMessageIds?: string[];
  backupConfig?: BackupConfig;
}

interface UsersData {
  users: Record<string, User>;
}

function userDir(userId: string): string {
  return join(DATA_DIR, "users", userId);
}

function userMetaFile(userId: string): string {
  return join(userDir(userId), "storage.json");
}

function userEmailsDir(userId: string): string {
  return join(userDir(userId), "emails");
}

function userAttachmentsDir(userId: string): string {
  return join(userDir(userId), "attachments");
}

export class UserStorage {
  private emailIndex: Map<string, EmailIndex>;
  private accounts: Map<string, MailAccount>;
  private labels: Map<string, EmailLabel>;
  private contacts: Map<string, { name: string; email: string }>;
  private customFolders: Map<string, CustomFolder>;
  private emailRules: Map<string, EmailRule>;
  private deletedMessageIds: Set<string>;
  private backupConfig: BackupConfig | null;
  private settings: GeneralSettings;
  private userId: string;
  private metaSaveTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(userId: string) {
    if (!isValidId(userId)) throw new Error("Invalid user ID");
    this.userId = userId;
    this.emailIndex = new Map();
    this.accounts = new Map();
    this.labels = new Map();
    this.contacts = new Map();
    this.customFolders = new Map();
    this.emailRules = new Map();
    this.deletedMessageIds = new Set();
    this.backupConfig = null;
    this.settings = {
      displayDensity: "default",
      conversationView: true,
      showLabels: true,
      autoRefresh: true,
      refreshInterval: 30,
      notifyNewMail: true,
      sendCancellation: 5,
      signature: "",
      trashRetentionDays: 30,
      spamRetentionDays: 30,
      defaultSendAccountId: "",
      emailsPerPage: 20,
      darkMode: false,
      mobileShowTagRow: true,
    };

    const emailsDir = userEmailsDir(userId);
    if (!existsSync(emailsDir)) mkdirSync(emailsDir, { recursive: true });

    const metaFile = userMetaFile(userId);
    if (existsSync(metaFile)) {
      this.loadMeta();
    } else {
      this.seedLabels();
      this.persistMetaSync();
    }
  }

  private loadMeta() {
    try {
      const raw = readFileSync(userMetaFile(this.userId), "utf-8");
      const data: UserMeta = JSON.parse(raw);

      let needsResave = false;
      for (const [id, account] of Object.entries(data.accounts || {})) {
        const migrated: MailAccount = {
          ...account,
          protocol: account.protocol || "pop3",
          smtpTls: account.smtpTls ?? (account.smtpPort === 465),
          deleteOnFetch: account.deleteOnFetch ?? false,
          autoFetchEnabled: account.autoFetchEnabled ?? true,
          autoFetchInterval: account.autoFetchInterval ?? 30,
        };
        if (migrated.password && !isEncrypted(migrated.password)) {
          migrated.password = encryptString(migrated.password);
          needsResave = true;
        }
        if (migrated.smtpPassword && !isEncrypted(migrated.smtpPassword)) {
          migrated.smtpPassword = encryptString(migrated.smtpPassword);
          needsResave = true;
        }
        this.accounts.set(id, migrated);
      }
      if (needsResave) {
        this.scheduleMetaSave();
        console.log(`User ${this.userId}: Encrypted plaintext mail account passwords.`);
      }
      for (const [id, label] of Object.entries(data.labels || {})) {
        this.labels.set(id, label);
      }
      for (const [key, contact] of Object.entries(data.contacts || {})) {
        this.contacts.set(key, contact);
      }
      for (const [id, folder] of Object.entries(data.customFolders || {})) {
        this.customFolders.set(id, folder);
      }
      for (const [id, rule] of Object.entries(data.emailRules || {})) {
        this.emailRules.set(id, rule);
      }
      if (data.deletedMessageIds) {
        for (const msgId of data.deletedMessageIds) {
          this.deletedMessageIds.add(msgId);
        }
      }
      if (data.backupConfig) {
        this.backupConfig = data.backupConfig;
      }
      if (data.settings) {
        this.settings = { ...this.settings, ...data.settings };
      }

      this.loadEmailIndex();
      console.log(`User ${this.userId}: Loaded ${this.emailIndex.size} emails, ${this.accounts.size} accounts, ${this.labels.size} labels`);
    } catch (err) {
      console.error(`User ${this.userId}: Failed to load storage, starting fresh:`, err);
      this.seedLabels();
      this.persistMetaSync();
    }
  }

  private loadEmailIndex() {
    const dir = userEmailsDir(this.userId);
    if (!existsSync(dir)) return;
    const files = readdirSync(dir).filter(f => f.endsWith(".json"));
    let migrated = 0;
    for (const file of files) {
      try {
        const filePath = join(dir, file);
        const raw = readFileSync(filePath, "utf-8");
        let content: string;
        if (isEncrypted(raw)) {
          content = decryptString(raw);
        } else {
          content = raw;
          const encrypted = encryptString(raw);
          const tmpPath = filePath + ".tmp";
          writeFileSync(tmpPath, encrypted, "utf-8");
          renameSync(tmpPath, filePath);
          migrated++;
        }
        const email: Email = JSON.parse(content);
        this.emailIndex.set(email.id, {
          id: email.id,
          sender: email.sender,
          to: email.to,
          subject: email.subject,
          snippet: email.snippet,
          date: email.date,
          isUnread: email.isUnread,
          isStarred: email.isStarred,
          folder: email.folder,
          labels: email.labels,
          hasAttachments: !!(email.attachments && email.attachments.length > 0),
          accountEmail: email.accountEmail,
          trashedAt: email.trashedAt,
          spammedAt: email.spammedAt,
          messageId: email.messageId,
          sendStatus: email.sendStatus,
          sendError: email.sendError,
        });
      } catch {}
    }
    if (migrated > 0) {
      console.log(`User ${this.userId}: Encrypted ${migrated} email files`);
    }
  }

  private writeEmailFile(id: string, email: Email) {
    if (!isValidId(id)) throw new Error("Invalid email ID");
    const dir = userEmailsDir(this.userId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filePath = join(dir, `${id}.json`);
    const tmpPath = filePath + ".tmp";
    const jsonStr = JSON.stringify(email, null, 2);
    const encrypted = encryptString(jsonStr);
    writeFileSync(tmpPath, encrypted, "utf-8");
    renameSync(tmpPath, filePath);
  }

  private deleteEmailFile(id: string) {
    if (!isValidId(id)) return;
    const filePath = join(userEmailsDir(this.userId), `${id}.json`);
    if (existsSync(filePath)) unlinkSync(filePath);
  }

  private readEmailFile(id: string): Email | undefined {
    if (!isValidId(id)) return undefined;
    const filePath = join(userEmailsDir(this.userId), `${id}.json`);
    if (!existsSync(filePath)) return undefined;
    try {
      const raw = readFileSync(filePath, "utf-8");
      const content = isEncrypted(raw) ? decryptString(raw) : raw;
      return JSON.parse(content);
    } catch {
      return undefined;
    }
  }

  private scheduleMetaSave() {
    if (this.metaSaveTimeout) clearTimeout(this.metaSaveTimeout);
    this.metaSaveTimeout = setTimeout(() => this.persistMetaSync(), 100);
  }

  private persistMetaSync() {
    const data: UserMeta = {
      accounts: Object.fromEntries(this.accounts),
      labels: Object.fromEntries(this.labels),
      settings: this.settings,
      contacts: Object.fromEntries(this.contacts),
      customFolders: Object.fromEntries(this.customFolders),
      emailRules: Object.fromEntries(this.emailRules),
      deletedMessageIds: Array.from(this.deletedMessageIds),
      backupConfig: this.backupConfig || undefined,
    };
    const dir = userDir(this.userId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const metaFile = userMetaFile(this.userId);
    const tmpFile = metaFile + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpFile, metaFile);
  }

  private seedLabels() {
    const defaults: InsertLabel[] = [
      { name: "Work", color: "#1a73e8" },
      { name: "Personal", color: "#16a765" },
      { name: "Finance", color: "#f5a623" },
      { name: "Travel", color: "#a142f4" },
      { name: "Updates", color: "#e37400" },
      { name: "Social", color: "#e91e63" },
      { name: "Promotions", color: "#4caf50" },
    ];
    for (const l of defaults) {
      const id = randomUUID();
      this.labels.set(id, { ...l, id });
    }
  }

  getAttachmentsDir(): string {
    return userAttachmentsDir(this.userId);
  }

  hasMessageId(messageId: string): boolean {
    if (!messageId) return false;
    if (this.deletedMessageIds.has(messageId)) return true;
    for (const idx of this.emailIndex.values()) {
      if (idx.messageId === messageId) return true;
    }
    return false;
  }

  async getEmails(folder?: string): Promise<Email[]> {
    let entries = Array.from(this.emailIndex.values());
    if (folder === "starred") {
      entries = entries.filter(e => e.isStarred && e.folder !== "trash" && e.folder !== "spam");
    } else if (folder === "all") {
      entries = entries.filter(e => e.folder !== "spam" && e.folder !== "trash");
    } else if (folder) {
      entries = entries.filter(e => e.folder === folder);
    }
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries.map(idx => ({
      ...idx,
      body: "",
      labels: idx.labels || [],
    }));
  }

  async getEmailsByLabel(labelId: string): Promise<Email[]> {
    const entries = Array.from(this.emailIndex.values())
      .filter(e => e.labels?.includes(labelId) && e.folder !== "trash" && e.folder !== "spam")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries.map(idx => ({
      ...idx,
      body: "",
      labels: idx.labels || [],
    }));
  }

  async getEmail(id: string): Promise<Email | undefined> {
    return this.readEmailFile(id);
  }

  async createEmail(email: InsertEmail): Promise<Email> {
    const id = randomUUID();
    const newEmail: Email = { ...email, id, labels: email.labels || [] };
    if (email.folder === "sent") {
      this.collectContactsFromRecipients(email.to);
      this.collectContactsFromRecipients(email.cc);
      this.collectContactsFromRecipients(email.bcc);
    }
    this.writeEmailFile(id, newEmail);
    this.emailIndex.set(id, {
      id,
      sender: email.sender,
      to: email.to,
      subject: email.subject,
      snippet: email.snippet,
      date: email.date,
      isUnread: email.isUnread,
      isStarred: email.isStarred,
      folder: email.folder,
      labels: email.labels,
      hasAttachments: !!(email.attachments && email.attachments.length > 0),
      accountEmail: email.accountEmail,
      trashedAt: email.trashedAt,
      spammedAt: email.spammedAt,
      messageId: email.messageId,
      sendStatus: email.sendStatus,
      sendError: email.sendError,
    });
    return newEmail;
  }

  async updateEmail(id: string, updates: Partial<Email>): Promise<Email | undefined> {
    const email = this.readEmailFile(id);
    if (!email) return undefined;
    const updated = { ...email, ...updates, id };
    this.writeEmailFile(id, updated);
    const idx = this.emailIndex.get(id);
    if (idx) {
      if (updates.sender) idx.sender = updates.sender;
      if (updates.to) idx.to = updates.to;
      if (updates.subject !== undefined) idx.subject = updates.subject;
      if (updates.snippet !== undefined) idx.snippet = updates.snippet;
      if (updates.date !== undefined) idx.date = updates.date;
      if (updates.isUnread !== undefined) idx.isUnread = updates.isUnread;
      if (updates.isStarred !== undefined) idx.isStarred = updates.isStarred;
      if (updates.folder !== undefined) idx.folder = updates.folder;
      if (updates.labels !== undefined) idx.labels = updates.labels;
      if (updates.attachments !== undefined) idx.hasAttachments = updates.attachments.length > 0;
      if (updates.accountEmail !== undefined) idx.accountEmail = updates.accountEmail;
      if (updates.trashedAt !== undefined) idx.trashedAt = updates.trashedAt;
      if (updates.spammedAt !== undefined) idx.spammedAt = updates.spammedAt;
      if (updates.sendStatus !== undefined) idx.sendStatus = updates.sendStatus;
      if (updates.sendError !== undefined) idx.sendError = updates.sendError;
    }
    return updated;
  }

  async deleteEmail(id: string): Promise<boolean> {
    if (!isValidId(id)) return false;
    const idx = this.emailIndex.get(id);
    if (!idx) return false;
    if (idx.messageId) {
      this.deletedMessageIds.add(idx.messageId);
      this.scheduleMetaSave();
    }
    this.emailIndex.delete(id);
    this.deleteEmailFile(id);
    try {
      const attDir = join(userAttachmentsDir(this.userId), id);
      if (existsSync(attDir)) rmSync(attDir, { recursive: true });
    } catch {}
    return true;
  }

  async moveEmail(id: string, folder: string): Promise<Email | undefined> {
    const now = new Date().toISOString();
    const updates: Partial<Email> = { folder };
    if (folder === "trash") {
      updates.trashedAt = now;
      updates.spammedAt = undefined;
    } else if (folder === "spam") {
      updates.spammedAt = now;
      updates.trashedAt = undefined;
    } else {
      updates.trashedAt = undefined;
      updates.spammedAt = undefined;
    }
    return this.updateEmail(id, updates);
  }

  async toggleStar(id: string): Promise<Email | undefined> {
    const idx = this.emailIndex.get(id);
    if (!idx) return undefined;
    return this.updateEmail(id, { isStarred: !idx.isStarred });
  }

  async markRead(id: string, isUnread: boolean): Promise<Email | undefined> {
    return this.updateEmail(id, { isUnread });
  }

  async bulkUpdateEmails(ids: string[], updates: Partial<Email>): Promise<number> {
    const validIds: string[] = [];
    for (const id of ids) {
      const idx = this.emailIndex.get(id);
      if (!idx) continue;
      // Update in-memory index immediately
      if (updates.isUnread !== undefined) idx.isUnread = updates.isUnread;
      if (updates.isStarred !== undefined) idx.isStarred = updates.isStarred;
      if (updates.folder !== undefined) idx.folder = updates.folder;
      if (updates.labels !== undefined) idx.labels = updates.labels;
      if (updates.trashedAt !== undefined) idx.trashedAt = updates.trashedAt;
      if (updates.spammedAt !== undefined) idx.spammedAt = updates.spammedAt;
      validIds.push(id);
    }
    // Write files to disk in background after index is updated
    setImmediate(() => {
      for (const id of validIds) {
        try {
          const email = this.readEmailFile(id);
          if (email) this.writeEmailFile(id, { ...email, ...updates, id });
        } catch {}
      }
    });
    return validIds.length;
  }

  async bulkDeleteEmails(ids: string[]): Promise<{ trashed: number; deleted: number }> {
    const toTrash: string[] = [];
    const toDelete: string[] = [];
    // Classify using in-memory index — zero file reads
    for (const id of ids) {
      const idx = this.emailIndex.get(id);
      if (!idx) continue;
      if (idx.folder === "trash") toDelete.push(id);
      else toTrash.push(id);
    }
    const trashedAt = new Date().toISOString();
    // Update in-memory index immediately for trash moves
    for (const id of toTrash) {
      const idx = this.emailIndex.get(id);
      if (idx) { idx.folder = "trash"; idx.trashedAt = trashedAt; }
    }
    // Remove from index immediately for permanent deletes
    for (const id of toDelete) {
      const idx = this.emailIndex.get(id);
      if (idx?.messageId) this.deletedMessageIds.add(idx.messageId);
      this.emailIndex.delete(id);
    }
    // Flush to disk in background — response is already on its way
    setImmediate(() => {
      for (const id of toTrash) {
        try {
          const email = this.readEmailFile(id);
          if (email) this.writeEmailFile(id, { ...email, folder: "trash", trashedAt });
        } catch {}
      }
      for (const id of toDelete) {
        this.deleteEmailFile(id);
        try {
          const attDir = join(userAttachmentsDir(this.userId), id);
          if (existsSync(attDir)) rmSync(attDir, { recursive: true });
        } catch {}
      }
      this.scheduleMetaSave();
    });
    return { trashed: toTrash.length, deleted: toDelete.length };
  }

  getUnreadCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const idx of this.emailIndex.values()) {
      if (!idx.isUnread) continue;
      const folder = idx.folder || "inbox";
      counts[folder] = (counts[folder] || 0) + 1;
      if (idx.labels) {
        for (const labelId of idx.labels) {
          const key = `label:${labelId}`;
          counts[key] = (counts[key] || 0) + 1;
        }
      }
      if (idx.accountEmail) {
        const key = `account:${idx.accountEmail}`;
        counts[key] = (counts[key] || 0) + 1;
      }
    }
    return counts;
  }

  async addLabel(emailId: string, labelId: string): Promise<Email | undefined> {
    const email = this.readEmailFile(emailId);
    if (!email) return undefined;
    const labels = [...(email.labels || [])];
    if (!labels.includes(labelId)) labels.push(labelId);
    return this.updateEmail(emailId, { labels });
  }

  async removeLabel(emailId: string, labelId: string): Promise<Email | undefined> {
    const email = this.readEmailFile(emailId);
    if (!email) return undefined;
    const labels = (email.labels || []).filter(l => l !== labelId);
    return this.updateEmail(emailId, { labels });
  }

  async searchEmails(opts: {
    query: string;
    folder?: string;
    label?: string;
    account?: string;
    excludeTrash?: boolean;
    hasAttachment?: boolean;
    unreadOnly?: boolean;
    starredOnly?: boolean;
    dateRange?: string;
    searchBody?: boolean;
  }): Promise<Email[]> {
    const { folder, label, account, excludeTrash, hasAttachment, unreadOnly, starredOnly, dateRange, searchBody } = opts;

    // Parse keyword operators out of the query
    let rawQuery = opts.query;
    let fromFilter = "";
    let subjectFilter = "";
    rawQuery = rawQuery.replace(/\bfrom:(\S+)/gi, (_, v) => { fromFilter = v.toLowerCase(); return ""; });
    rawQuery = rawQuery.replace(/\bsubject:(\S+)/gi, (_, v) => { subjectFilter = v.toLowerCase(); return ""; });
    if (/\bhas:attachment\b/i.test(rawQuery)) {
      rawQuery = rawQuery.replace(/\bhas:attachment\b/gi, "").trim();
    }
    const q = rawQuery.trim().toLowerCase();

    // Date range cutoff
    let fromDate: Date | null = null;
    if (dateRange) {
      fromDate = new Date();
      if (dateRange === "7d") fromDate.setDate(fromDate.getDate() - 7);
      else if (dateRange === "30d") fromDate.setDate(fromDate.getDate() - 30);
      else if (dateRange === "90d") fromDate.setDate(fromDate.getDate() - 90);
      else if (dateRange === "1y") fromDate.setFullYear(fromDate.getFullYear() - 1);
    }

    const matching: Email[] = [];
    for (const idx of Array.from(this.emailIndex.values())) {
      // Scope filters
      if (excludeTrash && idx.folder === "trash") continue;
      if (folder && idx.folder !== folder) continue;
      if (label && !(idx.labels || []).includes(label)) continue;
      if (account && idx.accountEmail !== account) continue;

      // Attribute filters
      if (hasAttachment && !idx.hasAttachments) continue;
      if (unreadOnly && !idx.isUnread) continue;
      if (starredOnly && !idx.isStarred) continue;
      if (fromDate && new Date(idx.date) < fromDate) continue;
      if (fromFilter && !idx.sender.email.toLowerCase().includes(fromFilter) && !idx.sender.name.toLowerCase().includes(fromFilter)) continue;
      if (subjectFilter && !idx.subject.toLowerCase().includes(subjectFilter)) continue;

      // Text query match
      if (q) {
        const inSubject = idx.subject.toLowerCase().includes(q);
        const inSender = idx.sender.name.toLowerCase().includes(q) || idx.sender.email.toLowerCase().includes(q);
        const inSnippet = idx.snippet.toLowerCase().includes(q);
        const inAccount = idx.accountEmail ? idx.accountEmail.toLowerCase().includes(q) : false;
        let matched = inSubject || inSender || inSnippet || inAccount;

        if (!matched && searchBody) {
          const full = this.readEmailFile(idx.id);
          if (full) {
            const bodyText = (full.body || "").replace(/<[^>]+>/g, " ").toLowerCase();
            matched = bodyText.includes(q);
          }
        }

        if (!matched) continue;
      }

      matching.push({ ...idx, body: "", labels: idx.labels || [] });
    }
    matching.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return matching;
  }

  async getEmailsByAccount(accountEmail: string): Promise<Email[]> {
    const entries = Array.from(this.emailIndex.values())
      .filter(e => e.accountEmail === accountEmail && e.folder !== "trash" && e.folder !== "spam")
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries.map(idx => ({
      ...idx,
      body: "",
      labels: idx.labels || [],
    }));
  }

  async getLabels(): Promise<EmailLabel[]> {
    return Array.from(this.labels.values());
  }

  async getLabel(id: string): Promise<EmailLabel | undefined> {
    return this.labels.get(id);
  }

  async getLabelByName(name: string): Promise<EmailLabel | undefined> {
    return Array.from(this.labels.values()).find(l => l.name === name);
  }

  async createLabel(label: InsertLabel): Promise<EmailLabel> {
    const id = randomUUID();
    const newLabel: EmailLabel = { ...label, id };
    this.labels.set(id, newLabel);
    this.scheduleMetaSave();
    return newLabel;
  }

  async updateLabel(id: string, updates: Partial<EmailLabel>): Promise<EmailLabel | undefined> {
    const label = this.labels.get(id);
    if (!label) return undefined;
    const updated = { ...label, ...updates, id };
    this.labels.set(id, updated);
    this.scheduleMetaSave();
    return updated;
  }

  async deleteLabel(id: string): Promise<boolean> {
    const result = this.labels.delete(id);
    if (result) this.scheduleMetaSave();
    return result;
  }

  private decryptAccountPasswords(account: MailAccount): MailAccount {
    return {
      ...account,
      password: account.password ? decryptString(account.password) : account.password,
      smtpPassword: account.smtpPassword ? decryptString(account.smtpPassword) : account.smtpPassword,
    };
  }

  async getAccounts(): Promise<MailAccount[]> {
    return Array.from(this.accounts.values()).map(a => this.decryptAccountPasswords(a));
  }

  async getAccount(id: string): Promise<MailAccount | undefined> {
    const account = this.accounts.get(id);
    if (!account) return undefined;
    return this.decryptAccountPasswords(account);
  }

  async createAccount(account: InsertMailAccount): Promise<MailAccount> {
    const id = randomUUID();
    const newAccount: MailAccount = {
      ...account,
      id,
      password: account.password ? encryptString(account.password) : account.password,
      smtpPassword: account.smtpPassword ? encryptString(account.smtpPassword) : account.smtpPassword,
      lastFetched: null,
      autoFetchEnabled: account.autoFetchEnabled ?? true,
      autoFetchInterval: account.autoFetchInterval ?? 30,
    };
    this.accounts.set(id, newAccount);
    this.scheduleMetaSave();
    return this.decryptAccountPasswords(newAccount);
  }

  async updateAccount(id: string, updates: Partial<MailAccount>): Promise<MailAccount | undefined> {
    const account = this.accounts.get(id);
    if (!account) return undefined;
    const encryptedUpdates = { ...updates };
    if (encryptedUpdates.password) {
      encryptedUpdates.password = encryptString(encryptedUpdates.password);
    }
    if (encryptedUpdates.smtpPassword) {
      encryptedUpdates.smtpPassword = encryptString(encryptedUpdates.smtpPassword);
    }
    const updated = { ...account, ...encryptedUpdates, id };
    this.accounts.set(id, updated);
    this.scheduleMetaSave();
    return this.decryptAccountPasswords(updated);
  }

  async deleteAccount(id: string): Promise<boolean> {
    const result = this.accounts.delete(id);
    if (result) this.scheduleMetaSave();
    return result;
  }

  async getSettings(): Promise<GeneralSettings> {
    return { ...this.settings };
  }

  async updateSettings(updates: Partial<GeneralSettings>): Promise<GeneralSettings> {
    this.settings = { ...this.settings, ...updates };
    this.scheduleMetaSave();
    return { ...this.settings };
  }

  getBackupConfig(): BackupConfig | null {
    return this.backupConfig ? { ...this.backupConfig } : null;
  }

  async updateBackupConfig(config: BackupConfig): Promise<BackupConfig> {
    if (config.s3?.secretAccessKey && !isEncrypted(config.s3.secretAccessKey)) config.s3.secretAccessKey = encryptString(config.s3.secretAccessKey);
    if (config.azure?.connectionString && !isEncrypted(config.azure.connectionString)) config.azure.connectionString = encryptString(config.azure.connectionString);
    if (config.gcp?.keyJson && !isEncrypted(config.gcp.keyJson)) config.gcp.keyJson = encryptString(config.gcp.keyJson);
    this.backupConfig = config;
    this.scheduleMetaSave();
    return { ...this.backupConfig };
  }

  getDecryptedBackupConfig(): BackupConfig | null {
    if (!this.backupConfig) return null;
    const config = JSON.parse(JSON.stringify(this.backupConfig)) as BackupConfig;
    if (config.s3?.secretAccessKey && isEncrypted(config.s3.secretAccessKey)) {
      config.s3.secretAccessKey = decryptString(config.s3.secretAccessKey);
    }
    if (config.azure?.connectionString && isEncrypted(config.azure.connectionString)) {
      config.azure.connectionString = decryptString(config.azure.connectionString);
    }
    if (config.gcp?.keyJson && isEncrypted(config.gcp.keyJson)) {
      config.gcp.keyJson = decryptString(config.gcp.keyJson);
    }
    return config;
  }

  getUserId(): string {
    return this.userId;
  }

  getContacts(): { name: string; email: string }[] {
    return Array.from(this.contacts.values());
  }

  addContact(name: string, email: string): void {
    const key = email.toLowerCase();
    const existing = this.contacts.get(key);
    if (!existing || (name && name !== email && (!existing.name || existing.name === existing.email))) {
      this.contacts.set(key, { name: name || email, email });
      this.scheduleMetaSave();
    }
  }

  searchContacts(query: string): { name: string; email: string }[] {
    if (!query) return this.getContacts();
    const q = query.toLowerCase();
    return Array.from(this.contacts.values()).filter(
      c => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
    );
  }

  private collectContactsFromRecipients(recipients: { name: string; email: string }[] | undefined): void {
    if (!recipients) return;
    for (const r of recipients) {
      this.addContact(r.name, r.email);
    }
  }

  async getCustomFolders(): Promise<CustomFolder[]> {
    return Array.from(this.customFolders.values());
  }

  async createCustomFolder(folder: InsertCustomFolder): Promise<CustomFolder> {
    const id = randomUUID();
    const newFolder: CustomFolder = { ...folder, id };
    this.customFolders.set(id, newFolder);
    this.scheduleMetaSave();
    return newFolder;
  }

  async updateCustomFolder(id: string, updates: Partial<CustomFolder>): Promise<CustomFolder | undefined> {
    const folder = this.customFolders.get(id);
    if (!folder) return undefined;
    const updated = { ...folder, ...updates, id };
    this.customFolders.set(id, updated);
    this.scheduleMetaSave();
    return updated;
  }

  async deleteCustomFolder(id: string): Promise<boolean> {
    const result = this.customFolders.delete(id);
    if (result) this.scheduleMetaSave();
    return result;
  }

  async getEmailRules(): Promise<EmailRule[]> {
    return Array.from(this.emailRules.values());
  }

  async createEmailRule(rule: InsertEmailRule): Promise<EmailRule> {
    const id = randomUUID();
    const newRule: EmailRule = { ...rule, id };
    this.emailRules.set(id, newRule);
    this.scheduleMetaSave();
    return newRule;
  }

  async updateEmailRule(id: string, updates: Partial<EmailRule>): Promise<EmailRule | undefined> {
    const rule = this.emailRules.get(id);
    if (!rule) return undefined;
    const updated = { ...rule, ...updates, id };
    this.emailRules.set(id, updated);
    this.scheduleMetaSave();
    return updated;
  }

  async deleteEmailRule(id: string): Promise<boolean> {
    const result = this.emailRules.delete(id);
    if (result) this.scheduleMetaSave();
    return result;
  }

  applyRulesToEmail(email: Email): Email {
    const rules = Array.from(this.emailRules.values()).filter(r => r.enabled);
    for (const rule of rules) {
      const matches = rule.conditionLogic === "all"
        ? rule.conditions.every(c => this.matchCondition(email, c))
        : rule.conditions.some(c => this.matchCondition(email, c));
      if (matches) {
        if (rule.action === "move" && rule.targetFolder) {
          email = { ...email, folder: rule.targetFolder };
        } else if (rule.action === "label" && rule.targetLabel) {
          const labels = email.labels || [];
          if (!labels.includes(rule.targetLabel)) {
            email = { ...email, labels: [...labels, rule.targetLabel] };
          }
        } else if (rule.action === "star") {
          email = { ...email, isStarred: true };
        } else if (rule.action === "markRead") {
          email = { ...email, isUnread: false };
        }
      }
    }
    return email;
  }

  private matchCondition(email: Email, condition: { field: string; match: string; value: string }): boolean {
    let fieldValue = "";
    if (condition.field === "from") {
      fieldValue = `${email.sender.name} ${email.sender.email}`.toLowerCase();
    } else if (condition.field === "subject") {
      fieldValue = (email.subject || "").toLowerCase();
    } else if (condition.field === "to") {
      fieldValue = (email.to || []).map(t => `${t.name} ${t.email}`).join(" ").toLowerCase();
    }
    const val = condition.value.toLowerCase();
    switch (condition.match) {
      case "contains": return fieldValue.includes(val);
      case "equals": return fieldValue === val;
      case "startsWith": return fieldValue.startsWith(val);
      case "endsWith": return fieldValue.endsWith(val);
      default: return false;
    }
  }

  async applyRulesToAllEmails(): Promise<{ matched: number; total: number }> {
    const rules = Array.from(this.emailRules.values()).filter(r => r.enabled);
    if (rules.length === 0) return { matched: 0, total: 0 };

    let matched = 0;
    const total = this.emailIndex.size;

    for (const idx of Array.from(this.emailIndex.values())) {
      const fakeEmail: Email = {
        id: idx.id,
        sender: idx.sender,
        to: idx.to || [],
        subject: idx.subject,
        snippet: idx.snippet,
        body: "",
        date: idx.date,
        isUnread: idx.isUnread,
        isStarred: idx.isStarred,
        folder: idx.folder,
        labels: idx.labels || [],
        accountEmail: idx.accountEmail,
      };

      const result = this.applyRulesToEmail(fakeEmail);

      let changed = false;
      if (result.folder !== idx.folder) { idx.folder = result.folder; changed = true; }
      if (result.isStarred !== idx.isStarred) { idx.isStarred = result.isStarred; changed = true; }
      if (result.isUnread !== idx.isUnread) { idx.isUnread = result.isUnread; changed = true; }
      if (JSON.stringify(result.labels || []) !== JSON.stringify(idx.labels || [])) { idx.labels = result.labels; changed = true; }

      if (changed) {
        matched++;
        const full = this.readEmailFile(idx.id);
        if (full) {
          full.folder = idx.folder;
          full.isStarred = idx.isStarred;
          full.isUnread = idx.isUnread;
          full.labels = idx.labels;
          this.writeEmailFile(idx.id, full);
        }
      }
    }

    return { matched, total };
  }

  async purgeExpiredTrash(): Promise<number> {
    const retentionMs = (this.settings.trashRetentionDays || 30) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let purged = 0;
    for (const idx of Array.from(this.emailIndex.values())) {
      if (idx.folder === "trash" && idx.trashedAt) {
        const trashedTime = new Date(idx.trashedAt).getTime();
        if (now - trashedTime > retentionMs) {
          await this.deleteEmail(idx.id);
          purged++;
        }
      }
    }
    return purged;
  }

  async purgeExpiredSpam(): Promise<number> {
    const retentionMs = (this.settings.spamRetentionDays || 30) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let purged = 0;
    for (const idx of Array.from(this.emailIndex.values())) {
      if (idx.folder === "spam" && idx.spammedAt) {
        const spammedTime = new Date(idx.spammedAt).getTime();
        if (now - spammedTime > retentionMs) {
          await this.deleteEmail(idx.id);
          purged++;
        }
      }
    }
    return purged;
  }
}

export class GlobalStorage {
  private users: Map<string, User>;
  private userStorages: Map<string, UserStorage>;

  constructor() {
    this.users = new Map();
    this.userStorages = new Map();
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    if (existsSync(USERS_FILE)) {
      try {
        const raw = readFileSync(USERS_FILE, "utf-8");
        const data: UsersData = JSON.parse(raw);
        for (const [id, user] of Object.entries(data.users || {})) {
          this.users.set(id, user);
        }
      } catch (err) {
        console.error("Failed to load users file:", err);
      }
    }

    this.migrateOldData();
    this.seedAdminFromEnv();

    console.log(`Global: ${this.users.size} users loaded`);
  }

  private migrateOldData() {
    const oldMetaFile = join(DATA_DIR, "storage.json");
    const oldEmailsDir = join(DATA_DIR, "emails");
    if (!existsSync(oldMetaFile) && !existsSync(oldEmailsDir)) return;

    if (this.users.size > 0) return;

    console.log("Migrating legacy single-user data to multi-user format...");

    const userId = randomUUID();
    const user: User = {
      id: userId,
      username: "admin",
      password: hashPassword("admin"),
      displayName: "Admin",
      isAdmin: true,
    };
    this.users.set(userId, user);
    this.persistUsers();

    const uDir = userDir(userId);
    const uEmailsDir = userEmailsDir(userId);
    const uAttDir = join(uDir, "attachments");
    mkdirSync(uEmailsDir, { recursive: true });

    if (existsSync(oldMetaFile)) {
      try {
        const raw = readFileSync(oldMetaFile, "utf-8");
        const data = JSON.parse(raw);
        const newMeta: UserMeta = {
          accounts: data.accounts || {},
          labels: data.labels || {},
          settings: data.settings,
        };
        writeFileSync(userMetaFile(userId), JSON.stringify(newMeta, null, 2), "utf-8");
      } catch {}
      try { unlinkSync(oldMetaFile); } catch {}
    }

    if (existsSync(oldEmailsDir)) {
      try {
        const files = readdirSync(oldEmailsDir).filter(f => f.endsWith(".json"));
        for (const file of files) {
          const src = join(oldEmailsDir, file);
          const dst = join(uEmailsDir, file);
          writeFileSync(dst, readFileSync(src));
          unlinkSync(src);
        }
        rmSync(oldEmailsDir, { recursive: true, force: true });
      } catch {}
    }

    const oldAttDir = join(DATA_DIR, "attachments");
    if (existsSync(oldAttDir)) {
      try {
        mkdirSync(uAttDir, { recursive: true });
        const dirs = readdirSync(oldAttDir);
        for (const d of dirs) {
          const srcDir = join(oldAttDir, d);
          const dstDir = join(uAttDir, d);
          mkdirSync(dstDir, { recursive: true });
          const files = readdirSync(srcDir);
          for (const file of files) {
            writeFileSync(join(dstDir, file), readFileSync(join(srcDir, file)));
          }
        }
        rmSync(oldAttDir, { recursive: true, force: true });
      } catch {}
    }

    console.log(`Migration complete. Created user 'admin' (password: admin). Please change your password.`);
  }

  private seedAdminFromEnv() {
    if (this.users.size > 0) return;

    const envUser = process.env.ADMIN_USERNAME;
    const envPass = process.env.ADMIN_PASSWORD;
    if (!envUser || !envPass) return;

    console.log(`Creating admin account from environment variables (ADMIN_USERNAME="${envUser}")...`);
    const userId = crypto.randomUUID();
    const user: User = {
      id: userId,
      username: envUser,
      password: hashPassword(envPass),
      displayName: envUser,
      isAdmin: true,
    };
    this.users.set(userId, user);
    this.persistUsers();
    new UserStorage(userId);
    console.log(`Admin account "${envUser}" created successfully.`);
  }

  private persistUsers() {
    const data: UsersData = {
      users: Object.fromEntries(this.users),
    };
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const tmpFile = USERS_FILE + ".tmp";
    writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf-8");
    renameSync(tmpFile, USERS_FILE);
  }

  hasUsers(): boolean {
    return this.users.size > 0;
  }

  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const isFirstUser = this.users.size === 0;
    const user: User = {
      ...insertUser,
      id,
      password: hashPassword(insertUser.password),
      isAdmin: insertUser.isAdmin ?? isFirstUser,
    };
    this.users.set(id, user);
    this.persistUsers();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return Array.from(this.users.values());
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    user.password = hashedPassword;
    this.users.set(userId, user);
    this.persistUsers();
    return true;
  }

  async resetUserPassword(userId: string, newPassword: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    user.password = hashPassword(newPassword);
    this.users.set(userId, user);
    this.persistUsers();
    return true;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const existed = this.users.has(userId);
    if (existed) {
      this.users.delete(userId);
      this.userStorages.delete(userId);
      this.persistUsers();
    }
    return existed;
  }

  getUserStorage(userId: string): UserStorage {
    if (!isValidId(userId)) throw new Error("Invalid user ID");
    let storage = this.userStorages.get(userId);
    if (!storage) {
      storage = new UserStorage(userId);
      this.userStorages.set(userId, storage);
    }
    return storage;
  }

  getAllActiveStorages(): UserStorage[] {
    return Array.from(this.userStorages.values());
  }
}

export const globalStorage = new GlobalStorage();
