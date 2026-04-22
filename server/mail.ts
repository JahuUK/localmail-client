import type { MailAccount, InsertEmail, EmailAttachment } from "@shared/schema";
import nodemailer from "nodemailer";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

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

export async function fetchPop3Emails(account: MailAccount): Promise<ParsedEmailResult[]> {
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

    for (const msg of messages.slice(-20)) {
      try {
        const msgNum = Number(Array.isArray(msg) ? msg[0] : msg);
        const raw: unknown = await pop3.RETR(msgNum);
        // RFC 2822 requires CRLF line endings; join with \r\n if lines were split.
        // Pass as Buffer so mailparser handles charset detection itself.
        const rawSource: Buffer = Buffer.isBuffer(raw)
          ? raw
          : Array.isArray(raw)
            ? Buffer.from((raw as string[]).join("\r\n"))
            : Buffer.from(String(raw));

        const parsed = await parseRawEmail(rawSource);
        if (parsed) results.push(parsed);

        if (account.deleteOnFetch) {
          try { await (pop3 as any).DELE(msgNum); } catch {}
        }
      } catch {
        continue;
      }
    }
  } finally {
    try { await pop3.QUIT(); } catch {}
  }

  return results;
}

export async function fetchImapEmails(account: MailAccount): Promise<ParsedEmailResult[]> {
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

export async function fetchEmails(account: MailAccount): Promise<ParsedEmailResult[]> {
  const protocol = account.protocol || "pop3";
  if (protocol === "imap") {
    return fetchImapEmails(account);
  }
  return fetchPop3Emails(account);
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
  const { simpleParser } = await import("mailparser") as any;
  // Pass the raw source directly — never pre-convert to a UTF-8 string, as that
  // corrupts bytes > 127 in headers or 8-bit body parts and breaks MIME parsing.
  const parsed = await (simpleParser as any)(rawSource) as any;

  const senderAddress = parsed.from?.value?.[0];
  const toAddresses: any[] = parsed.to
    ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((t: any) => t.value)
    : [];

  const body = parsed.text || parsed.html?.replace(/<[^>]+>/g, "") || "";
  const bodyHtml = parsed.html || undefined;

  const rawAttachments: ParsedAttachment[] = [];
  const attachmentMeta: EmailAttachment[] = [];

  // Debug: log every MIME part mailparser found so we can trace missing attachments
  if (parsed.attachments) {
    for (const a of parsed.attachments) {
      console.log(
        `[parseRawEmail] MIME part: type="${a.contentType}" filename="${a.filename ?? ""}" ` +
        `cid="${a.cid ?? ""}" size=${a.size ?? 0} content=${a.content ? `Buffer(${(a.content as Buffer).length})` : "null"}`
      );
    }
  }

  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      // Guard: skip parts with no decoded content to avoid crashes
      if (!att.content) continue;

      const contentType: string = att.contentType || "application/octet-stream";

      // Recursively extract attachments from forwarded/nested emails
      // (e.g. when Outlook uses "Forward as Attachment" → message/rfc822 MIME part)
      if (contentType.startsWith("message/rfc822")) {
        try {
          const nested = await parseRawEmail(att.content as Buffer);
          if (nested) {
            for (const nestedAtt of nested.rawAttachments) {
              rawAttachments.push(nestedAtt);
              attachmentMeta.push({
                id: nestedAtt.id,
                filename: nestedAtt.filename,
                contentType: nestedAtt.contentType,
                size: nestedAtt.size,
                ...(nestedAtt.cid ? { cid: nestedAtt.cid } : {}),
              });
            }
          }
        } catch {}
        // Don't surface the raw .eml wrapper as a visible attachment
        continue;
      }

      const id = randomUUID();
      const filename = att.filename || "attachment";
      const size = att.size || (att.content as Buffer).length;
      const cid = att.cid || undefined;

      rawAttachments.push({ id, filename, contentType, size, cid, content: att.content as Buffer });
      attachmentMeta.push({ id, filename, contentType, size, ...(cid ? { cid } : {}) });
    }
  }

  const msgId = parsed.messageId || undefined;
  const unsub = parseListUnsubscribeHeaders(parsed.headers);

  return {
    email: {
      sender: {
        name: senderAddress?.name || senderAddress?.address || "Unknown",
        email: senderAddress?.address || "",
      },
      to: toAddresses.map((a: any) => ({
        name: a.name || a.address || "",
        email: a.address || "",
      })),
      subject: parsed.subject || "(no subject)",
      snippet: body.substring(0, 150).replace(/\n/g, " "),
      body,
      bodyHtml,
      date: (parsed.date || new Date()).toISOString(),
      isUnread: true,
      isStarred: false,
      folder: "inbox",
      attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
      messageId: msgId,
      ...(unsub.url ? { listUnsubscribeUrl: unsub.url } : {}),
      ...(unsub.mail ? { listUnsubscribeMail: unsub.mail } : {}),
      ...(unsub.oneClick ? { listUnsubscribeOneClick: true } : {}),
    },
    rawAttachments,
  };
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
