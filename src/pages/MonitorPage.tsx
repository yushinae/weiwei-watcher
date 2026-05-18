import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { ElasticLayout } from '../components/ElasticLayout';
import { WidgetCard } from '../components/card/WidgetCard';
import { getJSON } from '../api/client';
import { MonitorHeader } from '../features/monitor/components/MonitorHeader';
import { MonitorLayout } from '../features/monitor/components/MonitorLayout';
import { InspectorDrawer } from '../features/monitor/components/InspectorDrawer';
import { useMonitorQueryState } from '../features/monitor/hooks/useMonitorQueryState';
import { useMonitorSelection } from '../features/monitor/hooks/useMonitorSelection';
import type { MonitorSelection } from '../features/monitor/types';
import {
  FixedTenorWidget,
  IVRankHistoryWidget,
  IVSurfaceWidget,
  ImpliedDistWidget,
  OptionsSkewWidget,
  PolymarketWidget,
  VRPHistoryWidget,
  VolConeWidget,
  VolOverviewWidget,
  VolSmileWidget,
} from '../registry/monitorWidgets';

type ApiChainRow = { K: number; call: any; put: any };
type ApiChainPayload = { base: string; expiryTs: string; strikes: ApiChainRow[] };
type ApiChainSnapshot = { ts: string; exchange: string; base: string; expiry_ts: string; payload: ApiChainPayload };

