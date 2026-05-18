import React, { useState } from 'react';
import {
  Activity, CheckCircle2, TrendingUp, Calendar, BarChart2,
  TrendingDown, PieChart, Calculator, CalendarDays, AlertTriangle,
  Layers, X,
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer, Tooltip, YAxis } from 'recharts';
import { cn } from '../lib/utils';
import {
  VolOverviewWidget,
  VolSmileWidget,
  VRPHistoryWidget,
  IVRankHistoryWidget,
  VolConeWidget,
  FixedTenorWidget,
  ImpliedDistWidget,
  IVSurfaceWidget,
  OptionsSkewWidget,
  PolymarketWidget,
} from './monitorWidgets';
import { PositionsWidget } from './positionsWidget';

// ── Mock data ────────────────────────────────────────────────────────────────

const EQUITY_DATA = Array.from({ length: 30 }).map((_, i) => ({
  day: i,
  value: 10000 + (Math.random() - 0.4) * 2000 + i * 100,
}));

const HEATMAP_DATA = Array.from({ length: 90 }).map(() => Math.random());

const PNL_DATA = [
  { m: 'Jan', v: 3200 }, { m: 'Feb', v: -1100 }, { m: 'Mar', v: 4500 },
  { m: 'Apr', v: 2800 }, { m: 'May', v: -600 },  { m: 'Jun', v: 5100 },
  { m: 'Jul', v: 1900 }, { m: 'Aug', v: -2300 }, { m: 'Sep', v: 3700 },
  { m: 'Oct', v: 6200 }, { m: 'Nov', v: -800 },  { m: 'Dec', v: 4100 },
];

const DD_PTS = [0, 12, 28, 18, 42, 55, 35, 22, 48, 62, 50, 58, 70, 55, 65, 80, 68, 75];

const SYMBOL_DATA = [
  { sym: 'BTC', pnl: 6200, color: '#1EC98C' },
  { sym: 'ETH', pnl: 3100, color: '#1EC98C' },
  { sym: 'SOL', pnl: -1400, color: '#FF4D6A' },
  { sym: 'BNB', pnl: 2200, color: '#1EC98C' },
  { sym: 'XRP', pnl: -800, color: '#FF4D6A' },
];

const MONTHLY = [
  { m: 'Jan', v: '+3.2%', up: true },  { m: 'Feb', v: '-1.1%', up: false },
  { m: 'Mar', v: '+4.5%', up: true },  { m: 'Apr', v: '+2.8%', up: true },
  { m: 'May', v: '-0.6%', up: false }, { m: 'Jun', v: '+5.1%', up: true },
  { m: 'Jul', v: '+1.9%', up: true },  { m: 'Aug', v: '-2.3%', up: false },
  { m: 'Sep', v: '+3.7%', up: true },  { m: 'Oct', v: '+6.2%', up: true },
  { m: 'Nov', v: '-0.8%', up: false }, { m: 'Dec', v: '+4.1%', up: true },
];

// ── Widget Components ────────────────────────────────────────────────────────

export const StatCard = ({ title, value, subtext, trend, icon: Icon, alert = false }: any) => (
  <div className={cn(
    "bg-surface-2/40 border border-surface-5/50 rounded-[6px] p-2 flex flex-col justify-between group relative overflow-hidden h-full",
    alert && "bg-rose-500/10 border-rose-500/30"
  )}>
    {alert && <div className="absolute inset-0 bg-rose-500/5 animate-pulse pointer-events-none" />}
    <div className="flex justify-between items-start mb-1.5 relative z-10 w-full">
      <div className="w-6 h-6 rounded bg-surface-5 flex items-center justify-center text-slate-400 group-hover:text-brand-blue transition-colors shrink-0 @max-[150px]:w-5 @max-[150px]:h-5">
        <Icon size={12} className="@max-[150px]:w-3 @max-[150px]:h-3" />
      </div>
      <div className={cn(
        "text-[8px] font-bold px-1.5 py-0.5 rounded bg-surface-5 @max-[120px]:hidden",
        trend === 'up' ? "text-emerald-400" : "text-rose-400"
      )}>
        {subtext}
      </div>
    </div>
    <div className="relative mt-auto z-10 w-full truncate">
      <div className="text-slate-400 text-[9px] mb-0.5 truncate @max-[150px]:hidden">{title}</div>
      <div className={cn(
        "text-[14px] font-bold font-mono tracking-tight leading-none truncate tnum @max-[150px]:text-[12px]",
        trend === 'up' ? "text-emerald-300 glow-green" : trend === 'down' ? "text-rose-300 glow-red" : "text-slate-100"
      )}>{value}</div>
    </div>
  </div>
);

