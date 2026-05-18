/**
 * 交易日志页面 v2
 * 重构内容：
 * 1. 自定义日期范围选择器（替换 antd DatePicker，修复日历显示 Bug 与暗色主题）
 * 2. 图表列：支持粘贴截图 / 点击上传 / 点击预览大图
 * 3. 批量管理模式：勾选框默认隐藏，通过「批量管理」按钮控制
 * 4. 批量添加标签功能
 * 5. 添加交易记录侧边抽屉
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ElasticLayout } from '../components/ElasticLayout';
import { Popover } from '../components/popup/Popup';
import { Modal, Drawer } from '../components/popup/Popup';
import {
  Columns3, Tag, ChevronDown, ChevronLeft, ChevronRight,
  Search, X, GripVertical, Calendar, Check,
  Plus, Upload, Eye, CheckSquare, Square, Folder, Trash2, Pencil,
} from 'lucide-react';
import { ConfigProvider, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import { cn } from '../lib/utils';
import dayjs from 'dayjs';

// ==================== 类型定义 ====================

interface TradeRecord {
  key: string;
  images?: string[];
  notes?: string;
  account: string;
  symbol: string;
  status: '盈利' | '亏损';
  holdingMinutes: number;
  openAt: string;
  closeAt: string;
  netPnl: number;
  tags: string[];
  tradeAt: string;
  commission: number;
  volume: number;
  instrumentType: string;
}

interface ColumnConfig {
  key: string;
  label: string;
  visible: boolean;
}

// ==================== Mock 数据 ====================

const INITIAL_TRADE_DATA: TradeRecord[] = [
  { key: '1', account: 'Deribit-主账户',   symbol: 'BTC.Opts', status: '盈利', openAt: '2026-05-06 09:30:00', closeAt: '2026-05-06 11:52:00', holdingMinutes: 142, netPnl: 1240.5,  tags: ['趋势追踪', '开盘突破'], tradeAt: '2026-05-06 09:30:00', commission: 12.4, volume: 2.5,  instrumentType: '期权' },
  { key: '2', account: 'Binance-策略账户', symbol: 'ETH.Perp', status: '亏损', openAt: '2026-05-06 10:15:00', closeAt: '2026-05-06 10:53:00', holdingMinutes: 38,  netPnl: -320.0,  tags: ['反转策略'],           tradeAt: '2026-05-06 10:15:00', commission: 8.2,  volume: 5.0,  instrumentType: '永续' },
  { key: '3', account: 'Deribit-主账户',   symbol: 'BTC.Perp', status: '盈利', openAt: '2026-05-05 14:22:00', closeAt: '2026-05-05 23:02:00', holdingMinutes: 520, netPnl: 3100.0,  tags: ['趋势追踪', '波段'],   tradeAt: '2026-05-05 14:22:00', commission: 31.0, volume: 0.8,  instrumentType: '永续' },
  { key: '4', account: 'OKX-套利账户',    symbol: 'SOL.Opts', status: '亏损', openAt: '2026-05-05 11:05:00', closeAt: '2026-05-05 12:20:00', holdingMinutes: 75,  netPnl: -185.3,  tags: ['套利'],               tradeAt: '2026-05-05 11:05:00', commission: 4.6,  volume: 50,   instrumentType: '期权' },
  { key: '5', account: 'Binance-策略账户', symbol: 'BNBUSDT',  status: '盈利', openAt: '2026-05-04 09:00:00', closeAt: '2026-05-04 12:30:00', holdingMinutes: 210, netPnl: 567.8,   tags: ['开盘突破', '做多'],   tradeAt: '2026-05-04 09:00:00', commission: 5.7,  volume: 12,   instrumentType: '现货' },
  { key: '6', account: 'Deribit-主账户',   symbol: 'ETH.Opts', status: '亏损', openAt: '2026-05-04 15:40:00', closeAt: '2026-05-04 16:10:00', holdingMinutes: 30,  netPnl: -95.0,   tags: ['反转策略'],           tradeAt: '2026-05-04 15:40:00', commission: 2.0,  volume: 3,    instrumentType: '期权' },
  { key: '7', account: 'OKX-套利账户',    symbol: 'BTC.Opts', status: '盈利', openAt: '2026-05-03 08:30:00', closeAt: '2026-05-03 23:10:00', holdingMinutes: 880, netPnl: 4200.0,  tags: ['趋势追踪', '高胜率'], tradeAt: '2026-05-03 08:30:00', commission: 42.0, volume: 1.2,  instrumentType: '期权' },
  { key: '8', account: 'Binance-策略账户', symbol: 'SOLUSDT',  status: '亏损', openAt: '2026-05-03 13:20:00', closeAt: '2026-05-03 13:38:00', holdingMinutes: 18,  netPnl: -460.0,  tags: ['止损出场'],           tradeAt: '2026-05-03 13:20:00', commission: 9.2,  volume: 200,  instrumentType: '现货' },
];

const ALL_ACCOUNTS   = ['Deribit-主账户', 'Binance-策略账户', 'OKX-套利账户'];
const ALL_SYMBOLS    = ['BTC.Opts', 'ETH.Perp', 'BTC.Perp', 'SOL.Opts', 'BNBUSDT', 'ETH.Opts', 'SOLUSDT'];
const ALL_STRATEGIES = ['趋势追踪', '开盘突破', '反转策略', '套利', '波段', '做多', '高胜率', '止损出场'];
const ALL_TYPES      = ['期权', '永续', '现货'];

const MONTH_NAMES  = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_ABBR = ['Su','Mo','Tu','We','Th','Fr','Sa'];

// ==================== 工具函数 ====================

const formatHolding = (m: number) => {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
};

const isToday     = (s: string) => dayjs(s).isSame(dayjs(), 'day');
const isYesterday = (s: string) => dayjs(s).isSame(dayjs().subtract(1, 'day'), 'day');

// ==================== 自定义日历工具 ====================

interface CalCell { date: Date; inMonth: boolean; }

/** 生成某月的 42 格日历数组（6 行 × 7 列，周日起始） */
function buildMonthGrid(year: number, month: number): CalCell[] {
  const firstDow      = new Date(year, month, 1).getDay();       // 0=Sun
  const daysInMonth   = new Date(year, month + 1, 0).getDate();
  const daysInPrev    = new Date(year, month, 0).getDate();
  const cells: CalCell[] = [];

  // 上个月溢出
  for (let i = firstDow - 1; i >= 0; i--)
    cells.push({ date: new Date(year, month - 1, daysInPrev - i), inMonth: false });
  // 当月
  for (let d = 1; d <= daysInMonth; d++)
    cells.push({ date: new Date(year, month, d), inMonth: true });
  // 下个月补齐 42
  for (let d = 1; cells.length < 42; d++)
    cells.push({ date: new Date(year, month + 1, d), inMonth: false });

  return cells;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth()    === b.getMonth()    &&
    a.getDate()     === b.getDate();
}

function isBetween(date: Date, a: Date | null, b: Date | null) {
  if (!a || !b) return false;
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return date > lo && date < hi;
}

// ==================== 自定义范围日历 ====================

