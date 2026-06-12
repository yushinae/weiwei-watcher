import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'node_modules', 'lightweight-charts', 'dist');

const patches = [
  {
    file: 'lightweight-charts.development.mjs',
    replacements: [
      ['_internal_tickLength: 5 /* RendererConstants.TickLength */', '_internal_tickLength: 0 /* Weiwei patch: tighter price scale */'],
      ['rendererOptions._internal_paddingInner = currentFontSize / 12 * rendererOptions._internal_tickLength;', 'rendererOptions._internal_paddingInner = 3;'],
      ['rendererOptions._internal_paddingOuter = currentFontSize / 12 * rendererOptions._internal_tickLength;', 'rendererOptions._internal_paddingOuter = 0;'],
      ['5 /* Constants.LabelOffset */', '0 /* Weiwei patch: tighter price scale label offset */'],
      [
        // 必须整块原子替换：拆成两条时，"ctx.textAlign = 'right';" 在库里本就存在，
        // 下方 includes(to) 幂等检查会误跳过它，右轴刻度文字就会以 left 对齐
        // 从 width-1 开始画 → 整段画出画布外（刻度消失）。
        `ctx.textAlign = this._private__isLeft ? 'right' : 'left';
            ctx.textBaseline = 'middle';
            const textLeftX = this._private__isLeft ?
                Math.round(tickMarkLeftX - rendererOptions._internal_paddingInner) :
                Math.round(tickMarkLeftX + rendererOptions._internal_tickLength + rendererOptions._internal_paddingInner);`,
        `ctx.textAlign = 'right'; /* Weiwei patch: price ticks right-aligned */
            ctx.textBaseline = 'middle';
            const textLeftX = this._private__isLeft ?
                Math.round(tickMarkLeftX - rendererOptions._internal_paddingInner) :
                Math.round(this._private__size.width - 1);`,
      ],
      ['_internal_radius: 2 * horizontalPixelRatio,', '_internal_radius: 4 * horizontalPixelRatio,'],
      ['const radius$1 = 2;', 'const radius$1 = 4;'],
      [
        `ctx.beginPath();
            ctx.moveTo(x1scaled, y1scaled);
            ctx.lineTo(x1scaled, y2scaled - radiusScaled);
            ctx.arcTo(x1scaled, y2scaled, x1scaled + radiusScaled, y2scaled, radiusScaled);
            ctx.lineTo(x2scaled - radiusScaled, y2scaled);
            ctx.arcTo(x2scaled, y2scaled, x2scaled, y2scaled - radiusScaled, radiusScaled);
            ctx.lineTo(x2scaled, y1scaled);
            ctx.fill();`,
        `ctx.beginPath();
            if (ctx.roundRect) {
                ctx.roundRect(x1scaled, y1scaled, x2scaled - x1scaled, y2scaled - y1scaled, radiusScaled);
            }
            else {
                ctx.moveTo(x1scaled + radiusScaled, y1scaled);
                ctx.lineTo(x2scaled - radiusScaled, y1scaled);
                ctx.arcTo(x2scaled, y1scaled, x2scaled, y1scaled + radiusScaled, radiusScaled);
                ctx.lineTo(x2scaled, y2scaled - radiusScaled);
                ctx.arcTo(x2scaled, y2scaled, x2scaled - radiusScaled, y2scaled, radiusScaled);
                ctx.lineTo(x1scaled + radiusScaled, y2scaled);
                ctx.arcTo(x1scaled, y2scaled, x1scaled, y2scaled - radiusScaled, radiusScaled);
                ctx.lineTo(x1scaled, y1scaled + radiusScaled);
                ctx.arcTo(x1scaled, y1scaled, x1scaled + radiusScaled, y1scaled, radiusScaled);
            }
            ctx.fill();`,
      ],
    ],
  },
  {
    file: 'lightweight-charts.production.mjs',
    replacements: [
      ['C:5', 'C:0/* ww */'], // to 必须含唯一标记：裸 "C:0" 在库里本就存在，会被幂等检查误跳过
      ['t.V=i/12*t.C,t.B=i/12*t.C', 't.V=3,t.B=0'],
      ['+5+a)', '+0+a)'],
      [
        't.textAlign=this.om?"right":"left",t.textBaseline="middle";const r=this.om?Math.round(e-s.V):Math.round(e+s.C+s.V)',
        't.textAlign="right",t.textBaseline="middle";const r=this.om?Math.round(e-s.V):Math.round(this.Qv.width-1)',
      ],
      ['ft:2*a', 'ft:4*a'],
    ],
  },
  {
    file: 'lightweight-charts.standalone.production.mjs',
    replacements: [
      ['C:5', 'C:0/* ww */'], // to 必须含唯一标记：裸 "C:0" 在库里本就存在，会被幂等检查误跳过
      ['t.V=i/12*t.C,t.B=i/12*t.C', 't.V=3,t.B=0'],
      ['+5+a)', '+0+a)'],
      [
        't.textAlign=this.om?"right":"left",t.textBaseline="middle";const r=this.om?Math.round(e-s.V):Math.round(e+s.C+s.V)',
        't.textAlign="right",t.textBaseline="middle";const r=this.om?Math.round(e-s.V):Math.round(this.Qv.width-1)',
      ],
      ['ft:2*a', 'ft:4*a'],
    ],
  },
  {
    file: 'lightweight-charts.standalone.production.js',
    replacements: [
      ['C:5', 'C:0/* ww */'], // to 必须含唯一标记：裸 "C:0" 在库里本就存在，会被幂等检查误跳过
      ['t.V=i/12*t.C,t.B=i/12*t.C', 't.V=3,t.B=0'],
      ['+5+a)', '+0+a)'],
      [
        't.textAlign=this.om?"right":"left",t.textBaseline="middle";const r=this.om?Math.round(e-s.V):Math.round(e+s.C+s.V)',
        't.textAlign="right",t.textBaseline="middle";const r=this.om?Math.round(e-s.V):Math.round(this.Qv.width-1)',
      ],
      ['ft:2*a', 'ft:4*a'],
    ],
  },
  {
    file: path.join(root, 'node_modules', '.vite', 'deps', 'lightweight-charts.js'),
    absolute: true,
    replacements: [
      ['_internal_tickLength: 5', '_internal_tickLength: 0'],
      ['rendererOptions._internal_paddingInner = currentFontSize / 12 * rendererOptions._internal_tickLength;', 'rendererOptions._internal_paddingInner = 3;'],
      ['rendererOptions._internal_paddingOuter = currentFontSize / 12 * rendererOptions._internal_tickLength;', 'rendererOptions._internal_paddingOuter = 0;'],
      ['+ 5 + resultTickMarksMaxWidth', '+ 0 + resultTickMarksMaxWidth'],
      [
        'ctx.textAlign = this._private__isLeft ? "right" : "left";',
        'ctx.textAlign = "right";',
      ],
      [
        'Math.round(tickMarkLeftX + rendererOptions._internal_tickLength + rendererOptions._internal_paddingInner);',
        'Math.round(this._private__size.width - 1);',
      ],
      ['_internal_radius: 2 * horizontalPixelRatio,', '_internal_radius: 4 * horizontalPixelRatio,'],
      ['var radius$1 = 2;', 'var radius$1 = 4;'],
      [
        `ctx.beginPath();
      ctx.moveTo(x1scaled, y1scaled);
      ctx.lineTo(x1scaled, y2scaled - radiusScaled);
      ctx.arcTo(x1scaled, y2scaled, x1scaled + radiusScaled, y2scaled, radiusScaled);
      ctx.lineTo(x2scaled - radiusScaled, y2scaled);
      ctx.arcTo(x2scaled, y2scaled, x2scaled, y2scaled - radiusScaled, radiusScaled);
      ctx.lineTo(x2scaled, y1scaled);
      ctx.fill();`,
        `ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x1scaled, y1scaled, x2scaled - x1scaled, y2scaled - y1scaled, radiusScaled);
      } else {
        ctx.moveTo(x1scaled + radiusScaled, y1scaled);
        ctx.lineTo(x2scaled - radiusScaled, y1scaled);
        ctx.arcTo(x2scaled, y1scaled, x2scaled, y1scaled + radiusScaled, radiusScaled);
        ctx.lineTo(x2scaled, y2scaled - radiusScaled);
        ctx.arcTo(x2scaled, y2scaled, x2scaled - radiusScaled, y2scaled, radiusScaled);
        ctx.lineTo(x1scaled + radiusScaled, y2scaled);
        ctx.arcTo(x1scaled, y2scaled, x1scaled, y2scaled - radiusScaled, radiusScaled);
        ctx.lineTo(x1scaled, y1scaled + radiusScaled);
        ctx.arcTo(x1scaled, y1scaled, x1scaled + radiusScaled, y1scaled, radiusScaled);
      }
      ctx.fill();`,
      ],
    ],
  },
];

for (const patch of patches) {
  const filePath = patch.absolute ? patch.file : path.join(dist, patch.file);
  if (!fs.existsSync(filePath)) continue;

  let source = fs.readFileSync(filePath, 'utf8');
  let changed = false;

  for (const [from, to] of patch.replacements) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) continue;
    source = source.replaceAll(from, to);
    changed = true;
  }

  if (changed) fs.writeFileSync(filePath, source);
}