export const StatCardsPanel = () => (
  <div className="h-full w-full p-2 grid grid-cols-1 @min-[280px]:grid-cols-2 @min-[550px]:grid-cols-4 gap-2 min-h-0 overflow-y-auto">
    <StatCard title="今日盈亏 (Daily PnL)" value="+$1,245.50" subtext="+2.4%" trend="up" icon={TrendingUp} />
    <StatCard title="本月胜率 (Monthly WR)" value="68.5%" subtext="Last 30d" trend="up" icon={Activity} />
    <StatCard title="当前风险敞口 (Total Risk)" value="12.4%" subtext="High Risk" trend="down" icon={AlertTriangle} alert />
    <StatCard title="账户净值 (Net Equity)" value="$54,230.00" subtext="+15% YTD" trend="up" icon={TrendingUp} />
  </div>
);

export const ActivityHeatmap = () => (
  <div className="flex flex-col h-full p-2 w-full">
    <div className="flex-1 flex items-end min-h-0">
      <div className="grid grid-rows-5 grid-flow-col gap-0.5 w-full h-full min-w-0">
        {HEATMAP_DATA.map((val, i) => {
          let color = "bg-surface-2";
          if (val > 0.8) color = "bg-emerald-400";
          else if (val > 0.6) color = "bg-emerald-500/80";
          else if (val > 0.4) color = "bg-emerald-500/50";
          else if (val > 0.2) color = "bg-emerald-500/20";
          return <div key={i} className={cn("w-full h-full min-h-[4px] rounded-[1px]", color)} />;
        })}
      </div>
    </div>
  </div>
);

