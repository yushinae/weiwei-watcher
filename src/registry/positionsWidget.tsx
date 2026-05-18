import React, { useMemo, useState } from 'react';
import { Download, GripVertical, Plus, Search, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSimTradingStore } from '../store/useSimTradingStore';

function Pill({
  active,
  children,
  onClick,
  className,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-[26px] px-3 rounded-[10px] border text-[12px] font-extrabold tracking-tight transition-colors",
        active
          ? "bg-white/[0.08] text-white border-white/[0.10]"
          : "bg-transparent text-white/55 border-transparent hover:bg-white/[0.05] hover:text-white/80 hover:border-white/[0.08]",
        className
      )}
    >
      {children}
    </button>
  );
}

function CoinPill({
  label,
  active,
  dotColor,
  onClick,
}: {
  label: string;
  active?: boolean;
  dotColor: string;
  onClick?: () => void;
}) {
  return (
    <Pill active={active} onClick={onClick} className="pl-2 pr-3">
      <span className="inline-flex items-center gap-2">
        <span
          className="size-4 rounded-full border border-white/10"
          style={{ backgroundColor: dotColor }}
        />
        <span>{label}</span>
      </span>
    </Pill>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 min-h-0 flex flex-col items-center justify-center text-center">
      <div className="relative">
        <div className="w-16 h-12 rounded-[10px] border border-white/10 bg-white/[0.02] shadow-[0_14px_40px_rgba(0,0,0,0.35)]" />
        <div className="absolute left-1/2 -translate-x-1/2 -top-3 w-10 h-10 rounded-[12px] border border-white/10 bg-black/40 backdrop-blur-sm flex items-center justify-center">
          <div className="w-5 h-5 rotate-45 border border-white/20 bg-white/[0.04]" />
        </div>
      </div>
      <div className="mt-4 text-[13px] font-bold text-white/55 tracking-tight">
        暂无持仓。去期权链下一单吧。
      </div>
    </div>
  );
}

export function PositionsWidget() {
  const positions = useSimTradingStore(s => s.positions);
  const closePosition = useSimTradingStore(s => s.closePosition);
  const [coinFilter, setCoinFilter] = useState<'all' | 'BTC' | 'ETH' | 'SOL'>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return positions.filter(p => {
      if (coinFilter !== 'all' && p.coin !== coinFilter) return false;
      if (search && !p.symbol.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [positions, coinFilter, search]);

  const totalPnL = useMemo(() => filtered.reduce((s, p) => s + p.unrealizedPnL, 0), [filtered]);
  const totalDelta = useMemo(() => filtered.reduce((s, p) => s + p.delta, 0), [filtered]);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[13px] font-extrabold text-white/80 tracking-tight">
            仓位
          </div>
          <div className="text-[12px] font-bold text-white/40">{filtered.length}</div>
          {totalPnL !== 0 && (
            <span className={cn(
              "text-[11px] font-bold font-mono",
              totalPnL >= 0 ? "text-emerald-400" : "text-rose-400"
            )}>
              {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="h-[28px] px-3 rounded-[10px] border border-white/10 bg-white/[0.04] text-[12px] font-extrabold text-white/75 hover:bg-white/[0.06] transition-colors inline-flex items-center gap-2"
          >
            <Download size={14} className="text-white/55" />
            CSV
          </button>
        </div>
      </div>

      {/* Filter row */}
      <div className="px-3 pb-2 shrink-0">
        <div className="flex items-center gap-2">
          <div className="h-[28px] w-[180px] rounded-[10px] border border-white/10 bg-black/30 flex items-center gap-2 px-2.5">
            <Search size={14} className="text-white/35" />
            <input
              className="bg-transparent outline-none text-[12px] font-semibold text-white/80 placeholder:text-white/25 w-full"
              placeholder="搜索合约"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-white/30 hover:text-white/60">
                <X size={12} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar">
            <Pill active={coinFilter === 'all'} onClick={() => setCoinFilter('all')}>所有</Pill>
            <CoinPill label="BTC" dotColor="rgba(247,147,26,0.90)" active={coinFilter === 'BTC'} onClick={() => setCoinFilter('BTC')} />
            <CoinPill label="ETH" dotColor="rgba(98,126,234,0.90)" active={coinFilter === 'ETH'} onClick={() => setCoinFilter('ETH')} />
            <CoinPill label="SOL" dotColor="rgba(0,255,163,0.90)" active={coinFilter === 'SOL'} onClick={() => setCoinFilter('SOL')} />
          </div>
        </div>
      </div>

      {/* Table header */}
      <div className="px-3 shrink-0">
        <div className="h-9 grid items-center text-[11px] font-bold text-white/35 border-b border-white/[0.06]"
          style={{ gridTemplateColumns: '180px 70px 90px 90px 90px 80px 70px 60px' }}
        >
          <div className="flex items-center gap-2">产品</div>
          <div className="text-right">方向</div>
          <div className="text-right">数量</div>
          <div className="text-right">均价</div>
          <div className="text-right">标记价</div>
          <div className="text-right">未实现 PnL</div>
          <div className="text-right">Δ</div>
          <div className="text-right">操作</div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto px-3">
        {filtered.length === 0 ? (
          <div className="h-full">
            <EmptyState />
          </div>
        ) : (
          <div className="py-2 space-y-1">
            {filtered.map(p => (
              <div
                key={p.id}
                className="h-9 grid items-center text-[12px] font-mono border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                style={{ gridTemplateColumns: '180px 70px 90px 90px 90px 80px 70px 60px' }}
              >
                <div className="font-bold text-white/80 truncate">{p.symbol}</div>
                <div className={cn("text-right font-bold", p.side === 'long' ? "text-emerald-400" : "text-rose-400")}>
                  {p.side === 'long' ? '多' : '空'}
                </div>
                <div className="text-right">{p.qty.toFixed(2)}</div>
                <div className="text-right">{p.avgEntryPrice.toFixed(2)}</div>
                <div className="text-right">{p.markPrice.toFixed(2)}</div>
                <div className={cn("text-right font-bold", p.unrealizedPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>
                  {p.unrealizedPnL >= 0 ? '+' : ''}{p.unrealizedPnL.toFixed(2)}
                </div>
                <div className="text-right">{p.delta.toFixed(3)}</div>
                <div className="text-right">
                  <button
                    onClick={() => closePosition(p.id)}
                    className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors"
                  >
                    平仓
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
