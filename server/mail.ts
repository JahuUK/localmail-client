import type { MailAccount, InsertEmail, EmailAttachment } from "@shared/schema";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { parseEmailInWorker } from "./workerPool.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
  content: Buffer;
}

export interface ParsedEmailResult {
  email: InsertEmail;
  rawAttachments: ParsedAttachment[];
}

export function saveAttachmentsToDisk(emailId: string, attachments: ParsedAttachment[], baseDir?: string): void {
  if (attachments.length === 0) return;
  if (!UUID_RE.test(emailId)) throw new Error("Invalid email ID");
  const attachmentsDir = baseDir || "data/attachments";
  const dir = join(attachmentsDir, emailId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const att of attachments) {
    const safeName = att.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = join(dir, `${att.id}_${safeName}`);
    writeFileSync(filePath, att.content);
  }
}

export function getAttachmentPath(emailId: string, attachmentId: string, filename: string, baseDir?: string): string | null {
  if (!UUID_RE.test(emailId) || !UUID_RE.test(attachmentId)) return null;
  const attachmentsDir = baseDir || "data/attachments";
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = join(attachmentsDir, emailId, `${attachmentId}_${safeName}`);
  if (existsSync(filePath)) return filePath;
  const dir = join(attachmentsDir, emailId);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir, { encoding: "utf-8" });
  const match = files.find(f => f.startsWith(attachmentId + "_"));
  return match ? join(dir, match) : null;
}

export async function testIncomingConnection(config: {
  protocol: string;
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}): Promise<{ success: boolean; message: string }> {
  const protocol = config.protocol || "pop3";

  if (protocol === "imap") {
    return testImapConnection(config);
  }
  return testPop3Connection(config);
}

