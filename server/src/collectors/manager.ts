import type { DbPool } from '../db/pool';

export type CollectorState = 'connecting' | 'open' | 'degraded' | 'closed' | 'disabled';

export type CollectorStatusRow = {
  source: string;
  state: CollectorState;
  last_msg_ts: string | null;
  msg_rate_1m: number | null;
  last_error: string | null;
  updated_at: string;
};

type Internal = {
  source: string;
  state: CollectorState;
  lastMsgAt: number | null;
  lastError: string | null;
  msgCountWindow: number[]; // timestamps in ms (rolling 60s)
  updatedAt: number;
};

export class CollectorManager {
  private items = new Map<string, Internal>();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private pool: DbPool) {}

  ensure(source: string, initialState: CollectorState = 'disabled') {
    if (this.items.has(source)) return;
    this.items.set(source, {
      source,
      state: initialState,
      lastMsgAt: null,
      lastError: null,
      msgCountWindow: [],
      updatedAt: Date.now(),
    });
  }

  setState(source: string, state: CollectorState) {
    this.ensure(source);
    const it = this.items.get(source)!;
    it.state = state;
    it.updatedAt = Date.now();
  }

  markMessage(source: string) {
    this.ensure(source);
    const it = this.items.get(source)!;
    const now = Date.now();
    it.lastMsgAt = now;
    it.msgCountWindow.push(now);
    it.updatedAt = now;
    // prune > 60s
    const cutoff = now - 60_000;
    while (it.msgCountWindow.length && it.msgCountWindow[0]! < cutoff) it.msgCountWindow.shift();
  }

  setError(source: string, err: unknown) {
    this.ensure(source);
    const it = this.items.get(source)!;
    it.lastError = String((err as any)?.message ?? err);
    it.state = 'degraded';
    it.updatedAt = Date.now();
  }

  snapshot(): CollectorStatusRow[] {
    const now = Date.now();
    return [...this.items.values()]
      .sort((a, b) => a.source.localeCompare(b.source))
      .map((it) => {
        const cutoff = now - 60_000;
        const n = it.msgCountWindow.filter((t) => t >= cutoff).length;
        const rate = n; // per 60s
        return {
          source: it.source,
          state: it.state,
          last_msg_ts: it.lastMsgAt ? new Date(it.lastMsgAt).toISOString() : null,
          msg_rate_1m: Number.isFinite(rate) ? rate : null,
          last_error: it.lastError,
          updated_at: new Date(it.updatedAt).toISOString(),
        };
      });
  }

  startFlush(intervalMs = 1000) {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => void this.flushOnce(), intervalMs);
  }

  stopFlush() {
    if (!this.flushTimer) return;
    clearInterval(this.flushTimer);
    this.flushTimer = null;
  }

  async flushOnce() {
    const rows = this.snapshot();
    if (!rows.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const r of rows) {
        await client.query(
          `insert into collector_status (source, state, last_msg_ts, msg_rate_1m, last_error, updated_at)
           values ($1,$2,$3,$4,$5, now())
           on conflict (source) do update set
             state=excluded.state,
             last_msg_ts=excluded.last_msg_ts,
             msg_rate_1m=excluded.msg_rate_1m,
             last_error=excluded.last_error,
             updated_at=now()`,
          [r.source, r.state, r.last_msg_ts, r.msg_rate_1m, r.last_error],
        );
      }
      await client.query('commit');
    } catch {
      await client.query('rollback');
    } finally {
      client.release();
    }
  }
}

