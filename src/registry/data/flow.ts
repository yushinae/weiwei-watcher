import { useState, useEffect, useRef } from 'react';
import type { Coin } from '../../features/monitor/types';
import { subscribeData, _shouldSkip } from './poller';
import { DERIBIT_WS, WS_FLUSH_MS } from './ws';

export interface FundingPoint { ts: number; rate: number; }

export interface BasisPoint { label: string; daysToExp: number; annBasis: number; spot: number; futurePx: number; }

export interface FearGreedPoint { value: number; label: string; ts: number; }

export interface FlowData {
  fundingHistory: FundingPoint[];
  currentFunding8h: number;
  annFunding: number;
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

/** 期货合约到期的绝对时间戳（ms）；PERPETUAL / 无法解析返回 null。 */
export function futuresExpiryMs(instrName: string): number | null {
  const parts = instrName.split('-');
  if (parts.length < 2 || parts[1] === 'PERPETUAL') return null;
  const s = parts[1];
  const day = parseInt(s.slice(0, 2));
  const mon = MONTH_MAP_FUTURES[s.slice(2, 5)];
  const yr = 2000 + parseInt(s.slice(5));
  if (isNaN(day) || mon === undefined || isNaN(yr)) return null;
  return Date.UTC(yr, mon, day, 8, 0, 0);
}

export function parseFuturesExpiry(instrName: string): number | null {
  const ms = futuresExpiryMs(instrName);
  return ms === null ? null : (ms - Date.now()) / 86_400_000;
}

export async function fetchFlowData(currency: 'BTC' | 'ETH'): Promise<FlowData> {
  const cached = FLOW_CACHE.get(currency);
  if (cached && Date.now() - cached.ts < FLOW_TTL) return cached.data;

  const now = Date.now();
  const perp = `${currency}-PERPETUAL`;
  const d90ago = now - 90 * 86_400_000;

  // 期货基差已迁到 WS（useFuturesBasis：逐合约 ticker.{future} 实时算）——这里只拉
  // 真正的「历史/慢变量」：资金费率历史曲线 + Fear&Greed（外部源无 WS）。
  const [fundingResp, fgResp] = await Promise.allSettled([
    fetch(`https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${perp}&start_timestamp=${d90ago}&end_timestamp=${now}&count=270`),
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
    fearGreed, currentFG, currentFGLabel, fetchedAt: now,
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

// ═══════════════════════════════════════════════════════════════════════════════
// 期货基差（实时 WS）
// 期货合约数量少（每币 ~6–13 个），逐合约订阅 ticker.{future}.100ms 即可实时算年化基差，
// 不必再 300s 轮询整张 book_summary。合约清单周级才变 → 一次性 REST 发现 + 播种，
// 之后全靠 WS tick 更新（统一节流到 WS_FLUSH_MS）。共享单条 DERIBIT_WS，引用计数管生命周期。
// ═══════════════════════════════════════════════════════════════════════════════

export function useFuturesBasis(coin: Coin): BasisPoint[] {
  const [basis, setBasis] = useState<BasisPoint[]>([]);
  const liveRef = useRef<Map<string, { mark: number; index: number; expiryMs: number; label: string }>>(new Map());
  const flushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const live = liveRef.current;
    live.clear();
    setBasis([]);
    let alive = true;
    const currency = coin === 'BTC' ? 'BTC' : 'ETH';
    const unsubs: Array<() => void> = [];

    const recompute = (): BasisPoint[] => {
      const now = Date.now();
      const out: BasisPoint[] = [];
      for (const e of live.values()) {
        const days = (e.expiryMs - now) / 86_400_000;
        if (days < 1 || !e.mark || !e.index) continue;
        out.push({
          label: e.label,
          daysToExp: Math.round(days),
          annBasis: (e.mark / e.index - 1) * (365 / days) * 100,
          spot: e.index,
          futurePx: e.mark,
        });
      }
      return out.sort((a, b) => a.daysToExp - b.daysToExp).slice(0, 6);
    };

    const scheduleEmit = () => {
      if (flushRef.current) return;
      flushRef.current = setTimeout(() => {
        flushRef.current = null;
        if (alive && !_shouldSkip()) setBasis(recompute());
      }, WS_FLUSH_MS);
    };

    // 一次性发现期货合约清单 + 播种初值（不等首个 tick 就能出图），随后逐合约 WS 实时更新。
    (async () => {
      try {
        const resp = await fetch(`https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=${currency}&kind=future`);
        if (!resp.ok || !alive) return;
        const json = await resp.json();
        const rows: Array<Record<string, unknown>> = json?.result ?? [];
        for (const r of rows) {
          const inst = r.instrument_name as string;
          const expiryMs = futuresExpiryMs(inst);
          if (expiryMs === null) continue; // 跳过 PERPETUAL
          const mark = (r.mark_price as number) ?? 0;
          const index = (r.underlying_price as number) ?? (r.index_price as number) ?? mark;
          live.set(inst, { mark, index, expiryMs, label: inst.split('-').slice(1).join('-') });
          unsubs.push(DERIBIT_WS.subscribe<{ mark_price?: number; index_price?: number; underlying_price?: number }>(
            `ticker.${inst}.100ms`,
            d => {
              const e = live.get(inst);
              if (!e) return;
              if (typeof d.mark_price === 'number') e.mark = d.mark_price;
              const idx = d.index_price ?? d.underlying_price;
              if (typeof idx === 'number') e.index = idx;
              scheduleEmit();
            },
          ));
        }
        if (alive) setBasis(recompute());
      } catch { /* WS tick 兜底；清单拉取失败则保持空表 */ }
    })();

    return () => {
      alive = false;
      if (flushRef.current) { clearTimeout(flushRef.current); flushRef.current = null; }
      unsubs.forEach(u => u());
      live.clear();
    };
  }, [coin]);

  return basis;
}
