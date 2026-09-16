/* A single Durable Object that wakes itself every minute with a storage alarm and runs the
   notification check. Alarms are persisted and retried by Cloudflare, so this keeps ticking
   without relying on Cron Triggers. The cron (if it fires) only makes sure the alarm exists. */
import { DurableObject } from 'cloudflare:workers';
import { runDue } from './index.js';

const EVERY_MS = 60 * 1000;

export class Ticker extends DurableObject {
  async ensure() {
    const at = await this.ctx.storage.getAlarm();
    // missing, or stuck far in the past/future: re-arm for the next minute boundary
    if (at === null || at < Date.now() - 5 * EVERY_MS || at > Date.now() + 5 * EVERY_MS) {
      await this.ctx.storage.setAlarm(nextMinute(Date.now()));
      return { armed: true };
    }
    return { armed: false, next: at };
  }

  async alarm() {
    const now = Date.now();
    // schedule the next tick first, so a failure below can never stop the clock
    await this.ctx.storage.setAlarm(nextMinute(now));
    let status;
    try {
      const r = await runDue(this.env, now);
      status = Object.assign({ at: now, ok: true, via: 'alarm' }, r);
    } catch (err) {
      status = { at: now, ok: false, via: 'alarm', error: String(err && err.message || err).slice(0, 300) };
      console.error('tick failed', err && err.stack || err);
    }
    try {
      await this.env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind('last_run', JSON.stringify(status)).run();
    } catch (e) { /* best-effort */ }
  }
}

function nextMinute(ms) {
  return Math.floor(ms / EVERY_MS) * EVERY_MS + EVERY_MS + 1000;   // 1s past the next whole minute
}
