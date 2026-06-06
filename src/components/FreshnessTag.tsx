import { useFreshness, freshStateText, FRESH_COLOR } from '../registry/data/freshness';

// ═══════════════════════════════════════════════════════════════════════════════
// FreshnessTag — 内联新鲜度小徽章
//
// 贴在「你照着下单的数」旁边（现价 / 期权链报价）。读中央新鲜度 store，自动跳
// 「实时 / N秒前 / 中断」并上色。安静（绿）时只是一个小点 + 字，不抢戏。
//
//   <FreshnessTag dataKey="ws-deribit" label="现价" />
//   <FreshnessTag dataKey={`option-chain-${coin}`} label="报价" />
// ═══════════════════════════════════════════════════════════════════════════════

export default function FreshnessTag({
  dataKey,
  label,
  className,
}: {
  dataKey: string;
  label?: string;
  className?: string;
}) {
  const fr = useFreshness(dataKey);
  const color = fr ? FRESH_COLOR[fr.kind] : '#8A8F98';
  const text = fr ? freshStateText(fr) : '—';

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap ${className ?? ''}`}
      title={fr?.error ?? (fr ? `${fr.label}：${text}` : undefined)}
    >
      {label && <span className="text-[10px] font-semibold text-white/35">{label}</span>}
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] font-bold tabular-nums" style={{ color }}>{text}</span>
    </span>
  );
}
