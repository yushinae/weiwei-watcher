// ═══════════════════════════════════════════════════════════════════════════════
// Widget 共享颜色 token + IVR/PCR 等业务色映射函数
// ═══════════════════════════════════════════════════════════════════════════════

// 通用图表颜色 token（ECharts 配置常用）
export const GRID   = 'rgba(255,255,255,0.07)';
export const TXT    = 'rgba(255,255,255,0.5)';   // v4: 提升图表轴标签对比度（原 0.32 过低）
export const BRAND  = 'rgba(37,232,137,0.92)';
export const RED    = 'rgba(255,95,87,0.92)';    // v4 macOS red #FF5F57（原 #ca3f64 已废）
export const YELLOW = '#FEBC2E';
export const BLUE   = '#ff9c2e';
export const PURPLE = '#a78bfa';

// IV Rank 阈值色：≤30 低（绿）/ 30-70 中（黄）/ >70 高（红）
export function ivrColor(r: number) {
  return r <= 30 ? '#28C840' : r <= 70 ? '#FEBC2E' : '#FF5F57';
}
export function ivrLabel(r: number) {
  return r <= 20 ? '极低' : r <= 40 ? '偏低' : r <= 60 ? '中性' : r <= 80 ? '偏高' : '极高';
}

// Put/Call Ratio 阈值色：<0.7 偏多（绿）/ 0.7-1.0 中性（黄）/ ≥1.0 偏空（红）
export function pcrColor(p: number) {
  return p < 0.7 ? '#28C840' : p < 1.0 ? '#FEBC2E' : '#FF5F57';
}
export function pcrLabel(p: number) {
  return p < 0.7 ? '偏多' : p < 1.0 ? '中性' : '偏空';
}
