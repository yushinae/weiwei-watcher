import React, { useMemo, useState } from 'react';
import { Download, GripVertical, Plus, Search } from 'lucide-react';
import { cn } from '../lib/utils';

type PositionRow = {
  product: string;
  qty: number;
  value: number;
  avg: number;
  mark: number;
  elp: number;
  rspl: number;
  uspl: number;
  pnl: number;
  roi: number;
  im?: number;
  maintMargin?: number;
  delta?: number;
};

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
        选定设置没有结果。
      </div>
      <button
        type="button"
        className="mt-5 h-11 px-6 rounded-[10px] bg-white/[0.08] border border-white/[0.08] text-[13px] font-extrabold text-white/80 hover:bg-white/[0.10] transition-colors inline-flex items-center gap-2"
      >
        <Plus size={16} />
        添加组件
      </button>
    </div>
  );
}

export function PositionsWidget() {
  // 仅 UI：后续接入真实仓位数据时，把 rows 替换为 API/Store 数据即可
  const [settlement, setSettlement] = useState<'USDC' | 'USDT'>('USDC');
  const [coinFilter, setCoinFilter] = useState<'all' | 'BTC' | 'ETH' | 'USDC'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'spot' | 'futures' | 'options'>('all');

  const rows: PositionRow[] = useMemo(() => {
    // 先保持为空以匹配视频中的“无结果”状态
    return [];
  }, []);

  return (
    <div className="h-full w-full flex flex-col">
      {/* Header */}
      <div className="h-10 flex items-center justify-between px-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="text-[13px] font-extrabold text-white/80 tracking-tight">
            仓位 ({settlement})
          </div>
          <div className="text-[12px] font-bold text-white/40">0</div>
          <button
            type="button"
            className="w-6 h-6 rounded-[7px] border border-transparent bg-transparent text-white/40 hover:text-white/85 hover:bg-white/[0.06] hover:border-white/[0.08] transition-colors flex items-center justify-center"
            title="新增"
            aria-label="新增"
          >
            <Plus size={14} />
          </button>
        </div>

        {/* Right actions — matches the “移动头寸 / CSV” vibe */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="h-[28px] px-3 rounded-[10px] border border-white/10 bg-white/[0.04] text-[12px] font-extrabold text-white/75 hover:bg-white/[0.06] transition-colors inline-flex items-center gap-2"
          >
            <GripVertical size={14} className="text-white/55" />
            移动头寸
          </button>
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
          <div className="h-[28px] w-[240px] rounded-[10px] border border-white/10 bg-black/30 flex items-center gap-2 px-2.5">
            <Search size={14} className="text-white/35" />
            <input
              className="bg-transparent outline-none text-[12px] font-semibold text-white/80 placeholder:text-white/25 w-full"
              placeholder="搜索"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar">
            <Pill active={coinFilter === 'all'} onClick={() => setCoinFilter('all')}>所有</Pill>
            <CoinPill label="BTC" dotColor="rgba(247,147,26,0.90)" active={coinFilter === 'BTC'} onClick={() => setCoinFilter('BTC')} />
            <CoinPill label="ETH" dotColor="rgba(98,126,234,0.90)" active={coinFilter === 'ETH'} onClick={() => setCoinFilter('ETH')} />
            <CoinPill label="USDC" dotColor="rgba(59,130,246,0.90)" active={coinFilter === 'USDC'} onClick={() => setCoinFilter('USDC')} />
            <Pill active={typeFilter === 'all'} onClick={() => setTypeFilter('all')}>所有</Pill>
            <Pill active={typeFilter === 'futures'} onClick={() => setTypeFilter('futures')}>期货</Pill>
            <Pill active={typeFilter === 'options'} onClick={() => setTypeFilter('options')}>期权</Pill>
            <Pill active={typeFilter === 'spot'} onClick={() => setTypeFilter('spot')}>货币</Pill>
            <Pill active={settlement === 'USDC'} onClick={() => setSettlement('USDC')}>到期</Pill>
          </div>
        </div>
      </div>

      {/* Table header */}
      <div className="px-3 shrink-0">
        <div className="h-9 grid items-center text-[11px] font-bold text-white/35 border-b border-white/[0.06]"
          style={{ gridTemplateColumns: '220px 90px 90px 110px 110px 80px 80px 80px 110px 70px 70px 110px 90px 70px' }}
        >
          <div className="flex items-center gap-2">产品 <span className="text-white/20">↑</span></div>
          <div className="text-right">数量</div>
          <div className="text-right">值</div>
          <div className="text-right">平均价格</div>
          <div className="text-right">标记价格</div>
          <div className="text-right">ELP</div>
          <div className="text-right">RSPL</div>
          <div className="text-right">USPL</div>
          <div className="text-right">损益</div>
          <div className="text-right">ROI</div>
          <div className="text-right">IM</div>
          <div className="text-right">维持保证金</div>
          <div className="text-right">Δ Delta</div>
          <div className="text-right">Delta</div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-auto px-3">
        {rows.length === 0 ? (
          <div className="h-full">
            <EmptyState />
          </div>
        ) : (
          <div className="py-2 space-y-1">
            {/* TODO: 渲染真实行 */}
          </div>
        )}
      </div>
    </div>
  );
}

