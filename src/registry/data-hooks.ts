import { useState, useEffect } from 'react';
import type { Coin } from '../features/monitor/types';
import type { DeribitData, HistoryData } from './types';
import { subscribeData, fetchDeribitOptions, fetchDeribitHistory, CACHE_TTL, HIST_TTL } from './data-layer';

export function useDeribitOptions(coin: Coin) {
  const [data, setData] = useState<DeribitData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const unsub = subscribeData<DeribitData>(
      `options-${coin}`,
      () => fetchDeribitOptions(coin),
      CACHE_TTL,
      d => { if (active) { setData(d); setLoading(false); } },
    );
    return () => { active = false; unsub(); };
  }, [coin]);

  return { data, loading };
}

export function useDeribitHistory(coin: Coin) {
  const [data, setData] = useState<HistoryData | null>(null);

  useEffect(() => {
    let active = true;
    const unsub = subscribeData<HistoryData>(
      `history-${coin}`,
      () => fetchDeribitHistory(coin),
      HIST_TTL,
      d => { if (active) setData(d); },
    );
    return () => { active = false; unsub(); };
  }, [coin]);

  return { data };
}
