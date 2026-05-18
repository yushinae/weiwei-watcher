import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MONITOR_RANGES, MONITOR_TABS, MONITOR_TENORS, type Coin, type MonitorRange, type MonitorTabId, type MonitorTenor } from '../types';

const DEFAULTS = {
  tab: 'overview' as MonitorTabId,
  coin: 'BTC' as Coin,
  range: '7D' as MonitorRange,
  tenor: '30D' as MonitorTenor,
};

function isIn<T extends readonly string[]>(v: string | null, arr: T): v is T[number] {
  return !!v && (arr as readonly string[]).includes(v);
}

export function useMonitorQueryState() {
  const [sp, setSp] = useSearchParams();

  const tab = useMemo(() => {
    const v = sp.get('tab');
    const ids = MONITOR_TABS.map(t => t.id);
    return isIn(v, ids) ? (v as MonitorTabId) : DEFAULTS.tab;
  }, [sp]);

  const coin = useMemo(() => {
    const v = sp.get('coin');
    return v === 'ETH' ? 'ETH' : DEFAULTS.coin;
  }, [sp]);

  const range = useMemo(() => {
    const v = sp.get('range');
    return isIn(v, MONITOR_RANGES) ? (v as MonitorRange) : DEFAULTS.range;
  }, [sp]);

  const tenor = useMemo(() => {
    const v = sp.get('tenor');
    return isIn(v, MONITOR_TENORS) ? (v as MonitorTenor) : DEFAULTS.tenor;
  }, [sp]);

  const patch = useCallback(
    (next: Partial<{ tab: MonitorTabId; coin: Coin; range: MonitorRange; tenor: MonitorTenor }>) => {
      const n = new URLSearchParams(sp);
      if (next.tab) n.set('tab', next.tab);
      if (next.coin) n.set('coin', next.coin);
      if (next.range) n.set('range', next.range);
      if (next.tenor) n.set('tenor', next.tenor);
      setSp(n, { replace: true });
    },
    [sp, setSp],
  );

  return {
    tab,
    coin,
    range,
    tenor,
    setTab: (t: MonitorTabId) => patch({ tab: t }),
    setCoin: (c: Coin) => patch({ coin: c }),
    setRange: (r: MonitorRange) => patch({ range: r }),
    setTenor: (t: MonitorTenor) => patch({ tenor: t }),
  };
}