export const EquityChart = () => (
  <div className="flex-1 w-full h-full min-h-0 pt-2 @max-[250px]:-ml-4">
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={EQUITY_DATA} margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#4D7CFF" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#4D7CFF" stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip
          contentStyle={{ backgroundColor: '#12121A', borderColor: 'rgba(77,124,255,0.2)', borderRadius: '6px', fontSize: '12px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
          itemStyle={{ color: '#E2E8F0' }}
          labelStyle={{ display: 'none' }}
        />
        <Area type="monotone" dataKey="value" stroke="#4D7CFF" strokeWidth={1.5} fill="url(#equityGrad)" />
      </AreaChart>
    </ResponsiveContainer>
  </div>
);

export const Checklist = () => {
  const items = [
    { id: 1, text: "检查宏观经济日历", done: true },
    { id: 2, text: "确认整体市场偏好", done: true },
    { id: 3, text: "扫描自选股异常波动", done: false },
    { id: 4, text: "心理状态自检", done: false },
  ];
  return (
    <div className="h-full flex flex-col p-2 min-h-0 w-full">
      <div className="flex flex-col gap-1.5 flex-1 overflow-y-auto pr-1 min-h-0">
        {items.map(item => (
          <label key={item.id} className="flex items-center gap-2 p-1.5 rounded bg-surface-2/50 border border-surface-2 hover:bg-surface-2 cursor-pointer transition-colors group">
            <div className={cn("w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors shrink-0",
              item.done ? "bg-brand-blue border-brand-blue" : "border-slate-600 group-hover:border-slate-500")}>
              {item.done && <CheckCircle2 size={10} className="text-white" />}
            </div>
            <span className={cn("text-[11px] transition-colors truncate @max-[150px]:hidden",
              item.done ? "text-slate-500 line-through" : "text-slate-300")}>
              {item.text}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
};

export const PnLBarsWidget = () => {
  const max = Math.max(...PNL_DATA.map(d => Math.abs(d.v)));
  return (
    <div className="w-full h-full flex flex-col p-2 min-h-0">
      <div className="flex-1 flex items-end gap-[3px] min-h-0">
        {PNL_DATA.map((d) => {
          const pct = Math.abs(d.v) / max * 100;
          const pos = d.v >= 0;
          return (
            <div key={d.m} className="flex-1 flex flex-col items-center gap-0.5 h-full justify-end">
              {pos
                ? <div className="w-full flex flex-col justify-end" style={{ height: '50%' }}>
                    <div className="w-full rounded-t-[2px] bg-emerald-500/70" style={{ height: `${pct}%` }} />
                  </div>
                : <div className="w-full flex flex-col" style={{ height: '50%' }}>
                    <div className="w-full rounded-b-[2px] bg-rose-500/70 mt-auto" style={{ height: `${pct}%` }} />
                  </div>
              }
              <span className="text-[8px] text-slate-600 @max-[200px]:hidden">{d.m}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const WinDonutWidget = () => {
  const win = 68;
  const r = 42, cx = 60, cy = 60;
  const circ = 2 * Math.PI * r;
  const dash = (win / 100) * circ;
  return (
    <div className="w-full h-full flex items-center justify-center gap-6 p-2">
      <svg viewBox="0 0 120 120" className="w-24 h-24 shrink-0 -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1A1A24" strokeWidth="14" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1EC98C" strokeWidth="14"
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#FF4D6A" strokeWidth="14"
          strokeDasharray={`${circ - dash - 4} ${dash + 4}`} strokeDashoffset={-(dash + 2)}
          strokeLinecap="round" />
      </svg>
      <div className="flex flex-col gap-2 @max-[200px]:hidden">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
          <span className="text-[11px] text-slate-400">胜率</span>
          <span className="text-[13px] font-bold font-mono text-emerald-400 ml-1 tnum glow-green">{win}%</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-rose-400 shrink-0" />
          <span className="text-[11px] text-slate-400">败率</span>
          <span className="text-[13px] font-bold font-mono text-rose-400 ml-1 tnum glow-red">{100 - win}%</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-slate-500">盈亏比</span>
          <span className="text-[11px] font-bold font-mono text-slate-300 ml-1">2.4:1</span>
        </div>
      </div>
    </div>
  );
};

export const DrawdownWidget = () => {
  const W = 300, H = 120;
  const xs = DD_PTS.map((_, i) => (i / (DD_PTS.length - 1)) * W);
  const ys = DD_PTS.map(v => H - (v / 80) * (H - 10) - 5);
  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  const peakX = xs[4]; const peakY = ys[4];
  const troughX = xs[7]; const troughY = ys[7];
  const shadePoints = `${peakX},${peakY} ${xs.slice(4, 8).map((x, i) => `${x},${ys[4 + i]}`).join(' ')} ${troughX},${H} ${peakX},${H}`;
  return (
    <div className="w-full h-full p-2 flex flex-col min-h-0">
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
          <polygon points={shadePoints} fill="rgba(255,77,106,0.2)" />
          <line x1={peakX} y1={peakY} x2={troughX} y2={troughY} stroke="#FF4D6A" strokeWidth="1" strokeDasharray="4 3" />
          <path d={linePath} fill="none" stroke="#4D7CFF" strokeWidth="1.5" strokeLinejoin="round" />
          <text x={peakX + (troughX - peakX) / 2} y={troughY - 8} textAnchor="middle" fontSize="9" fill="#FF4D6A">最大回撤 -28%</text>
        </svg>
      </div>
    </div>
  );
};

export const SymbolPnLWidget = () => {
  const max = Math.max(...SYMBOL_DATA.map(d => Math.abs(d.pnl)));
  return (
    <div className="w-full h-full flex flex-col p-2 gap-1.5 min-h-0 overflow-y-auto">
      {SYMBOL_DATA.map(d => (
        <div key={d.sym} className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-bold font-mono text-slate-400 w-7 shrink-0">{d.sym}</span>
          <div className="flex-1 h-3 bg-surface-2 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.abs(d.pnl) / max * 100}%`, background: d.color, opacity: 0.75 }} />
          </div>
          <span className={cn('text-[10px] font-mono font-bold w-14 text-right shrink-0 tnum',
            d.pnl >= 0 ? 'text-emerald-400 glow-green' : 'text-rose-400 glow-red')}>
            {d.pnl >= 0 ? '+' : ''}{d.pnl.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
};

export const PosCalcWidget = () => {
  const [capital, setCapital] = useState(50000);
  const [risk, setRisk] = useState(1.0);
  const [sl, setSl] = useState(2.5);
  const size = capital * (risk / 100) / (sl / 100);
  return (
    <div className="w-full h-full flex flex-col p-3 gap-2 min-h-0 overflow-y-auto">
      {[
        { label: '账户资金', value: capital, set: setCapital, prefix: '$', suffix: '', step: 1000 },
        { label: '风险比例', value: risk, set: setRisk, prefix: '', suffix: '%', step: 0.1 },
        { label: '止损距离', value: sl, set: setSl, prefix: '', suffix: '%', step: 0.1 },
      ].map(({ label, value, set, prefix, suffix, step }) => (
        <div key={label} className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 w-16 shrink-0">{label}</span>
          <div className="flex-1 flex items-center bg-surface-3 rounded-[6px] px-2 h-7 border border-surface-5">
            {prefix && <span className="text-[11px] text-slate-500 mr-1">{prefix}</span>}
            <input type="number" step={step} value={value} onChange={e => set(Number(e.target.value))}
              className="flex-1 bg-transparent text-[12px] font-mono text-slate-200 outline-none min-w-0" />
            {suffix && <span className="text-[11px] text-slate-500 ml-1">{suffix}</span>}
          </div>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between bg-brand-blue/10 border border-brand-blue/30 rounded-[6px] px-3 h-8">
        <span className="text-[11px] text-slate-400">建议仓位</span>
        <span className="text-[13px] font-bold font-mono text-brand-blue tnum glow-blue">
          ${size.toLocaleString('en-US', { maximumFractionDigits: 0 })}
        </span>
      </div>
    </div>
  );
};

export const MonthlyStatsWidget = () => (
  <div className="w-full h-full p-2 grid grid-cols-3 @min-[300px]:grid-cols-4 @min-[450px]:grid-cols-6 gap-1.5 content-start overflow-y-auto min-h-0">
    {MONTHLY.map(({ m, v, up }) => (
      <div key={m} className="flex flex-col items-center bg-surface-2/40 border border-surface-5/40 rounded-[6px] py-1.5 px-1">
        <span className="text-[9px] text-slate-600 mb-0.5">{m}</span>
        <span className={cn('text-[11px] font-bold font-mono', up ? 'text-emerald-400' : 'text-rose-400')}>{v}</span>
      </div>
    ))}
  </div>
);

// ── Widget Registry ──────────────────────────────────────────────────────────

export interface ConfigField {
  key: string
  label: string
  type: 'select'
  options: { value: string; label: string }[]
  default: string
}

export interface WidgetDefinition {
  id: string
  label: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  category: 'account' | 'charts' | 'tools' | 'monitor' | 'options'
  /** widget: 添加到工作台；action: 作为组件库里的“动作入口”，由 App 处理点击行为 */
  kind?: 'widget' | 'action'
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  component: React.ComponentType<Record<string, string>>
  preview: React.ReactNode
  configSchema?: ConfigField[]
}

const ActionPlaceholder: React.FC<Record<string, string>> = () => null;

export const WIDGET_REGISTRY: Record<string, WidgetDefinition> = {
  'stat-cards': {
    id: 'stat-cards',
    label: '账户概览 (KPI)',
    icon: Activity,
    category: 'account',
    description: '核心账户指标概览，包含胜率、盈亏等。支持不同时间维度的数据对比。',
    defaultSize: { w: 12, h: 2, minW: 3, minH: 2 },
    component: StatCardsPanel,
    preview: <StatCard title="今日盈亏 (Daily PnL)" value="+$1,245.50" subtext="+2.4%" trend="up" icon={TrendingUp} />,
  },
  'equity-chart': {
    id: 'equity-chart',
    label: '净值走势图 (Equity Curve)',
    icon: TrendingUp,
    category: 'charts',
    description: '展示账户历史净值变化，支持多周期筛选和趋势线辅助。',
    defaultSize: { w: 8, h: 5, minW: 3, minH: 3 },
    component: EquityChart,
    preview: <EquityChart />,
  },
  'pnl-bars': {
    id: 'pnl-bars',
    label: '月度盈亏 (Monthly PnL)',
    icon: BarChart2,
    category: 'charts',
    description: '按月展示盈亏柱状图，快速识别盈利月份与亏损月份的规律，适合复盘节奏。',
    defaultSize: { w: 6, h: 4, minW: 3, minH: 3 },
    component: PnLBarsWidget,
    preview: <PnLBarsWidget />,
  },
  'win-donut': {
    id: 'win-donut',
    label: '胜率分布 (Win Rate)',
    icon: PieChart,
    category: 'charts',
    description: '圆环图直观展示胜率、盈亏笔数及盈亏比，综合评估交易策略质量。',
    defaultSize: { w: 4, h: 4, minW: 3, minH: 3 },
    component: WinDonutWidget,
    preview: <WinDonutWidget />,
  },
  'drawdown': {
    id: 'drawdown',
    label: '最大回撤 (Drawdown)',
    icon: TrendingDown,
    category: 'charts',
    description: '净值曲线叠加回撤着色区域，直观感知最大回撤发生的时段与幅度。',
    defaultSize: { w: 6, h: 4, minW: 3, minH: 3 },
    component: DrawdownWidget,
    preview: <DrawdownWidget />,
  },
  'symbol-pnl': {
    id: 'symbol-pnl',
    label: '品种盈亏 (By Symbol)',
    icon: BarChart2,
    category: 'charts',
    description: '各交易品种盈亏横向对比，识别最具优势和最需要改进的交易品种。',
    defaultSize: { w: 4, h: 4, minW: 3, minH: 3 },
    component: SymbolPnLWidget,
    preview: <SymbolPnLWidget />,
  },
  'checklist': {
    id: 'checklist',
    label: '盘前检查单 (Checklist)',
    icon: CheckCircle2,
    category: 'tools',
    description: '交易前的例行检查单，规范交易流程，防止随性交易。',
    defaultSize: { w: 4, h: 5, minW: 2, minH: 3 },
    component: Checklist,
    preview: <Checklist />,
  },
  'positions': {
    id: 'positions',
    label: '仓位 (Positions)',
    icon: Layers,
    category: 'account',
    description: '账户仓位面板：筛选、列、导出与盈亏指标。布局与密度参考交易终端。',
    defaultSize: { w: 12, h: 4, minW: 6, minH: 3 },
    component: PositionsWidget,
    preview: (
      <div className="h-[120px] w-[240px] p-2 bg-surface-2/40 border border-surface-5/40 rounded-[8px] overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-extrabold text-white/80">仓位 (USDC)</div>
          <div className="text-[12px] font-bold text-white/35">0</div>
        </div>
        <div className="mt-2 h-8 rounded-[10px] border border-white/10 bg-black/30" />
        <div className="mt-2 grid grid-cols-4 gap-1">
          {['产品','数量','均价','损益'].map((t) => (
            <div key={t} className="h-6 rounded-[8px] bg-white/[0.03] border border-white/[0.06]" />
          ))}
        </div>
      </div>
    ),
  },
  'pos-calc': {
    id: 'pos-calc',
    label: '开仓计算器 (Position Calc)',
    icon: Calculator,
    category: 'tools',
    description: '根据账户资金、风险比例和止损距离，自动计算建议仓位大小，严守风控纪律。',
    defaultSize: { w: 4, h: 5, minW: 3, minH: 4 },
    component: PosCalcWidget,
    preview: <PosCalcWidget />,
  },
  'heatmap': {
    id: 'heatmap',
    label: '交易活跃度 (Activity Heatmap)',
    icon: Calendar,
    category: 'charts',
    description: '系统性的热力图展示交易活跃日频率，直观反映交易密度。',
    defaultSize: { w: 12, h: 3, minW: 4, minH: 2 },
    component: ActivityHeatmap,
    preview: <ActivityHeatmap />,
  },
  'monthly-stats': {
    id: 'monthly-stats',
    label: '月度绩效 (Monthly Stats)',
    icon: CalendarDays,
    category: 'account',
    description: '按月汇总收益率，快速纵览全年绩效表现，定位强弱月份。',
    defaultSize: { w: 6, h: 3, minW: 3, minH: 2 },
    component: MonthlyStatsWidget,
    preview: <MonthlyStatsWidget />,
  },
  'vol-overview': {
    id: 'vol-overview',
    label: '波动率概览 (Vol Overview)',
    icon: Activity,
    category: 'monitor',
    description: 'DVOL、IV Rank、PCR、VRP 核心波动率指标，附带期限结构迷你图。',
    defaultSize: { w: 4, h: 7, minW: 3, minH: 5 },
    component: VolOverviewWidget,
    preview: <VolOverviewWidget />,
  },
  'vol-smile': {
    id: 'vol-smile',
    label: '波动率微笑 (Vol Smile)',
    icon: TrendingUp,
    category: 'monitor',
    description: '不同到期的波动率微笑曲线，直观展示期权市场的偏度与峰度结构。',
    defaultSize: { w: 5, h: 5, minW: 3, minH: 4 },
    component: VolSmileWidget,
    preview: <VolSmileWidget />,
  },
  'vrp-history': {
    id: 'vrp-history',
    label: 'VRP 历史 (VRP History)',
    icon: BarChart2,
    category: 'monitor',
    description: '隐含波动率与实现波动率历史对比，量化波动率风险溢价趋势。',
    defaultSize: { w: 5, h: 4, minW: 3, minH: 3 },
    component: VRPHistoryWidget,
    preview: <VRPHistoryWidget />,
  },
  'ivrank-history': {
    id: 'ivrank-history',
    label: 'IV Rank 历史 (IV Rank History)',
    icon: BarChart2,
    category: 'monitor',
    description: 'IV Rank 历史走势，判断当前波动率水平处于历史高低区间。',
    defaultSize: { w: 5, h: 4, minW: 3, minH: 3 },
    component: IVRankHistoryWidget,
    preview: <IVRankHistoryWidget />,
  },
  'vol-cone': {
    id: 'vol-cone',
    label: '波动率锥 (Vol Cone)',
    icon: TrendingDown,
    category: 'monitor',
    description: '不同历史窗口的已实现波动率分位数与当前波动率对比，量化波动率超买超卖。',
    defaultSize: { w: 5, h: 5, minW: 3, minH: 4 },
    component: VolConeWidget,
    preview: <VolConeWidget />,
  },
  'fixed-tenor': {
    id: 'fixed-tenor',
    label: '固定到期曲线 (Fixed Tenor)',
    icon: TrendingUp,
    category: 'monitor',
    description: '各固定到期 IV 的历史走势，追踪期限结构变化和曲线形态演变。',
    defaultSize: { w: 5, h: 5, minW: 3, minH: 4 },
    component: FixedTenorWidget,
    preview: <FixedTenorWidget />,
  },
  'implied-dist': {
    id: 'implied-dist',
    label: '隐含分布 (Implied Distribution)',
    icon: BarChart2,
    category: 'monitor',
    description: '由期权价格反推的标的资产隐含概率分布，识别市场对尾部风险的定价。',
    defaultSize: { w: 5, h: 5, minW: 3, minH: 4 },
    component: ImpliedDistWidget,
    preview: <ImpliedDistWidget />,
  },
  'iv-surface': {
    id: 'iv-surface',
    label: 'IV 曲面 (IV Surface)',
    icon: Layers,
    category: 'monitor',
    description: '完整的隐含波动率曲面热力图，以偏度和期限两个维度展示期权隐含波动率。',
    defaultSize: { w: 6, h: 5, minW: 4, minH: 4 },
    component: IVSurfaceWidget,
    preview: <IVSurfaceWidget />,
  },
  'options-skew': {
    id: 'options-skew',
    label: '期权偏斜表 (Options Skew)',
    icon: BarChart2,
    category: 'monitor',
    description: '各到期的 ATM、25d/10d Risk Reversal 和 Butterfly 偏斜数据表格。',
    defaultSize: { w: 6, h: 4, minW: 4, minH: 3 },
    component: OptionsSkewWidget,
    preview: <OptionsSkewWidget />,
  },
  'polymarket': {
    id: 'polymarket',
    label: 'Polymarket 预测 (Polymarket)',
    icon: PieChart,
    category: 'monitor',
    description: 'Polymarket 链上预测市场的加密相关合约，实时追踪市场对关键事件的概率定价。',
    defaultSize: { w: 4, h: 6, minW: 3, minH: 4 },
    component: PolymarketWidget,
    preview: <PolymarketWidget />,
  },

  // ── Options (action) ───────────────────────────────────────────────────────
  // 期权链不是工作台里的 widget，而是 /options-chain 页面的 Tab 动作入口
  'options-chain': {
    id: 'options-chain',
    label: '期权链',
    icon: Layers,
    category: 'options',
    kind: 'action',
    description: '向右侧追加一个期权链 Tab（不切换当前页面）。',
    // 对 action 来说尺寸不重要，但保留字段以满足 WidgetDefinition
    defaultSize: { w: 6, h: 4, minW: 3, minH: 3 },
    component: ActionPlaceholder,
    preview: (
      <div className="w-full p-3 rounded-[12px] border border-white/10 bg-gradient-to-b from-white/[0.04] to-white/[0.02]">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-extrabold text-white/85 tracking-tight">期权链</div>
          <div className="text-[10px] font-mono text-white/35">Preview</div>
        </div>
        <div className="mt-2 rounded-[10px] border border-white/10 overflow-hidden bg-[#0F1015]">
          {/* 顶部标题栏（模拟 tabs + underline） */}
          <div className="relative px-3 pt-2 pb-1">
            <div className="flex items-center gap-4 text-[13px] font-extrabold text-white/80">
              <span className="opacity-70">期权 (SOL-USDC)</span>
              <span className="text-white text-[14px]">期权 (BTC-USDC)</span>
              <span className="opacity-70">期权 (ETH-USDC)</span>
            </div>
            <div
              className="absolute left-[132px] bottom-0 h-[3px] w-[120px] rounded-full"
              style={{
                background: 'linear-gradient(90deg, rgba(255,255,255,0.65), rgba(255,255,255,0.95), rgba(255,255,255,0.65))',
                boxShadow: '0 0 10px rgba(255,255,255,0.55), 0 0 22px rgba(255,255,255,0.25)',
              }}
            />
            <div className="absolute right-2 top-2 size-6 rounded-[6px] border border-white/10 bg-black flex items-center justify-center text-white/85">
              <X size={14} />
            </div>
          </div>
          {/* 工具栏（按钮骨架） */}
          <div className="px-3 py-2 border-t border-white/10 flex items-center gap-2">
            {['到期日', '列', '过滤', 'Dist'].map((t) => (
              <div key={t} className="h-7 px-3 rounded-[10px] border border-white/10 bg-white/[0.03] text-white/70 text-[12px] font-bold flex items-center">
                {t}
              </div>
            ))}
            <div className="flex-1" />
          </div>
          {/* 表格骨架 */}
          <div className="px-3 pb-3">
            <div className="grid grid-cols-6 gap-2 text-[10px] text-white/35 font-mono mb-2">
              {['标记', '卖价', 'IV', 'IV', '买价', '标记'].map((h, i) => (
                <div key={i} className="truncate">{h}</div>
              ))}
            </div>
            {Array.from({ length: 6 }).map((_, r) => (
              <div key={r} className="grid grid-cols-6 gap-2 mb-1.5">
                {Array.from({ length: 6 }).map((__, c) => (
                  <div key={c} className="h-4 rounded-[6px] bg-white/[0.04] border border-white/[0.06]" />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="text-[11px] text-white/40 mt-2 leading-snug">
          点击“添加组件”后，会在期权链页右侧追加一个新的 Tab。
        </div>
      </div>
    ),
    configSchema: [
      {
        key: 'coinId',
        label: '标的',
        type: 'select',
        default: 'BTC-USD',
        options: [
          { value: 'BTC-USD', label: 'BTC' },
          { value: 'ETH-USD', label: 'ETH' },
          { value: 'BTC-USDC', label: 'BTC-USDC' },
          { value: 'ETH-USDC', label: 'ETH-USDC' },
          { value: 'SOL-USDC', label: 'SOL-USDC' },
          { value: 'AVAX-USDC', label: 'AVAX-USDC' },
          { value: 'XRP-USDC', label: 'XRP-USDC' },
          { value: 'TRX-USDC', label: 'TRX-USDC' },
        ],
      },
    ],
  },
};
