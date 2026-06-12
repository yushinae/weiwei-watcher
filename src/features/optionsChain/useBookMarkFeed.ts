import { useEffect, useMemo } from 'react';
import { fetchOptionChain } from './bybitTickers';
import { BYBIT_OPTION_WS } from './bybitOptionWs';
import { fetchDeribitChainOptions } from '../../registry/data/deribit';
import { DERIBIT_WS, WS_FLUSH_MS } from '../../registry/data/ws';
import { shouldRunFeedKey, subscribeRuntimePolicy } from '../../registry/data/runtimePolicy';
import type { SimPosition } from './simBook';

const REST_FALLBACK_MS = 45_000;

const parseSymbol = (symbol: string) => {
  const m = /^(BTC|ETH)-(\d{1,2}[A-Z]{3}\d{4})-([0-9.]+)-(C|P)$/.exec(symbol);
  if (!m) return null;
  return {
    coin: m[1] as 'BTC' | 'ETH',
    expiryCompact: m[2],
    strike: Number(m[3]),
    type: m[4] as 'C' | 'P',
  };
};

const compactDeribitExpiry = (label: string) => {
  const m = /^(\d{1,2}) ([A-Z]{3}) (\d{4})$/.exec(label);
  return m ? `${m[1]}${m[2]}${m[3]}` : label.replace(/\s+/g, '').toUpperCase();
};

const compactBybitExpiry = (label: string) => {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(label);
  return m ? `${m[1]}${m[2]}20${m[3]}` : label.replace(/\s+/g, '').toUpperCase();
};

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : v as number;
  return Number.isFinite(n) ? n : null;
};

const isDeribitInstrument = (instrument?: string) =>
  instrument?.startsWith('BTC-') ||
  instrument?.startsWith('ETH-') ||
  instrument?.startsWith('BTC_USDC-') ||
  instrument?.startsWith('ETH_USDC-');

const isDeribitLinearUsdc = (instrument?: string) =>
  instrument?.startsWith('BTC_USDC-') || instrument?.startsWith('ETH_USDC-');

const normalizeBybitMark = (d: Record<string, unknown>): number | null => {
  const mark = num(d.markPrice);
  return mark != null && mark > 0 ? mark : null;
};

const normalizeDeribitMark = (d: Record<string, unknown>, instrument?: string): number | null => {
  const mark = num(d.mark_price);
  if (mark == null || mark <= 0) return null;
  const fwd = num(d.underlying_price) ?? num(d.index_price);
  return !isDeribitLinearUsdc(instrument ?? d.instrument_name as string | undefined) && fwd != null && fwd > 0
    ? mark * fwd
    : mark;
};

type RestTarget = {
  coin: 'BTC' | 'ETH';
  expiryCompact: string;
  strike: number;
  type: 'C' | 'P';
  symbol: string;
  source: 'bybit' | 'deribit';
  universe: 'inverse' | 'linear-usdc';
};

function restKey(t: RestTarget): string {
  return `${t.coin}|${t.expiryCompact}|${t.strike}|${t.type}|${t.symbol}|${t.source}|${t.universe}`;
}

function parseRestKey(key: string): RestTarget | null {
  const [coin, expiryCompact, strikeRaw, type, symbol, source, universe] = key.split('|');
  if ((coin !== 'BTC' && coin !== 'ETH') || (type !== 'C' && type !== 'P')) return null;
  if (source !== 'bybit' && source !== 'deribit') return null;
  return {
    coin,
    expiryCompact,
    strike: Number(strikeRaw),
    type,
    symbol,
    source,
    universe: universe === 'linear-usdc' ? 'linear-usdc' : 'inverse',
  };
}

