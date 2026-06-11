// 持仓 tab 的「Gamma 速读」结论条 —— 与波动率速读同款分层阅读：结论先行。
// 一眼回答：现在是正/负 Gamma 区制（做市商压波动还是助涨助跌）、翻转点在哪、
// 上方 call 墙 / 下方 put 墙 / 到期磁吸 Max Pain / PCR。
// GEX 口径 = analysis.computeNetGex（与下方 GEXWidget / 决策页 GEX 关键位同一函数/同一约定）。
import React, { useEffect, useMemo } from 'react';
import { useCardHeader } from '../../components/card/WidgetCard';
import {
  useCoinControl, useDeribitOptions, computeNetGex, computeChainLevels,
  CoinLabel, type CoinControlProps,
} from '../../registry/monitorWidgetsBase';

const UP = '#28C840';
const DOWN = '#FF5F57';
const YELLOW = '#FEBC2E';

const fmtPx = (v: number | null) => (v == null ? '—' : v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(0));

export const GammaHeadlineWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data } = useDeribitOptions(coin);
  const { setHeaderRight } = useCardHeader();
  useEffect(() => {
    setHeaderRight(<CoinLabel coin={coin} />);
    return () => setHeaderRight(null);
  }, [coin, setCoin, setHeaderRight, data]);

  // 净 GEX → 翻转点 / 总净额（共享口径：analysis.computeNetGex，同下方 GEX 图）
  const gx = useMemo(() => (data ? computeNetGex(data) : null), [data]);

  const levels = useMemo(() => computeChainLevels(data, 'ALL', data?.spot ?? 0), [data]);

  const spot = data?.spot ?? 0;
  const flip = gx?.flip ?? null;
  // 区制：现价相对翻转点（无翻转点时退回总净额符号）
  const isPos = flip != null ? spot >= flip : (gx ? gx.totalNet >= 0 : true);
  // 翻转点相对现价的位置：正 = 翻转点在现价上方
  const flipDist = flip != null && spot > 0 ? ((flip - spot) / spot) * 100 : null;
  const cw = levels.callWall, pw = levels.putWall;
  const cwDist = cw != null && spot > 0 ? ((cw - spot) / spot) * 100 : null;
  const pwDist = pw != null && spot > 0 ? ((pw - spot) / spot) * 100 : null;

  // 一句话判定（区制 + 操作含义 + 翻转点）
  const verdict = isPos
    ? `正 Gamma：做市商压波动，偏区间震荡 → 卖波动（跨式/宽跨）占优；跌破 ${fmtPx(flip)} 转放大区`
    : `负 Gamma：做市商助涨助跌，波动易放大、突破易延续 → 慎裸卖；站上 ${fmtPx(flip)} 转压制区`;

  const Stat = ({ label, value, color = 'rgba(255,255,255,0.88)', sub, subColor }:
    { label: string; value: string; color?: string; sub?: string; subColor?: string }) => (
    <div className="flex flex-col gap-0.5 px-3 shrink-0">
      <span className="text-[9px] uppercase tracking-wider text-white/40">{label}</span>
      <span className="text-[18px] font-bold tabular-nums leading-none" style={{ color }}>{value}</span>
      {sub && <span className="text-[9px]" style={{ color: subColor ?? 'rgba(255,255,255,0.35)' }}>{sub}</span>}
    </div>
  );

  return (
    <div className="w-full h-full flex items-center gap-1 px-2 overflow-x-auto">
      <Stat
        label="Gamma 区制"
        value={isPos ? '正 Gamma' : '负 Gamma'}
        color={isPos ? UP : DOWN}
        sub={isPos ? '压制波动 · 粘滞' : '放大波动 · 易爆'}
        subColor={isPos ? 'rgba(40,200,64,0.7)' : 'rgba(255,95,87,0.7)'}
      />
      <div className="w-px h-8 bg-white/[0.08]" />
      <Stat label="翻转点" value={fmtPx(flip)} color={YELLOW}
        sub={flipDist != null ? `现价${flipDist >= 0 ? '上方' : '下方'} ${Math.abs(flipDist).toFixed(1)}%` : '区间内无变号'} />
      <Stat label="Call 墙 (阻力)" value={fmtPx(cw)} color="rgba(255,255,255,0.88)"
        sub={cwDist != null ? `上方 ${Math.abs(cwDist).toFixed(1)}%` : '—'} subColor="rgba(255,95,87,0.65)" />
      <Stat label="Put 墙 (支撑)" value={fmtPx(pw)} color="rgba(255,255,255,0.88)"
        sub={pwDist != null ? `下方 ${Math.abs(pwDist).toFixed(1)}%` : '—'} subColor="rgba(40,200,64,0.65)" />
      <div className="w-px h-8 bg-white/[0.08]" />
      <div className="flex-1 min-w-[240px] flex items-center px-3">
        <span className="text-[12px] leading-snug text-white/65">
          <span className="text-white/40">判定: </span><em className="not-italic font-semibold text-white/85">{verdict}</em>
        </span>
      </div>
    </div>
  );
};
