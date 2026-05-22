export function mapPts(data: number[], W: number, H: number, lo: number, hi: number, px = 0, py = 0): [number, number][] {
  const range = hi - lo || 1;
  return data.map((v, i) => [
    px + (i / Math.max(data.length - 1, 1)) * (W - 2 * px),
    (H - py) - ((v - lo) / range) * (H - 2 * py),
  ]);
}

export function poly(pts: [number, number][]) {
  return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
}

export function smooth(pts: [number, number][]) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]; const [cx, cy] = pts[i];
    const dx = (cx - px) * 0.45;
    d += ` C ${(px + dx).toFixed(1)} ${py.toFixed(1)},${(cx - dx).toFixed(1)} ${cy.toFixed(1)},${cx.toFixed(1)} ${cy.toFixed(1)}`;
  }
  return d;
}

export function area(pts: [number, number][], H: number, padY = 0) {
  if (!pts.length) return '';
  const bot = H - padY;
  return `${smooth(pts)} L ${pts[pts.length - 1][0].toFixed(1)} ${bot} L ${pts[0][0].toFixed(1)} ${bot} Z`;
}