const RangeCalendar: React.FC<{
  onSelect: (s: Date, e: Date) => void;
  onClose: () => void;
}> = ({ onSelect, onClose }) => {
  const today = new Date();

  // Left and right panels have fully independent month state
  const [leftYear,  setLeftYear]  = useState(today.getFullYear());
  const [leftMonth, setLeftMonth] = useState(today.getMonth() === 0 ? 11 : today.getMonth() - 1);
  // Initialise right panel to current month (or next after left)
  const [rightYear,  setRightYear]  = useState(today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear());
  const [rightMonth, setRightMonth] = useState(today.getMonth());

  const [phase,  setPhase]  = useState<'start' | 'end'>('start');
  const [rangeS, setRangeS] = useState<Date | null>(null);
  const [rangeE, setRangeE] = useState<Date | null>(null);
  const [hover,  setHover]  = useState<Date | null>(null);

  const handleClick = (date: Date) => {
    if (phase === 'start') {
      setRangeS(date); setRangeE(null); setPhase('end');
    } else {
      let s = rangeS!, e = date;
      if (e < s) [s, e] = [e, s];
      setRangeS(s); setRangeE(e);
      setPhase('start');
      onSelect(s, e);
    }
  };

  // Independent navigators — left and right don't affect each other
  const prevLeft  = () => leftMonth  === 0  ? (setLeftMonth(11),  setLeftYear(y => y - 1))  : setLeftMonth(m => m - 1);
  const nextLeft  = () => leftMonth  === 11 ? (setLeftMonth(0),   setLeftYear(y => y + 1))  : setLeftMonth(m => m + 1);
  const prevRight = () => rightMonth === 0  ? (setRightMonth(11), setRightYear(y => y - 1)) : setRightMonth(m => m - 1);
  const nextRight = () => rightMonth === 11 ? (setRightMonth(0),  setRightYear(y => y + 1)) : setRightMonth(m => m + 1);

  const effEnd = phase === 'end' ? (hover ?? rangeE) : rangeE;

  const renderGrid = (year: number, month: number) => {
    const cells = buildMonthGrid(year, month);
    return (
      <div>
        <div className="grid grid-cols-7 mb-2">
          {WEEKDAY_ABBR.map(d => (
            <div key={d} className="text-center text-[11px] font-bold text-slate-500 py-1 select-none">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-y-0.5">
          {cells.map((cell, i) => {
            const isS      = !!(rangeS && sameDay(cell.date, rangeS));
            const isE      = !!(rangeE && sameDay(cell.date, rangeE));
            const isHov    = !!(phase === 'end' && hover && sameDay(cell.date, hover));
            const inRange  = isBetween(cell.date, rangeS, effEnd ?? null);
            const isTodayC = sameDay(cell.date, today);
            return (
              <button
                key={i}
                onClick={() => handleClick(cell.date)}
                onMouseEnter={() => phase === 'end' && setHover(cell.date)}
                onMouseLeave={() => setHover(null)}
                className={cn(
                  'h-7 w-full rounded-[4px] text-[12px] font-bold transition-colors select-none',
                  (isS || isE)   && 'bg-[#4D7CFF] !text-white font-bold',
                  isHov && !isS && !isE && 'bg-[#4D7CFF]/60 text-white',
                  inRange && !isS && !isE && !isHov && 'bg-[#1a2540] text-[#4D7CFF]',
                  isTodayC && !isS && !isE && 'ring-1 ring-[#4D7CFF]/60',
                  cell.inMonth  && !isS && !isE && !inRange && !isHov && 'text-slate-200 hover:bg-[#1E1E26]',
                  !cell.inMonth && !isS && !isE && !inRange && !isHov && 'text-[#4D7CFF]/40 hover:bg-[#1E1E26] hover:text-[#4D7CFF]/70',
                )}
              >
                {cell.date.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const navBtn = (onClick: () => void, children: React.ReactNode) => (
    <button onClick={onClick} className="p-1.5 rounded-[5px] hover:bg-[#1E1E26] text-slate-400 hover:text-white transition-colors">
      {children}
    </button>
  );

  return (
    <div
      className="bg-[#131318] border border-[#2F2F38] rounded-[10px] shadow-[0_16px_40px_rgba(0,0,0,0.75)] p-4 select-none"
      style={{ width: 580 }}
      onClick={e => e.stopPropagation()}
    >
      {/* 阶段提示 */}
      <div className="flex items-center gap-2 mb-3 px-1 text-[12px]">
        <span className={cn('px-2 py-0.5 rounded-[4px]', phase === 'start' ? 'bg-[#4D7CFF]/20 text-[#4D7CFF] font-bold' : 'text-slate-500')}>
          {rangeS ? `${rangeS.getMonth()+1}/${rangeS.getDate()}` : '选择开始日期'}
        </span>
        <span className="text-slate-600">→</span>
        <span className={cn('px-2 py-0.5 rounded-[4px]', phase === 'end' ? 'bg-[#4D7CFF]/20 text-[#4D7CFF] font-bold' : 'text-slate-500')}>
          {rangeE ? `${rangeE.getMonth()+1}/${rangeE.getDate()}` : '选择结束日期'}
        </span>
        {rangeS && (
          <button onClick={() => { setRangeS(null); setRangeE(null); setPhase('start'); }} className="ml-1 text-slate-600 hover:text-slate-400 transition-colors">
            <X size={12} />
          </button>
        )}
      </div>

      {/* 双月日历 — 独立导航 */}
      <div className="grid grid-cols-2 gap-5 border-t border-[#1E1E26] pt-3">
        {/* 左面板 */}
        <div>
          <div className="flex items-center justify-between mb-2">
            {navBtn(prevLeft, <ChevronLeft size={14} />)}
            <span className="text-[13px] font-bold text-slate-200">{MONTH_NAMES[leftMonth]} {leftYear}</span>
            {navBtn(nextLeft, <ChevronRight size={14} />)}
          </div>
          {renderGrid(leftYear, leftMonth)}
        </div>

        {/* 右面板 */}
        <div className="border-l border-[#1E1E26] pl-5">
          <div className="flex items-center justify-between mb-2">
            {navBtn(prevRight, <ChevronLeft size={14} />)}
            <span className="text-[13px] font-bold text-slate-200">{MONTH_NAMES[rightMonth]} {rightYear}</span>
            {navBtn(nextRight, <ChevronRight size={14} />)}
          </div>
          {renderGrid(rightYear, rightMonth)}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-[#1E1E26]">
        <button onClick={onClose} className="px-3 h-7 rounded-[6px] text-[12px] text-slate-400 hover:text-white hover:bg-[#1E1E26] border border-[#2F2F38] transition-colors">
          取消
        </button>
        <button
          onClick={() => rangeS && rangeE && onSelect(rangeS, rangeE)}
          disabled={!rangeS || !rangeE}
          className="px-3 h-7 rounded-[6px] text-[12px] bg-[#4D7CFF] text-white disabled:opacity-30 hover:bg-[#3d63cc] disabled:cursor-not-allowed transition-colors"
        >
          确认
        </button>
      </div>
    </div>
  );
};

// ==================== 日期筛选器（使用 portal 避免被 overflow-hidden 裁切） ====================

const DateFilter: React.FC<{
  value: 'today' | 'yesterday' | 'custom' | 'all';
  customLabel?: string;
  onChange: (v: 'today' | 'yesterday' | 'custom' | 'all', s?: Date, e?: Date) => void;
}> = ({ value, customLabel, onChange }) => {
  const [open, setOpen] = useState(false);

  const presets = [
    { key: 'today'     as const, label: '今天' },
    { key: 'yesterday' as const, label: '昨天' },
    { key: 'all'       as const, label: '全部' },
  ];

  return (
    <div className="flex items-center gap-1">
      {presets.map(p => (
        <button
          key={p.key}
          onClick={() => onChange(p.key)}
          className={cn(
            'px-2 h-6 rounded-[5px] border text-[13px] font-bold transition-all duration-150',
            value === p.key
              ? 'bg-[#1a2540] border-[#4D7CFF] text-[#4D7CFF]'
              : 'bg-[#131318] border-[#2F2F38] text-slate-300 hover:border-[#4D7CFF] hover:text-white'
          )}
        >
          {p.label}
        </button>
      ))}

      <div className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className={cn(
            'flex items-center gap-1.5 px-2 h-6 rounded-[5px] border text-[13px] font-bold transition-all duration-150',
            value === 'custom'
              ? 'bg-[#1a2540] border-[#4D7CFF] text-[#4D7CFF]'
              : 'bg-[#131318] border-[#2F2F38] text-slate-300 hover:border-[#4D7CFF] hover:text-white'
          )}
        >
          <Calendar size={13} />
          {value === 'custom' && customLabel ? customLabel : '自定义'}
        </button>

        <Popover
          open={open}
          onClose={() => setOpen(false)}
          backdropZ={180}
          panelZ={181}
          panelClassName="absolute top-full left-0 mt-2"
        >
          <RangeCalendar
            onSelect={(s, e) => { onChange('custom', s, e); setOpen(false); }}
            onClose={() => setOpen(false)}
          />
        </Popover>
      </div>
    </div>
  );
};

// ==================== 多选下拉筛选器 ====================

const MultiSelectFilter: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v]);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2 h-6 rounded-[5px] border text-[13px] font-bold transition-all duration-150',
          selected.length > 0
            ? 'bg-[#1a2540] border-[#4D7CFF] text-[#4D7CFF]'
            : 'bg-[#131318] border-[#2F2F38] text-slate-300 hover:border-[#4D7CFF] hover:text-white'
        )}
      >
        {label}
        {selected.length > 0 && (
          <span className="bg-[#4D7CFF] text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
            {selected.length}
          </span>
        )}
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        backdropZ={180}
        panelZ={181}
        panelClassName="absolute top-full left-0 mt-2 min-w-[170px] p-1.5"
      >
        <div className="flex flex-col gap-0.5">
          {options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <button
                key={opt}
                onClick={() => toggle(opt)}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-1.5 rounded-[6px] text-[13px] transition-colors text-left w-full',
                  checked ? 'bg-white/[0.06] text-white' : 'text-white/75 hover:bg-white/[0.06] hover:text-white'
                )}
              >
                <div className={cn(
                  'w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0',
                  checked ? 'bg-[#4D7CFF] border-[#4D7CFF]' : 'border-white/20'
                )}>
                  {checked && <Check size={11} className="text-white" strokeWidth={3} />}
                </div>
                {opt}
              </button>
            );
          })}
          {selected.length > 0 && (
            <>
              <div className="h-px bg-white/10 my-1" />
              <button
                onClick={() => onChange([])}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-[6px] text-[12px] text-white/45 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
              >
                <X size={12} /> 清除选择
              </button>
            </>
          )}
        </div>
      </Popover>
    </div>
  );
};

