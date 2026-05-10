import type { MailAccount } from "@shared/schema";
import { sendSmtpEmail } from "./mail.js";
import { addLog } from "./logger.js";

type Attachment = { name: string; type: string; dataUrl: string };

interface QueueItem {
  userId: string;
  account: MailAccount;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  options?: { inReplyTo?: string; references?: string; attachments?: Attachment[] };
  attempts: number;
  nextRetryAt: number;
  onSuccess: () => void;
  onError: (err: Error) => void;
}

// Retry delays: 1 min → 5 min → 15 min — give up after 3 retries
const RETRY_DELAYS = [60_000, 300_000, 900_000];
const MAX_RETRIES = RETRY_DELAYS.length;

const queue = new Map<string, QueueItem>();

setInterval(async () => {
  const now = Date.now();
  for (const [id, item] of queue) {
    if (item.nextRetryAt > now) continue;
    // Bump nextRetryAt to prevent concurrent attempts while this one runs
    item.nextRetryAt = now + 3_600_000;

    const attemptNum = item.attempts + 1;
    addLog(item.userId, "info", "Send queue",
      `Retry ${item.attempts}/${MAX_RETRIES} for email to ${item.to} (subject: "${item.subject}")`);

    try {
      await sendSmtpEmail(
        item.account, item.to, item.subject, item.body,
        item.cc, item.bcc, item.options,
      );
      addLog(item.userId, "success", "Send queue",
        `Retry ${item.attempts}/${MAX_RETRIES} succeeded — email delivered to ${item.to}`);
      item.onSuccess();
      queue.delete(id);
    } catch (err: any) {
      item.attempts++;
      if (item.attempts >= MAX_RETRIES) {
        addLog(item.userId, "error", "Send queue",
          `All ${MAX_RETRIES} retries exhausted for email to ${item.to}: ${err.message} — giving up`);
        item.onError(new Error(`Send failed after ${MAX_RETRIES} retries: ${err.message}`));
        queue.delete(id);
      } else {
        const delayMs = RETRY_DELAYS[item.attempts] ?? RETRY_DELAYS[RETRY_DELAYS.length - 1];
        const delaySec = delayMs / 1000;
        item.nextRetryAt = now + delayMs;
        addLog(item.userId, "warn", "Send queue",
          `Retry ${item.attempts - 1}/${MAX_RETRIES} failed for ${item.to}: ${err.message} — next attempt in ${delaySec}s`);
      }
    }
  }
}, 30_000).unref();

/**
 * Enqueue a failed send for automatic retry with exponential back-off.
 * The initial send attempt is NOT made here — this is called only after
 * the first attempt has already failed.
 */
export function enqueueSend(
  userId: string,
  account: MailAccount,
  to: string,
  subject: string,
  body: string,
  cc: string | undefined,
  bcc: string | undefined,
  options: { inReplyTo?: string; references?: string; attachments?: Attachment[] } | undefined,
  onSuccess: () => void,
  onError: (err: Error) => void,
): void {
  const id = `${account.id}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const firstDelaySec = RETRY_DELAYS[0] / 1000;
  queue.set(id, {
    userId, account, to, subject, body, cc, bcc, options,
    attempts: 1,
    nextRetryAt: Date.now() + RETRY_DELAYS[0],
    onSuccess,
    onError,
  });
  addLog(userId, "warn", "Send queue",
    `Initial send failed — queued email to ${to} (subject: "${subject}") for retry; ` +
    `attempt 1/${MAX_RETRIES} in ${firstDelaySec}s`);
}