async function testPop3Connection(config: {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}): Promise<{ success: boolean; message: string }> {
  const Pop3 = (await import("node-pop3")).default;

  const pop3 = new Pop3({
    host: config.host,
    port: config.port,
    tls: config.tls,
    user: config.username,
    password: config.password,
    timeout: 60000,
  });

  try {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Connection timed out after 60s — check hostname, port, and TLS settings`)), 60000)
    );
    const connectPromise = (async () => {
      const list = await pop3.LIST();
      const count = Array.isArray(list) ? list.length : 0;
      await pop3.QUIT();
      return { success: true, message: `POP3 connection successful. ${count} message(s) on server.` };
    })();
    return await Promise.race([connectPromise, timeoutPromise]);
  } catch (err: any) {
    try { await pop3.QUIT(); } catch {}
    return { success: false, message: `POP3 connection failed: ${err.message}` };
  }
}

async function testImapConnection(config: {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}): Promise<{ success: boolean; message: string }> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: {
      user: config.username,
      pass: config.password,
    },
    logger: false,
  });

  try {
    await client.connect();
    const status = await client.status("INBOX", { messages: true });
    const count = status.messages || 0;
    await client.logout();
    return { success: true, message: `IMAP connection successful. ${count} message(s) in INBOX.` };
  } catch (err: any) {
    try { await client.logout(); } catch {}
    return { success: false, message: `IMAP connection failed: ${err.message}` };
  }
}

export async function testSmtpConnection(config: {
  host: string;
  port: number;
  username: string;
  password: string;
  tls: boolean;
}): Promise<{ success: boolean; message: string }> {
  try {
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.tls,
      auth: {
        user: config.username,
        pass: config.password,
      },
    });

    await transporter.verify();
    return { success: true, message: "SMTP connection successful. Ready to send mail." };
  } catch (err: any) {
    return { success: false, message: `SMTP connection failed: ${err.message}` };
  }
}

// In-memory cache of POP3 UIDs already downloaded per account (resets on restart;
// the messageId dedup in the route handler catches any that slip through after restart).
const seenPop3Uids = new Map<string, Set<string>>();

export async function fetchPop3Emails(account: MailAccount, knownIds?: Set<string>): Promise<ParsedEmailResult[]> {
  const Pop3 = (await import("node-pop3")).default;

  const pop3 = new Pop3({
    host: account.host,
    port: account.port,
    tls: account.tls,
    user: account.username,
    password: account.password,
  });

  const results: ParsedEmailResult[] = [];
  const seen = seenPop3Uids.get(account.id) ?? new Set<string>();

  try {
    // Use UIDL to get server-assigned unique IDs so we only download genuinely
    // new messages rather than re-fetching the same 20 every cycle.
    let newMsgNums: number[] = [];
    try {
      const uidl = await (pop3 as any).UIDL() as [string, string][];
      const allEntries = Array.isArray(uidl) ? uidl : [];
      // Only process the most recent 50; ignore ancient ones beyond that window.
      const window = allEntries.slice(-50);
      newMsgNums = window
        .filter(([, uid]) => !seen.has(uid))
        .map(([num]) => Number(num));
      // Mark all windowed UIDs as seen whether or not we download them,
      // so re-appearing duplicates are skipped on the next cycle.
      window.forEach(([, uid]) => seen.add(uid));
    } catch {
      // UIDL not supported — fall back to last 20 messages (original behaviour).
      const list = await pop3.LIST();
      const messages = Array.isArray(list) ? list : [];
      newMsgNums = messages.slice(-20).map(msg => Number(Array.isArray(msg) ? msg[0] : msg));
    }

    for (const msgNum of newMsgNums) {
      try {
        const raw: unknown = await pop3.RETR(msgNum);
        const rawSource: Buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.from((raw as string[]).join("\r\n"))
            : Buffer.from(String(raw));

        const parsed = await parseRawEmail(rawSource);
        if (!parsed) continue;
        // Skip if already known by RFC 2822 Message-ID (e.g. after a restart).
        if (parsed.email.messageId && knownIds?.has(parsed.email.messageId)) continue;
        results.push(parsed);

        if (account.deleteOnFetch) {
          try { await (pop3 as any).DELE(msgNum); } catch {}
        }
      } catch {
        continue;
      }
    }
  } finally {
    seenPop3Uids.set(account.id, seen);
    try { await pop3.QUIT(); } catch {}
  }

  return results;
}

export async function fetchImapEmails(account: MailAccount, knownIds?: Set<string>): Promise<ParsedEmailResult[]> {
  const { ImapFlow } = await import("imapflow");

  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.tls,
    auth: {
      user: account.username,
      pass: account.password,
    },
    logger: false,
  });

  const results: ParsedEmailResult[] = [];

  try {
    await client.connect();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const status = await client.status("INBOX", { messages: true });
      const totalMessages = status.messages || 0;
      if (totalMessages === 0) return results;

      const startSeq = Math.max(1, totalMessages - 19);
      const range = `${startSeq}:*`;

      if (knownIds && knownIds.size > 0) {
        // Two-pass: fetch envelopes first (lightweight) to find which messages
        // are genuinely new, then download full source only for those.
        const newSeqNos: number[] = [];
        for await (const msg of client.fetch(range, { envelope: true })) {
          const msgId = msg.envelope?.messageId;
          if (msgId && knownIds.has(msgId)) continue;
          newSeqNos.push(msg.seq);
        }
        if (newSeqNos.length === 0) return results;

        for await (const message of client.fetch(newSeqNos.join(","), {
          envelope: true,
          source: true,
        })) {
          try {
            const source = message.source;
            if (!source?.length) continue;
            const parsed = await parseRawEmail(source);
            if (parsed) results.push(parsed);
          } catch {
            continue;
          }
        }
      } else {
        // No known IDs yet (first run) — download everything in the window.
        for await (const message of client.fetch(range, {
          envelope: true,
          source: true,
        })) {
          try {
            const source = message.source;
            // Pass the Buffer directly — converting to a string first can corrupt
            // bytes > 127 in headers / 8-bit body parts and break MIME parsing.
            if (!source?.length) continue;
            const parsed = await parseRawEmail(source);
            if (parsed) results.push(parsed);
          } catch {
            continue;
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch {}
  }

  return results;
}

/**
 * Targeted repair fetch — bypasses the normal 20-message window entirely.
 *
 * IMAP: issues a SEARCH HEADER Message-ID for each target ID so only those
 *       specific messages are retrieved, regardless of their position in the
 *       mailbox.
 * POP3: downloads *all* messages present on the server and returns only those
 *       whose parsed Message-ID is in the target set.
 */
export async function fetchEmailsByMessageIds(
  account: MailAccount,
  messageIds: string[],
): Promise<ParsedEmailResult[]> {
  if (messageIds.length === 0) return [];
  const protocol = (account.protocol || "pop3").toLowerCase();
  if (protocol === "imap") {
    return repairFetchImap(account, messageIds);
  }
  return repairFetchPop3(account, new Set(messageIds));
}

async function repairFetchImap(
  account: MailAccount,
  messageIds: string[],
): Promise<ParsedEmailResult[]> {
  const { ImapFlow } = await import("imapflow");
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.tls,
    auth: { user: account.username, pass: account.password },
    logger: false,
  });

  const results: ParsedEmailResult[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      for (const msgId of messageIds) {
        try {
          // Ask the server to find this exact message — works no matter how old it is
          const seqNos: number[] = await (client as any).search(
            { header: { "Message-ID": msgId } },
          );
          if (!seqNos || seqNos.length === 0) continue;

          for await (const message of client.fetch(seqNos.join(","), {
            envelope: true,
            source: true,
          })) {
            try {
              const source = message.source;
              if (!source?.length) continue;
              const parsed = await parseRawEmail(source);
              if (parsed) results.push(parsed);
            } catch { continue; }
          }
        } catch { continue; }
      }
    } finally {
      lock.release();
    }
  } finally {
    try { await client.logout(); } catch {}
  }
  return results;
}

async function repairFetchPop3(
  account: MailAccount,
  targetIds: Set<string>,
): Promise<ParsedEmailResult[]> {
  const Pop3 = (await import("node-pop3")).default;
  const pop3 = new Pop3({
    host: account.host,
    port: account.port,
    tls: account.tls,
    user: account.username,
    password: account.password,
  });

  const results: ParsedEmailResult[] = [];
  try {
    const list = await pop3.LIST();
    const messages = Array.isArray(list) ? list : [];

    // Scan ALL messages on the server — no slice limit
    for (const msg of messages) {
      try {
        const msgNum = Number(Array.isArray(msg) ? msg[0] : msg);
        const raw: unknown = await pop3.RETR(msgNum);
        const rawSource: Buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.from((raw as string[]).join("\r\n"))
            : Buffer.from(String(raw));

        const parsed = await parseRawEmail(rawSource);
        if (parsed?.email.messageId && targetIds.has(parsed.email.messageId)) {
          results.push(parsed);
        }
      } catch { continue; }
    }
  } finally {
    try { await pop3.QUIT(); } catch {}
  }
  return results;
}

export async function fetchEmails(account: MailAccount, knownIds?: Set<string>): Promise<ParsedEmailResult[]> {
  const protocol = account.protocol || "pop3";
  if (protocol === "imap") {
    return fetchImapEmails(account, knownIds);
  }
  return fetchPop3Emails(account, knownIds);
}

function parseListUnsubscribeHeaders(headers: any): {
  url?: string;
  mail?: string;
  oneClick?: boolean;
} {
  const result: { url?: string; mail?: string; oneClick?: boolean } = {};
  try {
    const listUnsub: string = headers?.get?.("list-unsubscribe") || "";
    const listUnsubPost: string = headers?.get?.("list-unsubscribe-post") || "";
    if (listUnsub) {
      const parts = listUnsub.split(",").map((p: string) => p.trim());
      for (const part of parts) {
        const match = part.match(/^<(.+)>$/);
        if (!match) continue;
        const value = match[1];
        if ((value.startsWith("https://") || value.startsWith("http://")) && !result.url) {
          result.url = value;
        } else if (value.startsWith("mailto:") && !result.mail) {
          result.mail = value.slice(7);
        }
      }
    }
    if (listUnsubPost && listUnsubPost.toLowerCase().includes("list-unsubscribe=one-click")) {
      result.oneClick = true;
    }
  } catch {}
  return result;
}

async function parseRawEmail(rawSource: string | Buffer): Promise<ParsedEmailResult | null> {
  try {
    const buffer = Buffer.isBuffer(rawSource) ? rawSource : Buffer.from(rawSource as string);
    const result = await parseEmailInWorker(buffer);
    return {
      email: result.email as unknown as InsertEmail,
      rawAttachments: result.rawAttachments.map(att => ({
        id: att.id,
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        ...(att.cid ? { cid: att.cid } : {}),
        content: Buffer.from(att.content),
      })),
    };
  } catch (err: any) {
    console.error("[parseRawEmail] worker failed:", err.message);
    return null;
  }
}

export async function sendSmtpEmail(
  account: MailAccount,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  bcc?: string,
  options?: { inReplyTo?: string; references?: string; attachments?: { name: string; type: string; dataUrl: string }[] }
): Promise<void> {
  if (!account.smtpHost || !account.smtpPort) {
    throw new Error("SMTP not configured for this account");
  }

  const useSecure = account.smtpTls !== undefined ? account.smtpTls : account.smtpPort === 465;

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: useSecure,
    auth: {
      user: account.username,
      pass: account.password,
    },
  });

  const isHtml = /<[a-z][\s\S]*>/i.test(body);
  const headers: Record<string, string> = {};
  if (options?.inReplyTo) headers["In-Reply-To"] = options.inReplyTo;
  if (options?.references) headers["References"] = options.references;

  const mailAttachments = (options?.attachments || []).map(att => {
    const matches = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      return {
        filename: att.name,
        content: Buffer.from(matches[2], "base64"),
        contentType: att.type,
      };
    }
    return { filename: att.name, content: Buffer.from(""), contentType: att.type };
  });

  await transporter.sendMail({
    from: account.email,
    to,
    cc: cc || undefined,
    bcc: bcc || undefined,
    subject,
    headers,
    ...(isHtml ? { html: body, text: body.replace(/<[^>]+>/g, "") } : { text: body }),
    ...(mailAttachments.length > 0 ? { attachments: mailAttachments } : {}),
  });
}