// ==================== 列管理（拖拽 + 勾选） ====================

const ColumnManager: React.FC<{
  columns: ColumnConfig[];
  onChange: (cols: ColumnConfig[]) => void;
}> = ({ columns, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dragIdx = useRef<number | null>(null);
  const dragOvr = useRef<number | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleDragEnd = () => {
    const from = dragIdx.current, to = dragOvr.current;
    if (from === null || to === null || from === to) return;
    const next = [...columns];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    dragIdx.current = null; dragOvr.current = null;
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 px-2 h-6 rounded-[5px] border text-[13px] font-bold transition-all duration-150',
          open
            ? 'bg-[#1a2540] border-[#4D7CFF] text-[#4D7CFF]'
            : 'bg-[#131318] border-[#2F2F38] text-slate-300 hover:border-[#4D7CFF] hover:text-white'
        )}
      >
        <Columns3 size={14} /> 列管理
      </button>

      <Popover
        open={open}
        onClose={() => setOpen(false)}
        backdropZ={180}
        panelZ={181}
        panelClassName="absolute top-full right-0 mt-2 w-[220px] p-2"
      >
        <div className="text-[11px] font-bold text-white/55 px-2 py-1 tracking-wider">拖拽排序 · 勾选显隐</div>
        <div className="flex flex-col gap-0.5 mt-1">
          {columns.map((col, i) => (
            <div
              key={col.key}
              draggable
              onDragStart={() => { dragIdx.current = i; }}
              onDragEnter={() => { dragOvr.current = i; }}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[6px] hover:bg-white/[0.06] cursor-grab active:cursor-grabbing group transition-colors"
            >
              <GripVertical size={14} className="text-white/35 group-hover:text-white/55 shrink-0" />
              <div
                onClick={() => onChange(columns.map(c => c.key === col.key ? { ...c, visible: !c.visible } : c))}
                className={cn(
                  'w-4 h-4 rounded-[4px] border flex items-center justify-center shrink-0 cursor-pointer',
                  col.visible ? 'bg-[#4D7CFF] border-[#4D7CFF]' : 'border-white/20'
                )}
              >
                {col.visible && <Check size={11} className="text-white" strokeWidth={3} />}
              </div>
              <span
                onClick={() => onChange(columns.map(c => c.key === col.key ? { ...c, visible: !c.visible } : c))}
                className="text-[13px] text-white/75 flex-1 cursor-pointer select-none"
              >
                {col.label}
              </span>
            </div>
          ))}
        </div>
      </Popover>
    </div>
  );
};

// ==================== 图表单元格（粘贴 / 上传 / 预览） ====================

