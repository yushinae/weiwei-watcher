/** @deprecated 已切回“组件库-期权链(action)”作为新增入口；此弹窗暂保留但不再使用。 */
import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Modal } from '../components/popup/Popup';

export type OptionItem = { value: string; label: string };

export function AddOptionsChainTabModal({
  open,
  onClose,
  defaultCoinId,
  defaultExpiry,
  coinOptions,
  expiryOptions,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  defaultCoinId: string;
  defaultExpiry: string;
  coinOptions: OptionItem[];
  expiryOptions: string[];
  onAdd: (coinId: string, expiry: string) => void;
}) {
  const safeDefaultCoinId = useMemo(() => {
    if (coinOptions.some(o => o.value === defaultCoinId)) return defaultCoinId;
    return coinOptions[0]?.value ?? defaultCoinId;
  }, [coinOptions, defaultCoinId]);

  const safeDefaultExpiry = useMemo(() => {
    if (expiryOptions.includes(defaultExpiry)) return defaultExpiry;
    return expiryOptions[0] ?? defaultExpiry;
  }, [expiryOptions, defaultExpiry]);

  const [coinId, setCoinId] = useState(safeDefaultCoinId);
  const [expiry, setExpiry] = useState(safeDefaultExpiry);

  useEffect(() => {
    if (!open) return;
    setCoinId(safeDefaultCoinId);
    setExpiry(safeDefaultExpiry);
  }, [open, safeDefaultCoinId, safeDefaultExpiry]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      zIndex={220}
      className="w-full max-w-[520px] border border-white/10"
    >
      <motion.div
        className="p-6"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
      >
        <div className="flex items-end justify-between gap-4 mb-5">
          <div className="min-w-0">
            <h2 className="text-white text-[16px] font-extrabold tracking-tight">新增期权链</h2>
            <p className="text-white/40 text-[12px] mt-1">
              只追加到右侧，不会切换当前页面
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-white/55 text-[12px] mb-2 font-bold">标的</label>
            <select
              aria-label="选择标的"
              value={coinId}
              onChange={(e) => setCoinId(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 focus:border-white/25 focus:outline-none text-white px-3.5 py-2.5 rounded-[8px] transition-colors text-[13px] font-bold"
            >
              {coinOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-white/55 text-[12px] mb-2 font-bold">到期日</label>
            <select
              aria-label="选择到期日"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full bg-white/[0.03] border border-white/10 hover:border-white/20 focus:border-white/25 focus:outline-none text-white px-3.5 py-2.5 rounded-[8px] transition-colors text-[13px] font-bold"
            >
              {expiryOptions.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            aria-label="取消新增期权链"
            className="px-5 py-2 rounded-[8px] border border-white/10 text-white/60 hover:text-white hover:border-white/20 transition-colors text-[13px] font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4D7CFF]/60"
          >
            取消
          </button>
          <button
            onClick={() => { onAdd(coinId, expiry); }}
            aria-label="确认新增期权链"
            className="px-5 py-2 rounded-[8px] bg-[#4D7CFF] hover:bg-[#3d63cc] shadow-[0_0_12px_rgba(77,124,255,0.4)] text-white transition-colors text-[13px] font-bold border border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4D7CFF]/60"
          >
            添加
          </button>
        </div>
      </motion.div>
    </Modal>
  );
}
