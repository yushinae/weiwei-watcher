import { useState } from 'react';
import type { Coin, MonitorTabId } from '../types';

export function useMonitorQueryState() {
  const [tab, setTab] = useState<MonitorTabId>('market');
  const [coin, setCoin] = useState<Coin>('BTC');

  return { tab, setTab, coin, setCoin };
}
