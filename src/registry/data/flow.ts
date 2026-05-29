import { useState, useEffect } from 'react';
import type { Coin } from '../../features/monitor/types';
import { subscribeData } from './poller';

export interface FundingPoint { ts: number; rate: number; }

export interface BasisPoint { label: string; daysToExp: number; annBasis: number; spot: number; futurePx: number; }

export interface FearGreedPoint { value: number; label: string; ts: number; }

export interface FlowData {
  fundingHistory: FundingPoint[];
  currentFunding8h: number;
  annFunding: number;
  basis: BasisPoint[];
  fearGreed: FearGreedPoint[];
  currentFG: number;
  currentFGLabel: string;
  fetchedAt: number;
}

export const FLOW_CACHE = new Map<string, { data: FlowData; ts: number }>();
export const FLOW_TTL = 300_000;

export const MONTH_MAP_FUTURES: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

export function parseFuturesExpiry(instrName: string): number | null {
  const parts = instrName.split('-');
  if (parts.length < 2 || parts[1] === 'PERPETUAL') return null;
  const s = parts[1];
  const day = parseInt(s.slice(0, 2));
  const mon = MONTH_MAP_FUTURES[s.slice(2, 5)];
  const yr = 2000 + parseInt(s.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  const exp = new Date(Date.UTC(yr, mon, day, 8, 0, 0));
  return (exp.getTime() - Date.now()) / 86_400_000;
}

export async function fetchFlowData(currency: 'BTC' | 'ETH'): Promise<FlowData> {
  const cached = FLOW_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < FLOW_TTL) return cached.data;

  const now = Date.now();
  const perp = `${currency}-PERPETUAL`;
  const d90ago = now - 90 * 86_400_000;

  const [fundingResp, futuresResp, fgResp] = await Promise.allSettled([
    fetch(`https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${perp}&start_timestamp=${d90ago}&end_timestamp=${now}&count=270`),
    fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=future`),
    fetch('https://api.alternative.me/fng/?limit=30'),
  ]);

  let fundingHistory: FundingPoint[] = [];
  let currentFunding8h = 0;
  let annFunding = 0;
  if (fundingResp.status === 'fulfilled') {
    const json = await fundingResp.value.json().catch(() => null);
    const raw: Array<{ timestamp: number; interest_8h: number }> = json?.result ?? [];
    fundingHistory = raw.map(r => ({ ts: r.timestamp, rate: r.interest_8h * 100 }));
    if (fundingHistory.length) {
      currentFunding8h = fundingHistory[fundingHistory.length - 1].rate;
      annFunding = currentFunding8h * 3 * 365;
    }
  }

  let basis: BasisPoint[] = [];
  if (futuresResp.status === 'fulfilled') {
    const json = await futuresResp.value.json().catch(() => null);
    const raw: any[] = json?.result ?? [];
    basis = raw
      .map((item: any) => {
        const days = parseFuturesExpiry(item.instrument_name);
        if (days === null || days < 1) return null;
        const futurePx: number = item.mark_price ?? 0;
        const spot: number = item.underlying_price ?? futurePx;
        if (!futurePx || !spot) return null;
        const annBasis = ((futurePx / spot - 1) * (365 / days)) * 100;
        return {
          label: item.instrument_name.split('-').slice(1).join('-'),
          daysToExp: Math.round(days),
          annBasis,
          spot,
          futurePx,
        } as BasisPoint;
      })
      .filter((b): b is BasisPoint => b !== null)
      .sort((a, b) => a.daysToExp - b.daysToExp)
      .slice(0, 6);
  }

  let fearGreed: FearGreedPoint[] = [];
  let currentFG = 50;
  let currentFGLabel = 'Neutral';
  if (fgResp.status === 'fulfilled') {
    const json = await fgResp.value.json().catch(() => null);
    const raw: Array<{ value: string; value_classification: string; timestamp: string }> = json?.data ?? [];
    fearGreed = raw
      .map(d => ({ value: parseInt(d.value), label: d.value_classification, ts: parseInt(d.timestamp) * 1000 }))
      .reverse();
    if (fearGreed.length) {
      currentFG = fearGreed[fearGreed.length - 1].value;
      currentFGLabel = fearGreed[fearGreed.length - 1].label;
    }
  }

  const data: FlowData = {
    fundingHistory, currentFunding8h, annFunding,
    basis, fearGreed, currentFG, currentFGLabel, fetchedAt: now,
  };
  FLOW_CACHE.set(currency, { data, ts: now });
  return data;
}

export function useFlowData(coin: Coin) {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const currency = coin === 'BTC' ? 'BTC' : 'ETH';

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<FlowData>(
      `flow-${currency}`,
      () => fetchFlowData(currency),
      FLOW_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, [currency]);

  return { data, loading };
}

export function useFearGreed() {
  const [data, setData] = useState<FlowData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<FlowData>(
      'flow-BTC',
      () => fetchFlowData('BTC'),
      FLOW_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, []);
  return { data, loading };
}