const ImageCell: React.FC<{
  record: TradeRecord;
  onUpdate: (key: string, images: string[]) => void;
}> = ({ record, onUpdate }) => {
  const [focused,      setFocused]      = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgs = record.images ?? [];

  const appendImg = (file: File) => {
    const reader = new FileReader();
    reader.onload = ev => onUpdate(record.key, [...imgs, ev.target!.result as string]);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (!focused) return;
      const imgItem = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      if (!imgItem) return;
      const file = imgItem.getAsFile();
      if (file) appendImg(file);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [focused, imgs, record.key, onUpdate]);

  return (
    <>
      <div
        tabIndex={0}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => imgs.length > 0 ? setPreviewIndex(0) : fileRef.current?.click()}
        className={cn(
          'w-12 h-10 rounded-[6px] overflow-hidden bg-[#17181C] border transition-all cursor-pointer group relative outline-none',
          focused
            ? 'border-[#4D7CFF] shadow-[0_0_0_2px_rgba(77,124,255,0.25)]'
            : 'border-[#2F2F38] hover:border-[#4D7CFF]/60'
        )}
        title={imgs.length > 0 ? '点击预览 / 聚焦后 Ctrl+V 添加截图' : '点击上传 / 聚焦后 Ctrl+V 粘贴截图'}
      >
        {imgs.length > 0 ? (
          <>
            <img src={imgs[0]} alt="chart" className="w-full h-full object-cover" />
            {imgs.length > 1 && (
              <div className="absolute bottom-0 right-0 bg-black/70 text-white text-[9px] font-bold px-1 leading-[14px] rounded-tl-[4px]">
                +{imgs.length - 1}
              </div>
            )}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <Eye size={14} className="text-white" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center relative">
            <span className={cn(
              'text-[14px] font-bold transition-opacity',
              focused ? 'opacity-0' : 'opacity-100',
              record.status === '盈利' ? 'text-emerald-400/70' : 'text-rose-400/70'
            )}>
              {record.status === '盈利' ? '↗' : '↘'}
            </span>
            {focused && (
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-bold text-[#4D7CFF] text-center leading-tight pointer-events-none">
                粘贴<br />截图
              </span>
            )}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/50 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
              <Upload size={12} className="text-white" />
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          const files = Array.from(e.target.files ?? []) as File[];
          let pending = files.length;
          const newUrls: string[] = [];
          files.forEach(f => {
            const reader = new FileReader();
            reader.onload = ev => {
              newUrls.push(ev.target!.result as string);
              if (--pending === 0) onUpdate(record.key, [...imgs, ...newUrls]);
            };
            reader.readAsDataURL(f);
          });
          e.target.value = '';
        }}
      />

      {/* 大图预览（支持左右切换） */}
      {previewIndex !== null && imgs.length > 0 && (
        <Modal
          open={true}
          onClose={() => setPreviewIndex(null)}
          zIndex={400}
          className="bg-transparent border-0"
          style={{ background: 'transparent', border: 'none', boxShadow: 'none' }}
        >
          <div className="relative flex items-center gap-4">
            {imgs.length > 1 && (
              <button
                onClick={() => setPreviewIndex(i => ((i ?? 0) - 1 + imgs.length) % imgs.length)}
                className="w-8 h-8 bg-white/[0.06] border border-white/10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
            )}
            <div className="relative">
              <img
                src={imgs[previewIndex]}
                alt="preview"
                className="max-w-[82vw] max-h-[82vh] rounded-[10px] shadow-[0_18px_60px_rgba(0,0,0,0.85)]"
              />
              {imgs.length > 1 && (
                <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
                  {imgs.map((_, i) => (
                    <div key={i} className={cn('w-1.5 h-1.5 rounded-full transition-colors', i === previewIndex ? 'bg-white' : 'bg-white/30')} />
                  ))}
                </div>
              )}
              <button
                onClick={() => setPreviewIndex(null)}
                className="absolute -top-3 -right-3 w-7 h-7 bg-white/[0.06] border border-white/10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            {imgs.length > 1 && (
              <button
                onClick={() => setPreviewIndex(i => ((i ?? 0) + 1) % imgs.length)}
                className="w-8 h-8 bg-white/[0.06] border border-white/10 rounded-full flex items-center justify-center text-white/60 hover:text-white transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
};

// ==================== 编辑交易记录中央弹出卡片 ====================

const EditTradeModal: React.FC<{
  record: TradeRecord;
  onClose: () => void;
  onSave: (record: TradeRecord) => void;
  onDelete: (key: string) => void;
}> = ({ record, onClose, onSave, onDelete }) => {
  const [form, setForm] = useState({
    symbol: record.symbol,
    account: record.account,
    instrumentType: record.instrumentType,
    status: record.status as '盈利' | '亏损',
    netPnl: String(record.netPnl),
    volume: String(record.volume),
    commission: String(record.commission),
    openAt: record.openAt.replace(' ', 'T').slice(0, 16),
    closeAt: record.closeAt.replace(' ', 'T').slice(0, 16),
    tradeAt: record.tradeAt.replace(' ', 'T').slice(0, 16),
    tags: [...record.tags],
    notes: record.notes ?? '',
    images: record.images ? [...record.images] : [] as string[],
  });
  const [tagInput, setTagInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upd = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const calcHolding = (open: string, close: string) => {
    const o = new Date(open), c = new Date(close);
    if (isNaN(o.getTime()) || isNaN(c.getTime()) || c <= o) return null;
    return Math.round((c.getTime() - o.getTime()) / 60000);
  };
  const holdingMins = calcHolding(form.openAt, form.closeAt);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) { upd('tags', [...form.tags, t]); setTagInput(''); }
  };

  const handleImg = (file: File) => {
    const r = new FileReader();
    r.onload = e => upd('images', [...form.images, e.target!.result as string]);
    r.readAsDataURL(file);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      if (img) { const f = img.getAsFile(); if (f) handleImg(f); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [form.images]);

  const ic = "w-full h-9 px-3 bg-[#17181C] border border-[#2F2F38] rounded-[7px] text-[13px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-[#4D7CFF] transition-colors";
  const lc = "block text-[12px] font-bold text-slate-400 mb-1";

  return (
    <Modal
      open={true}
      onClose={onClose}
      zIndex={200}
      className="relative w-[480px] max-h-[75vh] flex flex-col"
      style={{ background: '#131318', border: '1px solid #2A2A35' }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#2A2A35] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-[7px] bg-[#1a2540] flex items-center justify-center">
              <Pencil size={13} className="text-[#4D7CFF]" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-slate-100 leading-tight">编辑交易记录</h2>
              <p className="text-[11px] text-slate-500 font-mono leading-tight">{record.symbol} · {record.account}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-[6px] text-slate-500 hover:text-white hover:bg-[#1E1E26] transition-colors">
            <X size={15} />
          </button>
        </div>

        {/* Body — 可滚动 */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* 图片上传区（多图） */}
          <div className="mb-4">
            <label className={lc}>交易截图</label>
            <div className="flex flex-wrap gap-2">
              {form.images.map((src, i) => (
                <div key={i} className="relative w-16 h-14 rounded-[6px] overflow-hidden group shrink-0">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => upd('images', form.images.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={9} className="text-white" />
                  </button>
                </div>
              ))}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); (Array.from(e.dataTransfer.files) as File[]).filter(f => f.type.startsWith('image/')).forEach(handleImg); }}
                className="w-16 h-14 bg-[#17181C] border border-dashed border-[#2F2F38] rounded-[6px] flex flex-col items-center justify-center cursor-pointer hover:border-[#4D7CFF]/50 transition-colors group shrink-0"
              >
                <Plus size={14} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                <span className="text-[9px] text-slate-600 group-hover:text-slate-400 transition-colors mt-0.5">添加</span>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { Array.from(e.target.files ?? []).forEach(handleImg); e.target.value = ''; }} />
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={lc}>品种代码 <span className="text-rose-400">*</span></label>
              <input value={form.symbol} onChange={e => upd('symbol', e.target.value)} placeholder="BTC.Opts" className={ic} />
            </div>
            <div>
              <label className={lc}>账户 <span className="text-rose-400">*</span></label>
              <input value={form.account} onChange={e => upd('account', e.target.value)} placeholder="Deribit-主账户" className={ic} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={lc}>品种类型</label>
              <select value={form.instrumentType} onChange={e => upd('instrumentType', e.target.value)} className={cn(ic, 'cursor-pointer')}>
                {['期权','永续','现货','期货'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lc}>状态</label>
              <select value={form.status} onChange={e => upd('status', e.target.value as '盈利'|'亏损')} className={cn(ic, 'cursor-pointer')}>
                <option value="盈利">盈利</option>
                <option value="亏损">亏损</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={lc}>净盈亏 (USD)</label>
              <input type="number" value={form.netPnl} onChange={e => upd('netPnl', e.target.value)} placeholder="0.00" className={ic} />
            </div>
            <div>
              <label className={lc}>交易量</label>
              <input type="number" value={form.volume} onChange={e => upd('volume', e.target.value)} placeholder="0" className={ic} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={lc}>开仓时间</label>
              <input type="datetime-local" value={form.openAt} onChange={e => upd('openAt', e.target.value)} className={ic} style={{ colorScheme: 'dark' }} />
            </div>
            <div>
              <label className={lc}>平仓时间</label>
              <input type="datetime-local" value={form.closeAt} onChange={e => upd('closeAt', e.target.value)} className={ic} style={{ colorScheme: 'dark' }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className={lc}>持仓时长（自动计算）</label>
              <div className={cn(ic, 'flex items-center text-slate-500 cursor-default select-none')}>
                {holdingMins !== null ? formatHolding(holdingMins) : '—'}
              </div>
            </div>
            <div>
              <label className={lc}>手续费 (USD)</label>
              <input type="number" value={form.commission} onChange={e => upd('commission', e.target.value)} placeholder="0.00" className={ic} />
            </div>
          </div>

          <div className="mb-3">
            <label className={lc}>交易时间</label>
            <input type="datetime-local" value={form.tradeAt} onChange={e => upd('tradeAt', e.target.value)} className={ic} style={{ colorScheme: 'dark' }} />
          </div>

          <div>
            <label className={lc}>策略标签</label>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.tags.map(t => (
                  <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-[#1a2540] border border-[#2a3a5a] text-[#4D7CFF] text-[11px] rounded-[4px]">
                    {t}
                    <button onClick={() => upd('tags', form.tags.filter(x => x !== t))} className="hover:text-white transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="输入标签回车添加"
                className={cn(ic, 'flex-1')}
              />
              <button onClick={addTag} className="px-3 h-9 bg-[#1a2540] border border-[#2a3a5a] rounded-[7px] text-[#4D7CFF] hover:bg-[#1E2D50] transition-colors text-[12px] shrink-0">
                添加
              </button>
            </div>
          </div>

          <div className="mt-3">
            <label className={lc}>备注</label>
            <textarea
              value={form.notes}
              onChange={e => upd('notes', e.target.value)}
              placeholder="记录交易思路、复盘心得..."
              rows={3}
              className={cn(ic, 'h-auto py-2 resize-none leading-relaxed')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-[#2A2A35] flex items-center gap-2 shrink-0">
          <button
            onClick={() => { onDelete(record.key); onClose(); }}
            className="flex items-center gap-1.5 px-3 h-8 rounded-[7px] border border-[#2A2A35] text-[12px] text-rose-500/70 hover:text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/5 transition-colors shrink-0"
          >
            <Trash2 size={13} /> 删除
          </button>
          <div className="flex-1" />
          <button onClick={onClose} className="px-4 h-8 rounded-[7px] border border-[#2A2A35] text-[13px] text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
            取消
          </button>
          <button
            onClick={() => {
              if (!form.symbol || !form.account) return;
              onSave({
                ...record,
                symbol: form.symbol,
                account: form.account,
                instrumentType: form.instrumentType,
                status: form.status,
                netPnl: parseFloat(form.netPnl) || 0,
                volume: parseFloat(form.volume) || 0,
                commission: parseFloat(form.commission) || 0,
                openAt: form.openAt.replace('T', ' ') + ':00',
                closeAt: form.closeAt.replace('T', ' ') + ':00',
                holdingMinutes: holdingMins ?? 0,
                tradeAt: form.openAt.replace('T', ' ') + ':00',
                tags: form.tags,
                notes: form.notes || undefined,
                images: form.images.length > 0 ? form.images : undefined,
              });
            }}
            disabled={!form.symbol || !form.account}
            className="px-4 h-8 rounded-[7px] bg-[#4D7CFF] text-white text-[13px] font-bold disabled:opacity-40 hover:bg-[#3d63cc] disabled:cursor-not-allowed transition-colors shadow-[0_0_12px_rgba(77,124,255,0.25)]"
          >
            保存修改
          </button>
        </div>
    </Modal>
  );
};

// ==================== 批量添加标签 Modal ====================

const AddTagModal: React.FC<{
  count: number;
  onConfirm: (tag: string) => void;
  onClose: () => void;
}> = ({ count, onConfirm, onClose }) => {
  const [value, setValue] = useState('');
  const SUGGESTIONS = ['趋势追踪', '开盘突破', '反转策略', '套利', '波段', '做多', '高胜率', '止损出场'];

  return (
    <Modal
      open={true}
      onClose={onClose}
      zIndex={200}
      className="w-[340px] p-5"
      style={{ background: '#131318', border: '1px solid #2F2F38', boxShadow: '0 16px 40px rgba(0,0,0,0.7)' }}
    >
        <h3 className="text-[15px] font-bold text-slate-100 mb-0.5">批量添加标签</h3>
        <p className="text-[12px] text-slate-500 mb-4">将为选中的 {count} 条记录添加此标签</p>

        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && value.trim() && onConfirm(value.trim())}
          placeholder="输入标签名称..."
          className="w-full h-9 px-3 bg-[#1E1E26] border border-[#2F2F38] rounded-[7px] text-[13px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-[#4D7CFF] transition-colors mb-3"
        />

        <div className="flex flex-wrap gap-1.5 mb-4">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              onClick={() => setValue(s)}
              className={cn(
                'px-2 py-0.5 rounded-[4px] text-[11px] border transition-colors',
                value === s
                  ? 'bg-[#1a2540] border-[#4D7CFF] text-[#4D7CFF]'
                  : 'bg-[#1E1E26] border-[#2F2F38] text-slate-400 hover:border-[#4D7CFF]/50 hover:text-slate-200'
              )}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 h-8 rounded-[7px] text-[13px] text-slate-400 hover:text-white hover:bg-[#1E1E26] border border-[#2F2F38] transition-colors">
            取消
          </button>
          <button
            onClick={() => value.trim() && onConfirm(value.trim())}
            disabled={!value.trim()}
            className="px-4 h-8 rounded-[7px] text-[13px] bg-[#4D7CFF] text-white disabled:opacity-40 hover:bg-[#3d63cc] transition-colors"
          >
            确认添加
          </button>
        </div>
    </Modal>
  );
};

// ==================== 添加交易抽屉 ====================

const AddTradeDrawer: React.FC<{
  mode?: 'add' | 'edit';
  initialRecord?: TradeRecord | null;
  onClose: () => void;
  onSave: (record: Omit<TradeRecord, 'key'>) => void;
}> = ({ mode = 'add', initialRecord = null, onClose, onSave }) => {
  const isEdit = mode === 'edit' && !!initialRecord;
  const [form, setForm] = useState(() => ({
    symbol: initialRecord?.symbol ?? '',
    account: initialRecord?.account ?? '',
    instrumentType: initialRecord?.instrumentType ?? '期权',
    status: (initialRecord?.status ?? '盈利') as '盈利' | '亏损',
    netPnl: initialRecord ? String(initialRecord.netPnl) : '',
    volume: initialRecord ? String(initialRecord.volume) : '',
    commission: initialRecord ? String(initialRecord.commission) : '',
    openAt: initialRecord
      ? initialRecord.openAt.replace(' ', 'T').slice(0, 16)
      : new Date().toISOString().slice(0, 16),
    closeAt: initialRecord
      ? initialRecord.closeAt.replace(' ', 'T').slice(0, 16)
      : '',
    tags: initialRecord?.tags ?? ([] as string[]),
    notes: initialRecord?.notes ?? '',
    images: initialRecord?.images ? [...initialRecord.images] : [] as string[],
  }));
  const [tagInput, setTagInput] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const upd = (k: string, v: any) => setForm(f => ({ ...f, [k]: v }));

  const calcHolding = (open: string, close: string) => {
    const o = new Date(open), c = new Date(close);
    if (isNaN(o.getTime()) || isNaN(c.getTime()) || c <= o) return null;
    return Math.round((c.getTime() - o.getTime()) / 60000);
  };
  const holdingMins = calcHolding(form.openAt, form.closeAt);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) { upd('tags', [...form.tags, t]); setTagInput(''); }
  };

  const handleImg = (file: File) => {
    const r = new FileReader();
    r.onload = e => upd('images', [...form.images, e.target!.result as string]);
    r.readAsDataURL(file);
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const img = Array.from(e.clipboardData?.items ?? []).find(i => i.type.startsWith('image/'));
      if (img) { const f = img.getAsFile(); if (f) handleImg(f); }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [form.images]);

  const ic = "w-full h-9 px-3 bg-[#1E1E26] border border-[#2F2F38] rounded-[7px] text-[13px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-[#4D7CFF] transition-colors";
  const lc = "block text-[12px] font-bold text-slate-400 mb-1";

  return (
    <Drawer
      open={true}
      onClose={onClose}
      zIndex={120}
      width={360}
      className="flex flex-col overflow-hidden"
      style={{
        top: 64,
        bottom: 40,
        right: 12,
        borderRadius: 14,
      }}
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#2F2F38] shrink-0">
          <h2 className="text-[15px] font-bold text-slate-100">
            {isEdit ? '编辑交易记录' : '添加交易记录'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-[6px] text-slate-400 hover:text-white hover:bg-[#1E1E26] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* 图片上传区（多图） */}
          <div>
            <label className={lc}>交易截图</label>
            <div className="flex flex-wrap gap-2">
              {form.images.map((src, i) => (
                <div key={i} className="relative w-20 h-16 rounded-[6px] overflow-hidden group shrink-0">
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => upd('images', form.images.filter((_, j) => j !== i))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 bg-black/70 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X size={9} className="text-white" />
                  </button>
                </div>
              ))}
              <div
                onClick={() => fileRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); (Array.from(e.dataTransfer.files) as File[]).filter(f => f.type.startsWith('image/')).forEach(handleImg); }}
                className="w-20 h-16 bg-[#1E1E26] border-2 border-dashed border-[#2F2F38] rounded-[6px] flex flex-col items-center justify-center cursor-pointer hover:border-[#4D7CFF]/50 transition-colors group shrink-0"
              >
                <Plus size={16} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                <span className="text-[10px] text-slate-600 group-hover:text-slate-400 transition-colors mt-1">添加截图</span>
              </div>
            </div>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden"
              onChange={e => { Array.from(e.target.files ?? []).forEach(handleImg); e.target.value = ''; }} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>品种代码 <span className="text-rose-400">*</span></label>
              <input value={form.symbol} onChange={e => upd('symbol', e.target.value)} placeholder="BTC.Opts" className={ic} />
            </div>
            <div>
              <label className={lc}>账户 <span className="text-rose-400">*</span></label>
              <input value={form.account} onChange={e => upd('account', e.target.value)} placeholder="Deribit-主账户" className={ic} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>品种类型</label>
              <select value={form.instrumentType} onChange={e => upd('instrumentType', e.target.value)}
                className={cn(ic, 'cursor-pointer')}>
                {['期权','永续','现货','期货'].map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={lc}>状态</label>
              <select value={form.status} onChange={e => upd('status', e.target.value as '盈利'|'亏损')}
                className={cn(ic, 'cursor-pointer')}>
                <option value="盈利">盈利</option>
                <option value="亏损">亏损</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>净盈亏 (USD)</label>
              <input type="number" value={form.netPnl} onChange={e => upd('netPnl', e.target.value)} placeholder="0.00" className={ic} />
            </div>
            <div>
              <label className={lc}>交易量</label>
              <input type="number" value={form.volume} onChange={e => upd('volume', e.target.value)} placeholder="0" className={ic} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>开仓时间</label>
              <input type="datetime-local" value={form.openAt} onChange={e => upd('openAt', e.target.value)} className={ic} style={{ colorScheme: 'dark' }} />
            </div>
            <div>
              <label className={lc}>平仓时间</label>
              <input type="datetime-local" value={form.closeAt} onChange={e => upd('closeAt', e.target.value)} className={ic} style={{ colorScheme: 'dark' }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lc}>持仓时长（自动计算）</label>
              <div className={cn(ic, 'flex items-center text-slate-500 cursor-default select-none')}>
                {holdingMins !== null ? formatHolding(holdingMins) : '—'}
              </div>
            </div>
            <div>
              <label className={lc}>手续费 (USD)</label>
              <input type="number" value={form.commission} onChange={e => upd('commission', e.target.value)} placeholder="0.00" className={ic} />
            </div>
          </div>

          <div>
            <label className={lc}>策略标签</label>
            {form.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {form.tags.map(t => (
                  <span key={t} className="flex items-center gap-1 px-2 py-0.5 bg-[#1a2540] border border-[#2a3a5a] text-[#4D7CFF] text-[11px] rounded-[4px]">
                    {t}
                    <button onClick={() => upd('tags', form.tags.filter(x => x !== t))} className="hover:text-white transition-colors">
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addTag()}
                placeholder="输入标签回车添加"
                className={cn(ic, 'flex-1')}
              />
              <button onClick={addTag} className="px-3 h-9 bg-[#1a2540] border border-[#2a3a5a] rounded-[7px] text-[#4D7CFF] hover:bg-[#1E2D50] transition-colors text-[12px] shrink-0">
                添加
              </button>
            </div>
          </div>

          <div>
            <label className={lc}>备注</label>
            <textarea
              value={form.notes}
              onChange={e => upd('notes', e.target.value)}
              placeholder="记录交易思路、复盘心得..."
              rows={3}
              className={cn(ic, 'h-auto py-2 resize-none leading-relaxed')}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#2F2F38] flex gap-3 shrink-0">
          <button onClick={onClose} className="flex-1 h-9 rounded-[7px] border border-[#2F2F38] text-[13px] text-slate-400 hover:text-white hover:border-slate-500 transition-colors">
            取消
          </button>
          <button
            onClick={() => {
              if (!form.symbol || !form.account) return;
              onSave({
                account: form.account, symbol: form.symbol,
                instrumentType: form.instrumentType, status: form.status,
                netPnl: parseFloat(form.netPnl) || 0,
                volume: parseFloat(form.volume) || 0,
                commission: parseFloat(form.commission) || 0,
                openAt: form.openAt.replace('T', ' ') + ':00',
                closeAt: form.closeAt ? form.closeAt.replace('T', ' ') + ':00' : form.openAt.replace('T', ' ') + ':00',
                holdingMinutes: holdingMins ?? 0,
                tradeAt: form.openAt.replace('T', ' ') + ':00',
                tags: form.tags,
                notes: form.notes || undefined,
                images: form.images.length > 0 ? form.images : undefined,
              });
            }}
            disabled={!form.symbol || !form.account}
            className="flex-1 h-9 rounded-[7px] bg-[#4D7CFF] text-white text-[13px] font-bold disabled:opacity-40 hover:bg-[#3d63cc] disabled:cursor-not-allowed transition-colors"
          >
            {isEdit ? '保存修改' : '保存记录'}
          </button>
        </div>
    </Drawer>
  );
};

// ==================== 行内编辑单元格 ====================

/** Click to edit a numeric field inline */
const InlineNumberCell: React.FC<{ value: number; onSave: (v: number) => void }> = ({ value, onSave }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    const n = parseFloat(draft);
    if (!isNaN(n)) onSave(n);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-[72px] h-6 bg-[#1E1E26] border border-[#4D7CFF] rounded-[4px] text-[12px] font-mono text-slate-200 px-1.5 outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      className="flex items-center gap-1 group text-left"
      title="点击编辑"
    >
      <span className="font-mono text-[13px] text-slate-300">{value}</span>
      <Pencil size={11} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

/** Click to edit a datetime string inline */
const InlineDateCell: React.FC<{ value: string; onSave: (v: string) => void }> = ({ value, onSave }) => {
  const [editing, setEditing] = useState(false);
  // datetime-local expects "YYYY-MM-DDTHH:mm"
  const toInputVal = (s: string) => s.slice(0, 16).replace(' ', 'T');
  const [draft, setDraft] = useState(toInputVal(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = () => {
    if (draft) onSave(draft.replace('T', ' ') + ':00');
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="datetime-local"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="h-6 bg-[#1E1E26] border border-[#4D7CFF] rounded-[4px] text-[12px] font-mono text-slate-200 px-1.5 outline-none"
        style={{ colorScheme: 'dark' }}
      />
    );
  }

  return (
    <button
      onClick={() => { setDraft(toInputVal(value)); setEditing(true); }}
      className="flex items-center gap-1 group text-left"
      title="点击编辑"
    >
      <span className="font-mono text-[12px] text-slate-400">{value}</span>
      <Pencil size={11} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
};

// ==================== 列配置初始值 ====================

const INITIAL_COLUMNS: ColumnConfig[] = [
  { key: 'image',          label: '图表',   visible: true },
  { key: 'account',        label: '账户',   visible: true },
  { key: 'symbol',         label: '代码',   visible: true },
  { key: 'instrumentType', label: '品种',   visible: true },
  { key: 'status',         label: '状态',   visible: true },
  { key: 'holdingMinutes', label: '持仓时长', visible: true },
  { key: 'netPnl',         label: '净盈亏', visible: true },
  { key: 'volume',         label: '交易量', visible: true },
  { key: 'commission',     label: '手续费', visible: true },
  { key: 'tags',           label: '策略标签', visible: true },
  { key: 'notes',          label: '备注',   visible: true },
  { key: 'tradeAt',        label: '交易时间', visible: true },
];

// ==================== 主页面 ====================

export default function TradeLogPage() {
  // 可变数据（支持图片更新 + 新增）
  const [tradeData, setTradeData] = useState<TradeRecord[]>(INITIAL_TRADE_DATA);

  // 筛选状态
  const [dateFilter,    setDateFilter]    = useState<'today'|'yesterday'|'custom'|'all'>('all');
  const [customRange,   setCustomRange]   = useState<[Date, Date] | null>(null);
  const [customLabel,   setCustomLabel]   = useState('');
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [symbolFilter,  setSymbolFilter]  = useState<string[]>([]);
  const [strategyFilter,setStrategyFilter]= useState<string[]>([]);
  const [typeFilter,    setTypeFilter]    = useState<string[]>([]);
  const [searchText,    setSearchText]    = useState('');

  // 批量管理
  const [batchMode,       setBatchMode]       = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [showTagModal,    setShowTagModal]    = useState(false);

  // 列配置
  const [columnConfigs, setColumnConfigs] = useState<ColumnConfig[]>(INITIAL_COLUMNS);

  // 侧边抽屉（新增）
  const [showDrawer, setShowDrawer] = useState(false);
  // 中央弹出卡片（编辑）
  const [editModalRecord, setEditModalRecord] = useState<TradeRecord | null>(null);

  // 表格容器高度（ResizeObserver 测量，供 scroll.y 使用）
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const [tableBodyH, setTableBodyH] = useState(400);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // 减去 thead 高度（约 40px）
      setTableBodyH(Math.max(100, el.clientHeight - 40));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 关闭批量模式时清空勾选
  useEffect(() => { if (!batchMode) setSelectedRowKeys([]); }, [batchMode]);

  // 图片更新回调（稳定引用）
  const handleImageUpdate = useCallback((key: string, images: string[]) => {
    setTradeData(prev => prev.map(t => t.key === key ? { ...t, images } : t));
  }, []);

  // 数据过滤
  const filteredData = tradeData.filter(t => {
    if (dateFilter === 'today'     && !isToday(t.tradeAt))     return false;
    if (dateFilter === 'yesterday' && !isYesterday(t.tradeAt)) return false;
    if (dateFilter === 'custom' && customRange) {
      const d = dayjs(t.tradeAt);
      if (d.isBefore(dayjs(customRange[0]), 'day') || d.isAfter(dayjs(customRange[1]), 'day')) return false;
    }
    if (accountFilter.length  > 0 && !accountFilter.includes(t.account))                    return false;
    if (symbolFilter.length   > 0 && !symbolFilter.includes(t.symbol))                      return false;
    if (strategyFilter.length > 0 && !strategyFilter.every(s => t.tags.includes(s)))        return false;
    if (typeFilter.length     > 0 && !typeFilter.includes(t.instrumentType))                 return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      if (!t.symbol.toLowerCase().includes(q) &&
          !t.account.toLowerCase().includes(q) &&
          !t.tags.some(tag => tag.toLowerCase().includes(q))) return false;
    }
    return true;
  });

  // 统计
  const totalPnl = filteredData.reduce((s, t) => s + t.netPnl, 0);
  const winRate  = filteredData.length > 0
    ? ((filteredData.filter(t => t.status === '盈利').length / filteredData.length) * 100).toFixed(1)
    : '0.0';

  // 构建列定义
  const buildColumns = useCallback((): TableColumnsType<TradeRecord> => {
    const T = (label: string) => (
      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-white/45 tracking-wide">
        {label}
      </span>
    );

    const RowActions = ({ record }: { record: TradeRecord }) => {
      const [open, setOpen] = useState(false);
      const btnRef = useRef<HTMLButtonElement>(null);
      const [pos, setPos] = useState({ top: 0, left: 0 });

      const close = () => setOpen(false);
      const toggle = () => {
        const r = btnRef.current?.getBoundingClientRect();
        if (r) {
          const w = 168;
          const left = Math.min(window.innerWidth - w - 12, Math.max(12, r.right - w));
          setPos({ top: r.bottom + 8, left });
        }
        setOpen(o => !o);
      };

      return (
        <div className="relative flex items-center justify-end">
          <button
            ref={btnRef}
            onClick={(e) => { e.stopPropagation(); toggle(); }}
            className="tl-actions opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-[8px] border border-white/10 bg-white/[0.02] hover:bg-white/[0.06] text-white/60 hover:text-white flex items-center justify-center"
            title="更多"
          >
            <span className="text-[16px] leading-none">⋯</span>
          </button>

          <Popover
            open={open}
            onClose={close}
            backdropZ={260}
            panelZ={261}
            panelClassName="fixed w-[168px] p-1.5"
            panelStyle={{ top: pos.top, left: pos.left }}
          >
            <div className="flex flex-col gap-0.5">
              <button
                className="tl-menu-item"
                onClick={(e) => { e.stopPropagation(); close(); setEditModalRecord(record); }}
              >
                <Pencil size={14} /> 编辑
              </button>
              <button
                className="tl-menu-item"
                onClick={(e) => { e.stopPropagation(); close(); setSelectedRowKeys([record.key]); setBatchMode(true); setShowTagModal(true); }}
              >
                <Tag size={14} /> 添加标签
              </button>
              <div className="h-px bg-white/10 my-1" />
              <button
                className="tl-menu-item tl-danger"
                onClick={(e) => { e.stopPropagation(); close(); setTradeData(prev => prev.filter(t => t.key !== record.key)); }}
              >
                <Trash2 size={14} /> 删除
              </button>
            </div>
          </Popover>
        </div>
      );
    };
    const colMap: Record<string, TableColumnsType<TradeRecord>[number]> = {
      image: {
        title: T('图表'), key: 'image', width: 72,
        render: (_: any, record: TradeRecord) => (
          <ImageCell record={record} onUpdate={handleImageUpdate} />
        ),
      },
      account: {
        title: T('账户'), dataIndex: 'account', key: 'account', width: 160,
        render: (v: string) => (
          <span className="inline-block px-2.5 py-1 rounded-[8px] bg-white/[0.03] border border-white/10 text-white/75 text-[12px] font-semibold transition-colors duration-150 hover:bg-white/[0.06] hover:text-white cursor-default">
            {v}
          </span>
        ),
      },
      symbol: {
        title: T('代码'), dataIndex: 'symbol', key: 'symbol', width: 110,
        render: (v: string) => <span className="font-mono font-semibold text-[13px] text-white">{v}</span>,
      },
      instrumentType: {
        title: T('品种'), dataIndex: 'instrumentType', key: 'instrumentType', width: 80,
        render: (v: string) => (
          <span className="px-2 py-0.5 rounded-[6px] bg-white/[0.02] border border-white/10 text-white/55 text-[12px] font-semibold">{v}</span>
        ),
      },
      status: {
        title: T('状态'), dataIndex: 'status', key: 'status', width: 80,
        render: (v: '盈利'|'亏损') => (
          <span className={cn(
            'px-2 py-0.5 rounded-[6px] text-[12px] font-semibold border',
            v === '盈利' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
          )}>{v}</span>
        ),
      },
      holdingMinutes: {
        title: T('持仓时长'), dataIndex: 'holdingMinutes', key: 'holdingMinutes', width: 100,
        render: (v: number) => <span className="font-mono tnum font-semibold text-[13px] text-white/70">{formatHolding(v)}</span>,
      },
      netPnl: {
        title: T('净盈亏'), dataIndex: 'netPnl', key: 'netPnl', width: 120,
        sorter: (a: TradeRecord, b: TradeRecord) => a.netPnl - b.netPnl,
        render: (v: number) => (
          <span className={cn('font-mono tnum font-bold text-[13px]', v >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {v >= 0 ? '+' : ''}{v.toFixed(2)}
          </span>
        ),
      },
      volume: {
        title: T('交易量'), dataIndex: 'volume', key: 'volume', width: 100,
        render: (v: number) => <span className="font-mono tnum font-semibold text-[13px] text-white/70">{v}</span>,
      },
      commission: {
        title: T('手续费'), dataIndex: 'commission', key: 'commission', width: 90,
        render: (v: number) => <span className="font-mono tnum font-semibold text-[13px] text-white/55">${v.toFixed(2)}</span>,
      },
      tags: {
        title: T('策略标签'), dataIndex: 'tags', key: 'tags', width: 220,
        render: (tags: string[]) => (
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <span key={tag} className="px-2 py-[2px] rounded-full border border-white/10 bg-white/[0.02] text-white/70 text-[12px] font-semibold leading-tight">
                {tag}
              </span>
            ))}
          </div>
        ),
      },
      tradeAt: {
        title: T('交易时间'), dataIndex: 'tradeAt', key: 'tradeAt', width: 180,
        render: (v: string) => <span className="font-mono font-semibold text-[12px] text-white/55">{v}</span>,
      },
      notes: {
        title: T('备注'), dataIndex: 'notes', key: 'notes', width: 200,
        render: (v: string) => v
          ? <span className="text-[12px] font-medium text-white/55 line-clamp-2 leading-snug">{v}</span>
          : <span className="text-[12px] font-medium text-white/25">—</span>,
      },
      actions: {
        title: <span className="sr-only">操作</span>,
        key: 'actions',
        width: 56,
        fixed: 'right',
        render: (_: any, record: TradeRecord) => <RowActions record={record} />,
      },
    };

    const visibleCols = columnConfigs.filter(c => c.visible).map(c => colMap[c.key]).filter(Boolean);
    // 行内操作列永远保留在最后（不参与列管理）
    visibleCols.push(colMap.actions);

    return visibleCols;
  }, [columnConfigs, handleImageUpdate, setTradeData]);

  const tableColumns = buildColumns();

  const hasFilters = accountFilter.length > 0 || symbolFilter.length > 0 ||
    strategyFilter.length > 0 || typeFilter.length > 0 || dateFilter !== 'all';

  const clearFilters = () => {
    setDateFilter('all'); setCustomRange(null); setCustomLabel('');
    setAccountFilter([]); setSymbolFilter([]); setStrategyFilter([]); setTypeFilter([]);
  };

  return (
    <ConfigProvider
      theme={{
        token: {
          colorBgContainer: '#131318',
          colorBgElevated: '#1E1E26',
          colorBorder: '#2F2F38',
          colorText: '#CBD5E1',
          colorTextHeading: '#F1F5F9',
          colorPrimary: '#4D7CFF',
          colorBgLayout: '#17181C',
          borderRadius: 8,
          fontFamily: 'inherit',
        },
        components: {
          Table: {
            headerBg: '#0A0A0D',
            headerColor: '#64748B',
            rowHoverBg: '#1a1a22',
            borderColor: '#1E1E26',
            cellPaddingBlock: 12,
            cellPaddingInline: 16,
            colorBgContainer: '#131318',
          },
          Checkbox: {
            colorPrimary: '#4D7CFF',
            colorBorder: '#3F3F50',
          },
        },
      }}
    >
      {/* 主容器：透明，露出 main 的深灰色；ElasticLayout 内部上下留出可拉伸/静态间隔（深灰），
          中间内容（header 与 table 区域）使用主题黑 */}
      <div className="absolute inset-0">
        <ElasticLayout
          restGap={4}
          header={
            <div className="flex flex-col gap-3 px-2 pt-2 pb-0 bg-[#0A0A0D]">
              {/* ── 顶部：标题 + 主操作（专业报表风格） ── */}
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-baseline gap-3">
                    <h1 className="text-[16px] font-bold text-slate-100 tracking-tight">交易日志</h1>
                    <span className="text-[12px] text-slate-500 font-mono">共 {filteredData.length} 条</span>
                  </div>
                  <div className="mt-1 text-[12px] text-slate-600">
                    专业报表视图 · 支持筛选、批量管理与行内编辑
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setBatchMode(b => !b)}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 h-8 rounded-[8px] border text-[13px] font-bold transition-all duration-150',
                      batchMode
                        ? 'bg-white/[0.06] border-white/20 text-white'
                        : 'bg-[#131318] border-[#2F2F38] text-slate-300 hover:border-white/20 hover:text-white'
                    )}
                  >
                    {batchMode ? <CheckSquare size={14} /> : <Square size={14} />}
                    批量
                  </button>
                  <ColumnManager columns={columnConfigs} onChange={setColumnConfigs} />
                  <button
                    onClick={() => setShowDrawer(true)}
                    className="flex items-center gap-1.5 px-3.5 h-8 rounded-[8px] bg-[#4D7CFF] hover:bg-[#3d63cc] text-white text-[13px] font-bold transition-colors"
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
              </div>

              {/* ── 摘要 KPI（弱强调、小卡片） ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="rounded-[10px] border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="text-[11px] text-white/45 font-bold">胜率</div>
                  <div className="text-[15px] font-mono font-bold text-white/90 mt-0.5">{winRate}%</div>
                </div>
                <div className="rounded-[10px] border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="text-[11px] text-white/45 font-bold">净盈亏</div>
                  <div className={cn('text-[15px] font-mono font-bold mt-0.5', totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
                    {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-[10px] border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="text-[11px] text-white/45 font-bold">筛选命中</div>
                  <div className="text-[15px] font-mono font-bold text-white/90 mt-0.5">{filteredData.length}</div>
                </div>
                <div className="rounded-[10px] border border-white/10 bg-white/[0.02] px-3 py-2">
                  <div className="text-[11px] text-white/45 font-bold">批量选中</div>
                  <div className="text-[15px] font-mono font-bold text-white/90 mt-0.5">{selectedRowKeys.length}</div>
                </div>
              </div>

              {/* ── 筛选工具栏（容器化、分组） ── */}
              <div className="flex items-center gap-2 flex-wrap rounded-[10px] border border-white/10 bg-white/[0.02] px-2 py-2">
                <DateFilter
                  value={dateFilter}
                  customLabel={customLabel}
                  onChange={(v, s, e) => {
                    setDateFilter(v);
                    if (v === 'custom' && s && e) {
                      setCustomRange([s, e]);
                      setCustomLabel(`${s.getMonth()+1}/${s.getDate()} - ${e.getMonth()+1}/${e.getDate()}`);
                    }
                  }}
                />
                <div className="w-px h-5 bg-white/10 mx-1" />
                <MultiSelectFilter label="账户" options={ALL_ACCOUNTS}   selected={accountFilter}  onChange={setAccountFilter} />
                <MultiSelectFilter label="品种" options={ALL_SYMBOLS}    selected={symbolFilter}   onChange={setSymbolFilter} />
                <MultiSelectFilter label="策略" options={ALL_STRATEGIES} selected={strategyFilter} onChange={setStrategyFilter} />
                <MultiSelectFilter label="类型" options={ALL_TYPES}      selected={typeFilter}     onChange={setTypeFilter} />
                {hasFilters && (
                  <button
                    onClick={clearFilters}
                    className="flex items-center gap-1 px-2 h-6 rounded-[6px] text-[12px] text-white/45 hover:text-white/70 hover:bg-white/[0.06] transition-colors"
                  >
                    <X size={12} /> 清除筛选
                  </button>
                )}

                {/* 右侧工具 */}
                <div className="flex items-center gap-2 ml-auto">
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                    <input
                      value={searchText}
                      onChange={e => setSearchText(e.target.value)}
                      placeholder="搜索代码、账户、标签..."
                      className="h-8 pl-8 pr-3 bg-[#131318] border border-[#2F2F38] rounded-[8px] text-[13px] text-slate-200 placeholder:text-slate-600 outline-none focus:border-white/25 transition-colors w-[220px]"
                    />
                  </div>
                </div>
              </div>

              {/* ── 批量操作栏（选中后显示） ── */}
              {batchMode && selectedRowKeys.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-white/[0.03] border border-white/10 rounded-[10px]">
                  <span className="text-[13px] text-white font-bold">已选 {selectedRowKeys.length} 条</span>
                  <div className="w-px h-4 bg-white/10" />
                  <button
                    onClick={() => setShowTagModal(true)}
                    className="flex items-center gap-1.5 px-3 h-7 rounded-[8px] bg-white/[0.04] border border-white/10 text-[13px] text-white/80 hover:bg-white/[0.06] transition-colors"
                  >
                    <Tag size={13} /> 添加标签
                  </button>
                  <button className="flex items-center gap-1.5 px-3 h-7 rounded-[8px] bg-white/[0.04] border border-white/10 text-[13px] text-white/80 hover:bg-white/[0.06] transition-colors">
                    <Folder size={13} /> 分类
                  </button>
                  <button
                    onClick={() => { setSelectedRowKeys([]); setBatchMode(false); }}
                    className="ml-auto flex items-center gap-1 text-[12px] text-white/45 hover:text-white/70 transition-colors"
                  >
                    <X size={12} /> 退出批量
                  </button>
                </div>
              )}
            </div>
          }
        >
          {/* ── 主表格（可滚动内容区） ── */}
          <div className="px-2 pt-2 pb-2 h-full flex flex-col bg-[#0A0A0D]">
            <div ref={tableWrapRef} className="flex-1 min-h-0 overflow-hidden rounded-[10px] border border-[#1E1E26]">
              <Table<TradeRecord>
                dataSource={filteredData}
                columns={tableColumns}
                rowSelection={batchMode ? {
                  selectedRowKeys,
                  onChange: setSelectedRowKeys,
                  columnWidth: 48,
                } : undefined}
                rowClassName={() => 'group'}
                pagination={false}
                scroll={{ y: tableBodyH, x: 'max-content' }}
                size="small"
                className="trade-log-table h-full"
                locale={{ emptyText: <span className="text-slate-500 text-[13px]">暂无交易记录</span> }}
                onRow={(record) => ({
                  onClick: (e) => {
                    // 批量管理模式下不触发编辑
                    if (batchMode) return;
                    // 点击交互元素（按钮、输入框、checkbox、内联编辑等）时不触发
                    const t = e.target as HTMLElement;
                    if (t.closest('button, input, select, textarea, a, [role="button"], .ant-checkbox-wrapper, .ant-checkbox')) return;
                    setEditModalRecord(record);
                  },
                  style: { cursor: batchMode ? 'default' : 'pointer' },
                })}
              />
            </div>
          </div>
        </ElasticLayout>
      </div>

      {/* ── 浮层 ── */}
      {showTagModal && (
        <AddTagModal
          count={selectedRowKeys.length}
          onConfirm={tag => {
            setTradeData(prev =>
              prev.map(t => selectedRowKeys.includes(t.key)
                ? { ...t, tags: [...new Set([...t.tags, tag])] }
                : t
              )
            );
            setShowTagModal(false);
          }}
          onClose={() => setShowTagModal(false)}
        />
      )}

      {/* 抽屉（仅新增），用 AnimatePresence 支持出场动画 */}
      <AnimatePresence>
        {showDrawer && (
          <AddTradeDrawer
            key="add"
            mode="add"
            initialRecord={null}
            onClose={() => setShowDrawer(false)}
            onSave={record => {
              setTradeData(prev => [{ key: String(Date.now()), ...record }, ...prev]);
              setShowDrawer(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* 中央弹出编辑卡片 */}
      <AnimatePresence>
        {editModalRecord && (
          <EditTradeModal
            key={`edit-modal-${editModalRecord.key}`}
            record={editModalRecord}
            onClose={() => setEditModalRecord(null)}
            onSave={updated => {
              setTradeData(prev => prev.map(t => t.key === updated.key ? updated : t));
              setEditModalRecord(null);
            }}
            onDelete={key => {
              setTradeData(prev => prev.filter(t => t.key !== key));
              setEditModalRecord(null);
            }}
          />
        )}
      </AnimatePresence>
    </ConfigProvider>
  );
}
