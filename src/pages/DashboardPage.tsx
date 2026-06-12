import React, { useState } from 'react';
import type { Coin } from '../features/monitor/types';
// 本页已在 App 路由层 lazy 加载，内层再 lazy 一次只会多一轮加载瀑布——直接静态引入。
import DashboardContent from './tabs/DashboardPage';

export default function DashboardPage() {
  const [coin, setCoin] = useState<Coin>('BTC');

  return (
    <div className="absolute inset-0 monitor-scope flex flex-col text-slate-200">
      <div className="flex-1 overflow-auto px-3 pt-3 pb-4">
        <DashboardContent coin={coin} setCoin={setCoin} />
      </div>
    </div>
  );
}
