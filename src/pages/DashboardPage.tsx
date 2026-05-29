import React, { Suspense, lazy, useState } from 'react';
import type { Coin } from '../features/monitor/types';

const DashboardContent = lazy(() => import('./tabs/DashboardPage'));

const Fallback = () => (
  <div className="flex items-center justify-center h-48">
    <div className="w-6 h-6 border-2 border-white/10 border-t-brand rounded-full animate-spin" />
  </div>
);

export default function DashboardPage() {
  const [coin, setCoin] = useState<Coin>('BTC');

  return (
    <div className="absolute inset-0 monitor-scope flex flex-col text-slate-200">
      <div className="flex-1 overflow-auto px-3 pt-3 pb-4">
        <Suspense fallback={<Fallback />}>
          <DashboardContent coin={coin} setCoin={setCoin} />
        </Suspense>
      </div>
    </div>
  );
}
