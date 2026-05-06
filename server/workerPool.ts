import { Worker } from "worker_threads";
import { randomUUID } from "crypto";

export interface WorkerParsedAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
  content: ArrayBuffer;
}

export interface WorkerParseResult {
  email: {
    sender: { name: string; email: string };
    to: Array<{ name: string; email: string }>;
    subject: string;
    snippet: string;
    body: string;
    bodyHtml: string | null;
    date: string;
    isUnread: boolean;
    isStarred: boolean;
    folder: string;
    attachments?: Array<{ id: string; filename: string; contentType: string; size: number; cid?: string }>;
    messageId?: string;
    listUnsubscribeUrl?: string;
    listUnsubscribeMail?: string;
    listUnsubscribeOneClick?: boolean;
  };
  rawAttachments: WorkerParsedAttachment[];
}

// This CJS eval worker runs on a separate OS thread, keeping the main event
// loop (and therefore the HTTP server) fully responsive during email parsing.
// It replicates parseRawEmail + parseListUnsubscribeHeaders from mail.ts so
// all simpleParser CPU work is off the main thread.
const WORKER_CODE = `
const { parentPort } = require('worker_threads');
const { createRequire } = require('module');
const path = require('path');
const { randomUUID } = require('crypto');

const req = createRequire(path.join(process.cwd(), 'package.json'));
const { simpleParser } = req('mailparser');

function parseListUnsubscribe(headers) {
  const result = {};
  try {
    const raw = (headers && typeof headers.get === 'function') ? (headers.get('list-unsubscribe') || '') : '';
    const post = (headers && typeof headers.get === 'function') ? (headers.get('list-unsubscribe-post') || '') : '';
    if (raw) {
      for (const part of raw.split(',').map(p => p.trim())) {
        const m = part.match(/^<(.+)>$/);
        if (!m) continue;
        const v = m[1];
        if ((v.startsWith('https://') || v.startsWith('http://')) && !result.url) result.url = v;
        else if (v.startsWith('mailto:') && !result.mail) result.mail = v.slice(7);
      }
    }
    if (post && post.toLowerCase().includes('list-unsubscribe=one-click')) result.oneClick = true;
  } catch {}
  return result;
}

async function parseEmail(rawBuf) {
  const buf = Buffer.isBuffer(rawBuf) ? rawBuf : Buffer.from(rawBuf);
  const parsed = await simpleParser(buf);
  const senderAddr = parsed.from && parsed.from.value && parsed.from.value[0];
  const toList = parsed.to
    ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap(t => t.value || [])
    : [];
  const bodyText = parsed.text || (parsed.html ? parsed.html.replace(/<[^>]+>/g, '') : '') || '';
  const htmlLower = (parsed.html || '').toLowerCase();
  const rawAtts = [];
  const attMeta = [];
  for (const att of (parsed.attachments || [])) {
    if (!att.content) continue;
    const ct = att.contentType || 'application/octet-stream';
    if (ct.startsWith('message/rfc822')) {
      try {
        const nested = await parseEmail(att.content);
        if (nested) {
          for (const na of nested.rawAttachments) {
            rawAtts.push(na);
            attMeta.push({ id: na.id, filename: na.filename, contentType: na.contentType, size: na.size, ...(na.cid ? { cid: na.cid } : {}) });
          }
        }
      } catch {}
      continue;
    }
    const id = randomUUID();
    const filename = att.filename || 'attachment';
    const size = att.size || att.content.length;
    const rawCid = att.cid;
    let cid;
    if (rawCid) {
      const local = rawCid.split('@')[0].toLowerCase();
      cid = (htmlLower.includes('cid:' + rawCid.toLowerCase()) || htmlLower.includes('cid:' + local)) ? rawCid : undefined;
    }
    rawAtts.push({ id, filename, contentType: ct, size, cid, content: att.content });
    attMeta.push({ id, filename, contentType: ct, size, ...(cid ? { cid } : {}) });
  }
  const unsub = parseListUnsubscribe(parsed.headers);
  return {
    email: {
      sender: { name: (senderAddr && (senderAddr.name || senderAddr.address)) || 'Unknown', email: (senderAddr && senderAddr.address) || '' },
      to: toList.map(a => ({ name: a.name || a.address || '', email: a.address || '' })),
      subject: parsed.subject || '(no subject)',
      snippet: bodyText.substring(0, 150).replace(/\\n/g, ' '),
      body: bodyText,
      bodyHtml: parsed.html || null,
      date: (parsed.date || new Date()).toISOString(),
      isUnread: true,
      isStarred: false,
      folder: 'inbox',
      attachments: attMeta.length > 0 ? attMeta : undefined,
      messageId: parsed.messageId || undefined,
      ...(unsub.url ? { listUnsubscribeUrl: unsub.url } : {}),
      ...(unsub.mail ? { listUnsubscribeMail: unsub.mail } : {}),
      ...(unsub.oneClick ? { listUnsubscribeOneClick: true } : {}),
    },
    rawAttachments: rawAtts,
  };
}

parentPort.on('message', async ({ id, buffer }) => {
  try {
    const result = await parseEmail(buffer);
    const transferList = [];
    const serializedAtts = result.rawAttachments.map(att => {
      // new Uint8Array(...).buffer gives us an owned copy safe to transfer zero-copy
      const ab = new Uint8Array(att.content).buffer;
      transferList.push(ab);
      return { id: att.id, filename: att.filename, contentType: att.contentType, size: att.size, cid: att.cid, content: ab };
    });
    parentPort.postMessage({ id, result: { email: result.email, rawAttachments: serializedAtts } }, transferList);
  } catch (err) {
    parentPort.postMessage({ id, error: err.message });
  }
});
`;

// Shared pending-job map — keyed by unique job ID so any worker can resolve any job.
const pending = new Map<string, {
  resolve: (v: WorkerParseResult) => void;
  reject: (e: Error) => void;
}>();

let _pool: Worker[] | null = null;
let _rr = 0;

function getPool(): Worker[] {
  if (_pool) return _pool;
  _pool = Array.from({ length: 2 }, () => {
    const w = new Worker(WORKER_CODE, { eval: true });
    w.on("message", (msg: { id: string; result?: WorkerParseResult; error?: string }) => {
      const job = pending.get(msg.id);
      if (!job) return;
      pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error));
      else if (msg.result) job.resolve(msg.result);
      else job.reject(new Error("Worker returned empty result"));
    });
    w.on("error", (err) => console.error("[email-worker] crashed:", err.message));
    return w;
  });
  return _pool;
}

/**
 * Parse a raw RFC 2822 email buffer on a worker thread.
 * Returns a fully-structured result; attachment content is zero-copy transferred.
 */
export function parseEmailInWorker(buffer: Buffer): Promise<WorkerParseResult> {
  return new Promise((resolve, reject) => {
    const pool = getPool();
    const id = randomUUID();
    pending.set(id, { resolve, reject });
    const worker = pool[_rr++ % pool.length];
    // new Uint8Array(buffer).buffer copies the data into an owned ArrayBuffer
    // that can be transferred to the worker thread without copying on the wire.
    const ab = new Uint8Array(buffer).buffer;
    worker.postMessage({ id, buffer: ab }, [ab]);
  });
}
