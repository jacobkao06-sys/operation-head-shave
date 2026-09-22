/**
 * Notification delivery. SPEC.md §7.
 *
 * `EmailNotifier` (Resend) is the only live implementation. `TelegramNotifier`
 * is a stub against the same interface so a push-style ping is a small change,
 * not a refactor. SMS is deliberately out of scope at launch (A2P 10DLC).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { Resend } from "resend";
import { env_ } from "../config";

export interface Notifier {
  send(to: string, subject: string, body: string): Promise<{ id: string }>;
}

export class EmailNotifier implements Notifier {
  private client: Resend | null = null;

  private get resend(): Resend {
    if (!this.client) {
      const key = env_.resendKey();
      if (!key) throw new Error("RESEND_API_KEY is not set");
      this.client = new Resend(key);
    }
    return this.client;
  }

  async send(to: string, subject: string, body: string): Promise<{ id: string }> {
    const res = await this.resend.emails.send({
      from: env_.mailFrom(),
      to,
      subject,
      text: body,
    });
    if (res.error) throw new Error(`Resend refused the send: ${res.error.message}`);
    return { id: res.data?.id ?? "unknown" };
  }
}

/** Stubbed. Wire TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID when a push ping is wanted. */
export class TelegramNotifier implements Notifier {
  async send(_to: string, subject: string, body: string): Promise<{ id: string }> {
    void _to;
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chat = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) throw new Error("TelegramNotifier is not configured");
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: `${subject}\n\n${body}` }),
    });
    if (!res.ok) throw new Error(`Telegram refused the send: ${res.status}`);
    return { id: "telegram" };
  }
}

/** Records instead of sending. Used by DRY_RUN and by tests. */
export class CapturingNotifier implements Notifier {
  readonly sent: { to: string; subject: string; body: string }[] = [];
  async send(to: string, subject: string, body: string): Promise<{ id: string }> {
    this.sent.push({ to, subject, body });
    return { id: `captured-${this.sent.length}` };
  }
}

/**
 * Local development only. Writes each message to .ohs-outbox/ so a dry run is
 * inspectable without a Resend key. Refuses to be selected in production.
 */
export class FileNotifier implements Notifier {
  private dir = path.join(process.cwd(), ".ohs-outbox");

  async send(to: string, subject: string, body: string): Promise<{ id: string }> {
    await fs.mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const slug = subject.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
    const file = path.join(this.dir, `${stamp}_${slug}.txt`);
    await fs.writeFile(file, `To: ${to}\nSubject: ${subject}\n\n${body}\n`);
    return { id: path.basename(file) };
  }
}

/**
 * Picks the delivery channel. Resend whenever a key exists. Without one, the
 * file outbox in development and a hard error in production — silently dropping
 * Andrea's dispatch email would be the worst possible failure mode.
 */
export function defaultNotifier(): Notifier {
  if (env_.resendKey()) return new EmailNotifier();
  if (process.env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is not set — refusing to silently drop mail in production");
  }
  return new FileNotifier();
}