function LiveChainMini({ base }: { base: 'BTC' | 'ETH' }) {
  const [expiry, setExpiry] = useState<string | null>(null);
  const [snap, setSnap] = useState<ApiChainSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const out = await getJSON<{ items: string[] }>(`/api/options/expiries?exchange=bybit&base=${encodeURIComponent(base)}`);
        if (cancelled) return;
        const first = out.items?.[0] ?? null;
        setExpiry(first);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    if (!expiry) return;
    let cancelled = false;
    const run = async () => {
      try {
        const s = await getJSON<ApiChainSnapshot | null>(
          `/api/options/chain/latest?exchange=bybit&base=${encodeURIComponent(base)}&expiry=${encodeURIComponent(expiry)}`,
        );
        if (cancelled) return;
        setSnap(s);
      } catch {
        // ignore
      }
    };
    void run();
    const t = setInterval(run, 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [base, expiry]);

  const rows = useMemo(() => {
    const strikes = snap?.payload?.strikes ?? [];
    return strikes.slice(0, 12);
  }, [snap]);

  return (
    <div className="h-full w-full overflow-auto px-3 pb-3">
      <div className="pt-2 text-[11px] text-text-muted flex items-center justify-between">
        <span>Bybit 快照 · {expiry ? new Date(expiry).toLocaleString() : '加载到期日…'}</span>
        <span className="tnum">{snap?.ts ? new Date(snap.ts).toLocaleTimeString() : '—'}</span>
      </div>
      <div className="mt-2 rounded-[12px] border border-border-subtle overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-surface-2/60 text-text-muted">
            <tr>
              <th className="px-2 py-2 text-left font-bold">K</th>
              <th className="px-2 py-2 text-right font-bold">Call Bid</th>
              <th className="px-2 py-2 text-right font-bold">Call Ask</th>
              <th className="px-2 py-2 text-right font-bold">Put Bid</th>
              <th className="px-2 py-2 text-right font-bold">Put Ask</th>
            </tr>
          </thead>
          <tbody className="bg-bg-card">
            {rows.length ? (
              rows.map((r, idx) => (
                <tr key={idx} className="border-t border-border-subtle/70">
                  <td className="px-2 py-2 font-mono tnum text-slate-200">{Number(r.K).toFixed(0)}</td>
                  <td className="px-2 py-2 font-mono tnum text-right text-slate-200">{r.call?.bid ?? '—'}</td>
                  <td className="px-2 py-2 font-mono tnum text-right text-slate-200">{r.call?.ask ?? '—'}</td>
                  <td className="px-2 py-2 font-mono tnum text-right text-slate-200">{r.put?.bid ?? '—'}</td>
                  <td className="px-2 py-2 font-mono tnum text-right text-slate-200">{r.put?.ask ?? '—'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-text-muted">
                  暂无链快照数据（请确认采集器已启用，且已订阅到期权 symbol）。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function MonitorPage() {
  const navigate = useNavigate();
  const { tab, setTab, coin, setCoin, range, setRange, tenor, setTenor } = useMonitorQueryState();
  const { selection, setSelection, clearSelection, open } = useMonitorSelection();

  const onPickSmilePoint = (p: Extract<MonitorSelection, { type: 'smilePoint' }>) => {
    setSelection(p);
  };

  const onPickSkewCell = (p: Extract<MonitorSelection, { type: 'skewCell' }>) => {
    setSelection(p);
  };

  return (
    <div className="absolute inset-0 monitor-scope flex flex-col text-slate-200">
      <MonitorHeader
        coin={coin}
        range={range}
        tenor={tenor}
        onCoinChange={setCoin}
        onRangeChange={setRange}
        onTenorChange={setTenor}
      />

      <MonitorLayout tab={tab} onTabChange={setTab}>
        <ElasticLayout className="h-full">
          <div className="p-4">
            {tab === 'overview' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="波动率概览" headerDensity="compact" className="col-span-7 h-[360px]">
                  <VolOverviewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="市场预测（Polymarket）" headerDensity="compact" className="col-span-5 h-[360px]">
                  <PolymarketWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'surface' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="波动率微笑（点击点可钻取）" headerDensity="compact" className="col-span-6 h-[340px]">
                  <VolSmileWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickSmilePoint={(p) => onPickSmilePoint({ type: 'smilePoint', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="IV 曲面偏斜表（点击单元可钻取）" headerDensity="compact" className="col-span-6 h-[340px]">
                  <IVSurfaceWidget
                    coin={coin}
                    onCoinChange={setCoin}
                    onPickCell={(p) => onPickSkewCell({ type: 'skewCell', ...p })}
                  />
                </WidgetCard>
                <WidgetCard title="期权偏斜（25δ / 10δ）" headerDensity="compact" className="col-span-12 h-[260px]">
                  <OptionsSkewWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'history' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="VRP 历史（30D）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <VRPHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="IV 百分位历史（90D）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <IVRankHistoryWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="波动率锥" headerDensity="compact" className="col-span-12 h-[280px]">
                  <VolConeWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'distribution' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="固定期限方差分布" headerDensity="compact" className="col-span-6 h-[300px]">
                  <FixedTenorWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
                <WidgetCard title="隐含分布图（30D）" headerDensity="compact" className="col-span-6 h-[300px]">
                  <ImpliedDistWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'greeks' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard
                  title="Greeks Heatmap"
                  headerDensity="compact"
                  className="col-span-12 h-[260px]"
                  subtitle={<span className="text-[10px] text-text-muted">待接入（本次先统一卡片体系）</span>}
                >
                  <div className="flex h-full items-center justify-center text-[12px] text-text-muted">
                    预留区域：后续可将现有 heatmap 迁入 feature/widgets 并接入虚拟化/选择态。
                  </div>
                </WidgetCard>
              </div>
            )}

            {tab === 'chain' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard
                  title="期权链（跳转到独立页面）"
                  headerDensity="compact"
                  className="col-span-12 h-[420px]"
                  actions={[
                    {
                      id: 'open-chain',
                      icon: ArrowUpRight,
                      label: '打开期权链',
                      onClick: () => navigate(`/options-chain?coin=${encodeURIComponent(coin === 'BTC' ? 'BTC-USD' : 'ETH-USD')}`),
                    },
                  ]}
                >
                  <LiveChainMini base={coin} />
                </WidgetCard>
              </div>
            )}

            {tab === 'polymarket' && (
              <div className="grid grid-cols-12 gap-3">
                <WidgetCard title="市场预测（Polymarket）" headerDensity="compact" className="col-span-12 h-[420px]">
                  <PolymarketWidget coin={coin} onCoinChange={setCoin} />
                </WidgetCard>
              </div>
            )}
          </div>
        </ElasticLayout>
      </MonitorLayout>

      <InspectorDrawer open={open} selection={selection} onClose={clearSelection} />
    </div>
  );
}
