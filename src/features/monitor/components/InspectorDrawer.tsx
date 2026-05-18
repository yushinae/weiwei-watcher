import React, { useMemo } from 'react';
import { X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Drawer } from '../../../components/popup/Popup';
import { cn } from '../../../lib/utils';
import type { Coin, MonitorSelection } from '../types';

function coinToChainId(coin: Coin) {
  return coin === 'BTC' ? 'BTC-USD' : 'ETH-USD';
}

export function InspectorDrawer({
  open,
  selection,
  onClose,
}: {
  open: boolean;
  selection: MonitorSelection;
  onClose: () => void;
}) {
  const navigate = useNavigate();

  const title = useMemo(() => {
    switch (selection.type) {
      case 'smilePoint':
        return `${selection.coin} · Smile · ${selection.tenor} · ${selection.label}`;
      case 'skewCell':
        return `${selection.coin} · Skew · ${selection.row} × ${selection.col}`;
      default:
        return 'Inspector';
    }
  }, [selection]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      width={420}
      className="bg-surface-1 text-slate-200 border-l border-border-subtle"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-start gap-3 border-b border-border-subtle px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-text-muted">Inspector</div>
            <div className="mt-1 truncate text-[13px] font-extrabold tracking-[-0.01em] text-slate-100">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'grid h-9 w-9 place-items-center rounded-[10px]',
              'bg-surface-2/70 ring-1 ring-inset ring-border-subtle/70',
              'text-slate-400 hover:text-slate-200 transition-colors',
            )}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {selection.type === 'none' ? (
            <div className="rounded-[14px] border border-border-subtle bg-bg-card p-4 text-[12px] text-text-muted">
              选择任意图表元素以查看钻取详情。
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-[14px] border border-border-subtle bg-bg-card p-4">
                <div className="text-[11px] font-bold text-text-muted">当前选择</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  {'coin' in selection && (
                    <div className="flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                      <span className="text-text-muted">Coin</span>
                      <span className="font-mono tnum font-bold">{selection.coin}</span>
                    </div>
                  )}
                  {selection.type === 'smilePoint' && (
                    <>
                      <div className="flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                        <span className="text-text-muted">Tenor</span>
                        <span className="font-mono tnum font-bold">{selection.tenor}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                        <span className="text-text-muted">Delta</span>
                        <span className="font-mono tnum font-bold">{selection.label}</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                        <span className="text-text-muted">IV</span>
                        <span className="font-mono tnum font-bold text-brand-blue">{selection.value.toFixed(1)}%</span>
                      </div>
                    </>
                  )}
                  {selection.type === 'skewCell' && (
                    <>
                      <div className="flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                        <span className="text-text-muted">Row</span>
                        <span className="font-mono tnum font-bold">{selection.row}</span>
                      </div>
                      <div className="flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                        <span className="text-text-muted">Col</span>
                        <span className="font-mono tnum font-bold">{selection.col}</span>
                      </div>
                      <div className="col-span-2 flex items-center justify-between rounded-[10px] bg-surface-2/60 px-3 py-2">
                        <span className="text-text-muted">IV</span>
                        <span className="font-mono tnum font-bold text-brand-blue">{selection.value.toFixed(1)}%</span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {'coin' in selection && (
                <button
                  type="button"
                  onClick={() => {
                    navigate(`/options-chain?coin=${encodeURIComponent(coinToChainId(selection.coin))}`);
                    onClose();
                  }}
                  className={cn(
                    'group w-full rounded-[14px] border border-border-subtle bg-bg-card px-4 py-3',
                    'hover:border-border-strong transition-colors',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12px] font-bold text-slate-100">跳转到期权链</div>
                      <div className="text-[11px] text-text-muted">带入 coin；expiry 使用期权链默认值</div>
                    </div>
                    <div className="grid h-9 w-9 place-items-center rounded-[12px] bg-brand-blue/10 text-brand-blue group-hover:bg-brand-blue/15 transition-colors">
                      <ArrowRight size={16} />
                    </div>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
