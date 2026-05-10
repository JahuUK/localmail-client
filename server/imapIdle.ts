import type { MailAccount } from "@shared/schema";
import { addLog } from "./logger.js";

export type IdleNewMailCallback = (accountId: string, userId: string) => void;

interface IdleSession {
  stop: () => void;
}

const sessions = new Map<string, IdleSession>();

/**
 * Opens a persistent IMAP IDLE connection for the given account.
 * When the server signals new mail (EXISTS > prevCount), calls onNewMail.
 * Reconnects automatically on error with a 60-second back-off.
 * Safe to call multiple times — silently ignores duplicates.
 */
export function startImapIdleSession(
  account: Pick<MailAccount, "id" | "host" | "port" | "tls" | "username" | "password">,
  userId: string,
  onNewMail: IdleNewMailCallback,
): void {
  const key = `${userId}:${account.id}`;
  if (sessions.has(key)) return;

  let stopped = false;
  let currentClient: any = null;
  let attemptCount = 0;

  const run = async () => {
    while (!stopped) {
      attemptCount++;
      try {
        addLog(userId, "info", "IMAP IDLE",
          `Connecting to ${account.host}:${account.port} as ${account.username}` +
          (attemptCount > 1 ? ` (attempt ${attemptCount})` : ""));

        const { ImapFlow } = await import("imapflow");
        const client = new ImapFlow({
          host: account.host,
          port: account.port,
          secure: account.tls,
          auth: { user: account.username, pass: account.password },
          logger: false,
          connectionTimeout: 20_000,
          greetingTimeout: 10_000,
        });
        currentClient = client;

        // Attach an error listener BEFORE connect() so that low-level socket
        // errors (ETIMEOUT, ECONNRESET, etc.) don't become unhandled 'error'
        // events that crash the Node.js process. The try/catch handles reconnection.
        client.on("error", (err: Error) => {
          addLog(userId, "warn", "IMAP IDLE",
            `Socket error for ${account.username}: ${err.message}`);
        });

        await client.connect();
        addLog(userId, "info", "IMAP IDLE",
          `Connected to ${account.host} as ${account.username} — listening for new mail`);
        attemptCount = 0; // reset counter on successful connect

        const lock = await client.getMailboxLock("INBOX");
        client.on("exists", ({ count, prevCount }: { count: number; prevCount: number }) => {
          if (count > prevCount) {
            const newCount = count - prevCount;
            addLog(userId, "info", "IMAP IDLE",
              `New mail push received for ${account.username}: ${newCount} new message(s) (${prevCount} → ${count}) — triggering fetch`);
            onNewMail(account.id, userId);
          }
        });

        addLog(userId, "info", "IMAP IDLE",
          `INBOX selected for ${account.username} — IDLE loop active`);

        try {
          while (!stopped) {
            // idle() blocks until the server pushes an unsolicited response or the
            // ~28-minute IMAP keepalive fires — then we re-enter idle immediately.
            await client.idle();
            if (stopped) break;
            await new Promise(r => setTimeout(r, 300));
          }
        } finally {
          lock.release();
        }

        try { await client.logout(); } catch {}

        if (!stopped) {
          addLog(userId, "info", "IMAP IDLE",
            `IDLE loop exited cleanly for ${account.username} — re-entering`);
        }
      } catch (err: any) {
        if (!stopped) {
          addLog(userId, "warn", "IMAP IDLE",
            `Connection lost for ${account.username}: ${err.message} — reconnecting in 60s`);
          await new Promise(r => setTimeout(r, 60_000));
        }
      }
    }
    addLog(userId, "info", "IMAP IDLE",
      `Session stopped for ${account.username}`);
  };

  sessions.set(key, {
    stop: () => {
      stopped = true;
      try { currentClient?.close?.(); } catch {}
      sessions.delete(key);
    },
  });

  addLog(userId, "info", "IMAP IDLE",
    `Starting persistent IDLE session for ${account.username} (${account.host}:${account.port})`);
  run().catch(() => sessions.delete(key));
}

export function stopImapIdleSession(accountId: string, userId: string): void {
  const key = `${userId}:${accountId}`;
  sessions.get(key)?.stop();
}

export function stopAllImapIdleSessionsForUser(userId: string): void {
  for (const [key, session] of sessions) {
    if (key.startsWith(`${userId}:`)) session.stop();
  }
}