export function useBookMarkFeed(
  positions: SimPosition[],
  updateMarks: (marks: Record<string, number>) => void,
): void {
  const targets = useMemo(() => {
    const bybitWs = new Map<string, string>();
    const deribitWs = new Map<string, string>();
    const rest = new Map<string, RestTarget>();

    for (const p of positions) {
      const parsed = parseSymbol(p.symbol);
      if (!parsed) continue;

      const source = p.source ?? (isDeribitInstrument(p.instrument) ? 'deribit' : 'bybit');
      const universe = isDeribitLinearUsdc(p.instrument) ? 'linear-usdc' : 'inverse';
      const target: RestTarget = { ...parsed, symbol: p.symbol, source, universe };
      rest.set(restKey(target), target);

      if (!p.instrument) continue;
      if (source === 'deribit') deribitWs.set(p.instrument, p.symbol);
      else bybitWs.set(p.instrument, p.symbol);
    }

    return {
      bybitWs: [...bybitWs.entries()].map(([instrument, symbol]) => ({ instrument, symbol })),
      deribitWs: [...deribitWs.entries()].map(([instrument, symbol]) => ({ instrument, symbol })),
      rest: [...rest.values()],
    };
  }, [positions]);
  const targetSig = [
    targets.bybitWs.map(t => `${t.instrument}|${t.symbol}`).join(';'),
    targets.deribitWs.map(t => `${t.instrument}|${t.symbol}`).join(';'),
    targets.rest.map(restKey).join(';'),
  ].join('#');

  useEffect(() => {
    if (targets.bybitWs.length === 0 && targets.deribitWs.length === 0 && targets.rest.length === 0) return;
    let alive = true;
    const buf: Record<string, number> = {};
    let dirty = false;
    let unsubs: Array<() => void> = [];
    const feedKey = `option-book-marks-${targetSig}`;
    const shouldRun = () => shouldRunFeedKey(feedKey, { mode: 'visible-live' });

    const putMark = (symbol: string, mark: number | null) => {
      if (mark == null || mark <= 0) return;
      buf[symbol] = mark;
      dirty = true;
    };

    const subscribe = () => {
      if (unsubs.length > 0) return;
      unsubs = [
        ...targets.bybitWs.map(({ instrument, symbol }) =>
          BYBIT_OPTION_WS.subscribe<Record<string, unknown>>(`tickers.${instrument}`, d => putMark(symbol, normalizeBybitMark(d))),
        ),
        ...targets.deribitWs.map(({ instrument, symbol }) =>
          DERIBIT_WS.subscribe<Record<string, unknown>>(`ticker.${instrument}.100ms`, d => putMark(symbol, normalizeDeribitMark(d, instrument))),
        ),
      ];
    };
    const unsubscribe = () => { unsubs.forEach(u => u()); unsubs = []; };
    const applyPolicy = () => { if (shouldRun()) subscribe(); else unsubscribe(); };

    const flush = () => {
      if (!alive || !dirty) return;
      dirty = false;
      updateMarks({ ...buf });
    };
    const flushId = setInterval(flush, WS_FLUSH_MS);

    const poll = async () => {
      if (!shouldRun()) return;
      const marks: Record<string, number> = {};

      const bybitByCoin = new Map<'BTC' | 'ETH', RestTarget[]>();
      for (const t of targets.rest) {
        if (t.source !== 'bybit') continue;
        bybitByCoin.set(t.coin, [...(bybitByCoin.get(t.coin) ?? []), t]);
      }
      await Promise.all([...bybitByCoin.entries()].map(async ([coin, items]) => {
        const data = await fetchOptionChain(coin).catch(() => null);
        if (!data) return;
        for (const item of items) {
          const exp = data.expiries.find(e => compactBybitExpiry(e.label) === item.expiryCompact);
          const opt = (item.type === 'C' ? exp?.calls : exp?.puts)?.find(o => o.strike === item.strike);
          if (opt && opt.markPrice > 0) marks[item.symbol] = opt.markPrice;
        }
      }));

      const deribitByGroup = new Map<string, RestTarget[]>();
      for (const t of targets.rest) {
        if (t.source !== 'deribit') continue;
        const groupKey = `${t.coin}|${t.universe}`;
        deribitByGroup.set(groupKey, [...(deribitByGroup.get(groupKey) ?? []), t]);
      }
      await Promise.all([...deribitByGroup.entries()].map(async ([groupKey, items]) => {
        const [coinRaw, universeRaw] = groupKey.split('|');
        const coin = coinRaw as 'BTC' | 'ETH';
        const universe = universeRaw === 'linear-usdc' ? 'linear-usdc' : 'inverse';
        const data = await fetchDeribitChainOptions(coin, universe).catch(() => null);
        if (!data) return;
        for (const item of items) {
          const exp = data.expiries.find(e => compactDeribitExpiry(e.label) === item.expiryCompact);
          const opt = (item.type === 'C' ? exp?.calls : exp?.puts)?.find(o => o.strike === item.strike);
          if (opt && opt.mark > 0) marks[item.symbol] = opt.mark;
        }
      }));

      if (alive && Object.keys(marks).length > 0) {
        Object.assign(buf, marks);
        dirty = true;
        flush();
      }
    };

    applyPolicy();
    const unsubscribePolicy = subscribeRuntimePolicy(applyPolicy);
    void poll();
    const pollId = setInterval(() => { if (shouldRun()) void poll(); }, REST_FALLBACK_MS);

    return () => {
      alive = false;
      unsubscribe();
      unsubscribePolicy();
      clearInterval(flushId);
      clearInterval(pollId);
    };
  }, [targetSig, updateMarks]); // eslint-disable-line react-hooks/exhaustive-deps
}

export const __bookMarkFeedTest = {
  normalizeBybitMark,
  normalizeDeribitMark,
  parseRestKey,
  restKey,
};
