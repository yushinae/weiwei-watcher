import type { DbPool } from '../db/pool';
import { fetchBybitOptionInstruments } from '../exchange/bybit/http';
import { fetchDeribitInstruments } from '../exchange/deribit/http';

export type InstrumentMeta = {
  exchange: 'bybit' | 'deribit';
  symbol: string;
  base: string;
  quote: string;
  expiryTs: string; // ISO
  strike: number;
  optionType: 'C' | 'P';
};

export class InstrumentRegistry {
  private map = new Map<string, InstrumentMeta>(); // exchange:symbol -> meta

  constructor(private pool: DbPool) {}

  get(exchange: string, symbol: string) {
    return this.map.get(`${exchange}:${symbol}`) ?? null;
  }

  async bootstrapBybit(baseCoins: string[]) {
    for (const base of baseCoins) {
      const list = await fetchBybitOptionInstruments(base);
      const metas: InstrumentMeta[] = list
        .filter((x) => x.symbol && x.deliveryTime && x.strike)
        .map((x) => {
          const expiryMs = Number(x.deliveryTime);
          const expiry = new Date(expiryMs).toISOString();
          const optionType = String(x.optionsType).toLowerCase().includes('put') ? 'P' : 'C';
          return {
            exchange: 'bybit',
            symbol: x.symbol,
            base: x.baseCoin,
            quote: x.quoteCoin,
            expiryTs: expiry,
            strike: Number(x.strike),
            optionType,
          };
        });
      await this.upsertMany(metas);
    }
  }

  async bootstrapDeribit(currencies: string[]) {
    for (const c of currencies) {
      const list = await fetchDeribitInstruments(c);
      const metas: InstrumentMeta[] = list
        .filter((x) => x.instrument_name && x.expiration_timestamp && x.strike)
        .map((x) => {
          const expiry = new Date(Number(x.expiration_timestamp)).toISOString();
          const optionType = String(x.option_type).toLowerCase().includes('put') ? 'P' : 'C';
          return {
            exchange: 'deribit',
            symbol: x.instrument_name,
            base: x.currency,
            quote: 'USD',
            expiryTs: expiry,
            strike: Number(x.strike),
            optionType,
          };
        });
      await this.upsertMany(metas);
    }
  }

  private async upsertMany(items: InstrumentMeta[]) {
    if (!items.length) return;
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const it of items) {
        this.map.set(`${it.exchange}:${it.symbol}`, it);
        await client.query(
          `insert into instruments (exchange, symbol, base, quote, expiry_ts, strike, option_type, status)
           values ($1,$2,$3,$4,$5,$6,$7,'trading')
           on conflict (exchange, symbol) do update set
             base=excluded.base,
             quote=excluded.quote,
             expiry_ts=excluded.expiry_ts,
             strike=excluded.strike,
             option_type=excluded.option_type,
             updated_at=now()`,
          [it.exchange, it.symbol, it.base, it.quote, it.expiryTs, it.strike, it.optionType],
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

