import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import { cn } from '../lib/utils';

interface AssetRow {
  symbol: string;
  name: string;
  netValue: number;
  netValueUsd: number;
  withdrawable: number;
  iconBg: string;
  iconSvg: React.ReactNode;
}

const BtcIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <circle cx="16" cy="16" r="16" fill="#F7931A" />
    <path d="M22.3 14.1c.3-2.3-1.4-3.5-3.8-4.3l.8-3.2-1.9-.5-.8 3.1c-.5-.1-1-.2-1.5-.4l.8-3.1-1.9-.5-.8 3.2c-.4-.1-.8-.2-1.2-.3l-2.7-.7-.5 2s1.4.3 1.4.3c.8.2 1 .7.9 1.1l-2.3 9.3c-.1.2-.3.6-1 .4 0 0-1.4-.3-1.4-.3l-1 2.3 2.5.6c.5.1 1 .3 1.5.4l-.8 3.2 1.9.5.8-3.2c.5.1 1 .3 1.5.4l-.8 3.2 1.9.5.8-3.2c3.2.6 5.6.4 6.7-2.5.8-2.3 0-3.6-1.7-4.5 1.2-.3 2.1-1.1 2.3-2.8zm-4.1 5.8c-.6 2.3-4.5.7-5.7.4l1-4.1c1.2.3 5 .9 4.7 3.7zm.6-5.8c-.5 2-3.9.7-5 .4l.9-3.7c1.1.3 4.6.8 4.1 3.3z" fill="#fff" />
  </svg>
);

const EthIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <circle cx="16" cy="16" r="16" fill="#627EEA" />
    <path d="M16 5.5v8.2l6.9 3.1L16 5.5z" fill="#C0CBF6" />
    <path d="M16 5.5L9.1 16.8l6.9-3.1V5.5z" fill="#fff" />
    <path d="M16 21.8v4.7l6.9-9.5L16 21.8z" fill="#C0CBF6" />
    <path d="M16 26.5v-4.7L9.1 17l6.9 9.5z" fill="#fff" />
    <path d="M16 20.6l6.9-4.1L16 13.7v6.9z" fill="#8197EE" />
    <path d="M9.1 16.5l6.9 4.1v-6.9l-6.9 2.8z" fill="#C0CBF6" />
  </svg>
);

const UsdcIcon = () => (
  <svg viewBox="0 0 32 32" className="w-7 h-7">
    <circle cx="16" cy="16" r="16" fill="#2775CA" />
    <path d="M16 6.5C10.75 6.5 6.5 10.75 6.5 16S10.75 25.5 16 25.5 25.5 21.25 25.5 16 21.25 6.5 16 6.5zm1.5 14.8v1.2h-3v-1.2c-2.3-.4-3.5-1.8-3.5-3.5h2.2c0 .9.5 1.5 1.3 1.5.7 0 1.2-.4 1.2-1.1 0-.7-.5-1.1-1.5-1.4-1.7-.5-2.7-1.3-2.7-2.8 0-1.4 1-2.5 2.5-2.8V9.5h3v1.7c2 .4 3 1.7 3 3.2h-2.2c0-.8-.4-1.3-1.1-1.3-.6 0-1 .4-1 .9 0 .6.4.9 1.5 1.3 1.7.5 2.8 1.3 2.8 2.9 0 1.5-1 2.6-2.5 3.1z" fill="#fff" />
  </svg>
);

const ASSETS: AssetRow[] = [
  { symbol: 'BTC', name: 'Bitcoin',  netValue: 0,     netValueUsd: 0,     withdrawable: 0,     iconBg: '#F7931A', iconSvg: <BtcIcon /> },
  { symbol: 'ETH', name: 'Ethereum', netValue: 0,     netValueUsd: 0,     withdrawable: 0,     iconBg: '#627EEA', iconSvg: <EthIcon /> },
  { symbol: 'USDC', name: 'USD Coin', netValue: 53.65, netValueUsd: 53.64, withdrawable: 53.65, iconBg: '#2775CA', iconSvg: <UsdcIcon /> },
];

const totalUsd = ASSETS.reduce((s, a) => s + a.netValueUsd, 0);

const fmt = (n: number, decimals = 4) =>
  n === 0 ? '0.0000' : n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export default function AssetsPage() {
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#0A0A0D] px-2 py-2">
      <div className="max-w-5xl mx-auto flex flex-col gap-6">

        {/* 总账户价值横幅 */}
        <div
          className="relative rounded-[14px] overflow-hidden px-8 py-7 flex items-end justify-between"
          style={{ background: 'linear-gradient(135deg, #0d1a3a 0%, #0f1628 50%, #0a0e1f 100%)' }}
        >
          <div>
            <p className="text-[13px] font-bold text-slate-400 mb-1">总账户价值</p>
            <p className="text-[38px] font-bold text-white leading-none tracking-tight font-mono tnum">
              ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          {/* 装饰性硬币图形 */}
          <div className="flex items-end gap-3 opacity-60 pointer-events-none select-none">
            <svg viewBox="0 0 80 60" className="w-32 h-24">
              <ellipse cx="40" cy="50" rx="36" ry="8" fill="#1a2a5e" />
              <ellipse cx="40" cy="42" rx="36" ry="8" fill="#1e3070" />
              <ellipse cx="40" cy="34" rx="36" ry="8" fill="#223380" />
              <ellipse cx="40" cy="26" rx="36" ry="8" fill="#2636a0" />
              <ellipse cx="40" cy="18" rx="36" ry="8" fill="#2a3ab0" />
              <ellipse cx="40" cy="10" rx="36" ry="8" fill="#303eb8" />
            </svg>
          </div>
        </div>

        {/* 资产列表 */}
        <div className="bg-[#0A0A0D] rounded-[12px] border border-[#1E1E26] overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_140px_180px_140px_56px] px-6 py-3 border-b border-[#1E1E26]">
            <span className="text-[12px] font-bold text-slate-500 flex items-center gap-1">
              货币
              <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current opacity-60">
                <path d="M8 3L5 8h6L8 3zm0 10l3-5H5l3 5z" />
              </svg>
            </span>
            <span className="text-[12px] font-bold text-slate-500 text-right">资产净值</span>
            <span className="text-[12px] font-bold text-slate-500 text-right flex items-center justify-end gap-1">
              <svg viewBox="0 0 16 16" className="w-3 h-3 fill-current opacity-60">
                <path d="M8 3L5 8h6L8 3zm0 10l3-5H5l3 5z" />
              </svg>
              资产净值（$）
            </span>
            <span className="text-[12px] font-bold text-slate-500 text-right">可取款余额</span>
            <span className="text-[12px] font-bold text-slate-500 text-right">操作</span>
          </div>

          {/* 行 */}
          {ASSETS.map((asset, idx) => (
            <div
              key={asset.symbol}
              className={cn(
                'grid grid-cols-[1fr_140px_180px_140px_56px] px-6 py-4 items-center transition-colors hover:bg-[#131320]',
                idx < ASSETS.length - 1 && 'border-b border-[#1A1A22]'
              )}
            >
              {/* 货币 */}
              <div className="flex items-center gap-3">
                <div className="shrink-0">{asset.iconSvg}</div>
                <div>
                  <span className="text-[15px] font-bold text-white">{asset.name}</span>
                  <span className="ml-2 text-[13px] font-bold text-slate-500">{asset.symbol}</span>
                </div>
              </div>

              {/* 资产净值 */}
              <span className="text-[14px] font-bold text-slate-300 font-mono tnum text-right">
                {fmt(asset.netValue)}
              </span>

              {/* 资产净值 USD */}
              <span className="text-[14px] font-bold text-slate-300 font-mono tnum text-right">
                ${fmt(asset.netValueUsd, 2)}
              </span>

              {/* 可取款余额 */}
              <span className="text-[14px] font-bold text-slate-300 font-mono tnum text-right">
                {fmt(asset.withdrawable)}
              </span>

              {/* 操作 */}
              <div className="flex justify-end relative">
                <button
                  onClick={() => setMenuOpen(menuOpen === asset.symbol ? null : asset.symbol)}
                  className="w-8 h-8 flex items-center justify-center rounded-[6px] bg-[#1E1E26] hover:bg-[#2A2A35] text-slate-400 hover:text-white transition-colors"
                >
                  <MoreVertical size={15} />
                </button>
                {menuOpen === asset.symbol && (
                  <div
                    className="absolute right-0 top-9 w-32 bg-[#1A1A24] border border-[#2F2F38] rounded-[8px] shadow-[0_8px_24px_rgba(0,0,0,0.5)] z-50 overflow-hidden"
                    onMouseLeave={() => setMenuOpen(null)}
                  >
                    {['充值', '提现', '划转'].map(action => (
                      <button
                        key={action}
                        className="w-full text-left px-3 py-2 text-[13px] text-slate-300 hover:bg-[#2A2A35] hover:text-white transition-colors"
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
