# 薇薇看板 · Code Wiki

> 加密期权监控与头寸压力测试看板 · React 19 + Vite + Tailwind v4

本文档对仓库 `weiwei-new` 进行系统化梳理，覆盖项目架构、模块职责、关键类与函数、依赖关系以及运行方式，可作为新人上手与长期维护的参考。

---

## 目录

1. [项目概览](#1-项目概览)
2. [运行与构建](#2-运行与构建)
3. [整体架构](#3-整体架构)
4. [目录结构](#4-目录结构)
5. [核心运行流程](#5-核心运行流程)
6. [模块职责详解](#6-模块职责详解)
7. [关键类型 / 函数说明](#7-关键类型--函数说明)
8. [Widget 注册中心（registry）](#8-widget-注册中心registry)
9. [头寸压力测试（PositionBuilder）](#9-头寸压力测试positionbuilder)
10. [样式 / 主题体系](#10-样式--主题体系)
11. [依赖关系](#11-依赖关系)
12. [项目约定 & 注意事项](#12-项目约定--注意事项)

---

## 1. 项目概览

| 字段 | 值 |
| --- | --- |
| 名称 | `react-example`（中文展示名「薇薇看板」） |
| 私有 | `true`（未发布 npm） |
| 类型 | ESM 应用 |
| 框架 | React 19 + React Router 7 + Vite 6 |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite` 插件） |
| 图表 | ECharts 6（`echarts-for-react`）+ Plotly + 大量内联 SVG |
| 动效 | `motion`（原 Framer Motion） |
| 状态 | 本地组件 state + `useRef` 缓存；`zustand` 已引入但当前未使用 |
| 数据源 | Deribit 公共 REST API + WebSocket（`wss://www.deribit.com/ws/api/v2`） |
| AI Studio 关联 | [`https://ai.studio/apps/5c1eb95a-48d4-4640-b8a2-36ca52f1f2ba`](https://ai.studio/apps/5c1eb95a-48d4-4640-b8a2-36ca52f1f2ba) |

应用包含两条主路由：

- `/monitor` — 多标签页（行情 / 波动率 / 持仓 / 资金流 / 分析 / 交易工具）实时监控看板。
- `/position-builder` — 期权头寸压力测试与多场景情景分析工具。

UI 风格：深色背景 + 毛玻璃 (`backdrop-filter: blur+saturate`) + 薄荷绿（`#25e889`）单一品牌色。

---

## 2. 运行与构建

### 2.1 先决条件

- Node.js（无显式版本约束，建议 ≥ 18，因为依赖了 React 19 与 Vite 6）。
- 现代浏览器（依赖 `backdrop-filter`、ESM、WebSocket）。

### 2.2 环境变量

`.env` / `.env.local` 中可设置：

| 变量 | 用途 |
| --- | --- |
| `GEMINI_API_KEY` | 透传到 `process.env.GEMINI_API_KEY`（[vite.config.ts:11](vite.config.ts:11)） |
| `API_PROXY_TARGET` | `/api`、`/ws` 代理目标，默认 `http://localhost:8787` |
| `DISABLE_HMR` | `'true'` 时关闭 HMR（用于 AI Studio 内置 agent 编辑环境） |

[vite.config.ts](vite.config.ts) 还固定声明了第三方 ws 代理：

- `/deribit-ws` → `wss://www.deribit.com/ws/api/v2` （`secure: false`，绕过本地证书问题）

### 2.3 npm scripts（[package.json](package.json)）

| 脚本 | 命令 | 说明 |
| --- | --- | --- |
| `dev` | `vite --port=3000 --host=0.0.0.0` | 本地开发服务器 |
| `build` | `vite build` | 生产构建，输出至 `dist/` |
| `preview` | `vite preview` | 预览构建产物 |
| `clean` | `rm -rf dist` | 清理输出 |
| `lint` | `tsc --noEmit` | 仅做类型检查，不生成 JS |

构建侧通过 `manualChunks` 把重型库拆包以避免主包过大：`vendor-plotly` / `vendor-motion` / `vendor-react`。

### 2.4 一句话启动

```bash
npm install
npm run dev   # → http://localhost:3000
```

---

## 3. 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        index.html  →  main.tsx                       │
│                  (StrictMode + BrowserRouter + App)                  │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│   App.tsx — 顶栏（Logo + 导航 + 行情 ticker + 时钟 + 实时指示器）   │
│   ├─ /monitor          → MonitorPage                                 │
│   ├─ /position-builder → PositionBuilderPage                         │
│   ├─ /         → redirect → /monitor                                 │
│   └─ *         → redirect → /monitor                                 │
└──────────────────────────────────────────────────────────────────────┘
                                  │
        ┌─────────────────────────┴─────────────────────────────┐
        ▼                                                       ▼
┌────────────────────────────┐               ┌─────────────────────────────────┐
│ MonitorPage                │               │ PositionBuilderPage             │
│  ├─ MonitorLayout (tabs)   │               │  └─ PositionBuilder (2593 行)   │
│  ├─ ElasticLayout (滚动)   │               │      • 多腿期权管理             │
│  ├─ WidgetCard × N         │               │      • BS 估值 + 高阶 Greeks    │
│  ├─ widgets (registry)     │               │      • 情景矩阵 / 历史压力      │
│  └─ InspectorDrawer (右抽屉)│              │      • Deribit WS 实时价格      │
└────────────────────────────┘               └─────────────────────────────────┘
                │                                              │
                ▼                                              ▼
    registry/monitorWidgets.tsx ─── 共享 Deribit 轮询调度器 (POLLERS map)
    (50+ Widget · 内含 BS Greeks · 实时/历史数据 hooks)
```

关键设计要点：

1. **单页 + 多路由**：所有交互保持在同一 React 树内，顶栏与 footer 常驻；路由切换只影响 `<main>` 区。
2. **Widget Registry 集中实现**：所有监控小部件都集中在 [src/registry/monitorWidgets.tsx](src/registry/monitorWidgets.tsx)（7918 行）中导出，便于在 `MonitorPage` 中按 tab 自由组合。
3. **共享数据轮询器**：自实现的 `POLLERS` 单例 + `subscribeData()` 复用机制，避免每个 widget 各自起 `setInterval`，并在 `document.hidden` 时自动暂停。
4. **客户端衍生计算**：Black-Scholes、Greeks、AR(1) 预测、滚动 RV、波动率锥分位等全部前端实时计算，无后端服务。
5. **可点击图表 → Inspector**：`VolSmile`、`IVSurface` 等图表点击单元格通过 `useMonitorSelection` 把选区写入 state，右侧 `InspectorDrawer` 用 Black-Scholes 推导理论 Greeks 并展示。

---

## 4. 目录结构

```
weiwei-new/
├── index.html                       # SPA 入口
├── vite.config.ts                   # Vite + Tailwind + manualChunks + proxy
├── tsconfig.json                    # ESNext / React JSX / 路径别名 @/*
├── package.json                     # 依赖与 scripts
├── AGENTS.md                        # 项目约定：改完立即 git commit
├── README.md                        # AI Studio 启动指引
├── public/                          # 静态资源（含 /avatar.png）
├── dist/                            # 构建产物（gitignored 之外的临时目录）
└── src/
    ├── main.tsx                     # createRoot + BrowserRouter
    ├── App.tsx                      # 顶栏 + Routes
    ├── index.css                    # Tailwind + 全局玻璃主题（972 行）
    ├── vite-env.d.ts
    ├── PositionBuilder.d.ts         # plotly.js-dist 模块声明
    │
    ├── pages/
    │   ├── MonitorPage.tsx          # 监控页面：tabs × widgets 网格
    │   └── PositionBuilderPage.tsx  # 仅做转发到 PositionBuilder
    │
    ├── components/
    │   ├── ElasticLayout.tsx        # 含 rubber-band overscroll 的滚动容器
    │   ├── card/
    │   │   ├── WidgetCard.tsx          # 通用 widget 卡片（含 4 种状态视图）
    │   │   ├── WidgetCardSkeleton.tsx  # 骨架屏
    │   │   └── useWidgetCardActions.ts # hover/触控按钮显隐策略
    │   └── popup/
    │       ├── Popup.tsx               # HoverPopover + Drawer (motion 动画)
    │       └── popup.css
    │
    ├── features/
    │   ├── monitor/
    │   │   ├── types.ts                # Coin / MonitorTabId / MonitorSelection
    │   │   ├── components/
    │   │   │   ├── MonitorLayout.tsx     # 顶部 Tabs + 币种段控
    │   │   │   ├── MonitorHeader.tsx     # (空文件，预留)
    │   │   │   └── InspectorDrawer.tsx   # 右侧抽屉 + BS Greeks 计算
    │   │   ├── hooks/
    │   │   │   ├── useMonitorQueryState.ts  # tab / coin 本地状态
    │   │   │   └── useMonitorSelection.ts   # 选中单元状态
    │   │   └── data/
    │   │       └── mock.ts             # 静态 fallback / 演示数据
    │   └── positionBuilder/
    │       └── PositionBuilder.tsx     # 头寸压力测试主组件（2593 行）
    │
    ├── registry/
    │   └── monitorWidgets.tsx       # 50+ 监控 widget 总注册 + 数据层
    │
    ├── motion/
    │   └── tokens.ts                # EASE_EMPHASIS / DUR_FAST / DUR_POP / DUR_CARD
    │
    ├── lib/
    │   └── utils.ts                 # cn() — clsx + tailwind-merge
    │
    ├── store/                       # （空，预留 zustand 容器）
    ├── hooks/                       # （空）
    └── constants/                   # （空）
```

---

## 5. 核心运行流程

### 5.1 应用启动

1. [src/main.tsx](src/main.tsx) 调用 `createRoot(...)`，把 `<App />` 挂载到 `#root`。
2. `BrowserRouter` 提供 history 上下文；`StrictMode` 启用双 effect 调试。
3. `App.tsx`：
   - 内部 hook `useDeribitIndexPrices()`（[src/App.tsx:22](src/App.tsx:22)）每 2 s 拉取 `get_index_price?index_name=btc_usd/eth_usd`，渲染顶栏行情 ticker。
   - `useEffect` 监听 `scroll`，给 `<html>` 加 `.is-scrolling` class（用于 CSS 在滚动时收起滚动条）。
   - `Routes` 把 `/monitor` 与 `/position-builder` 各自包在 `absolute inset-0` 的容器里，再加两个 `Navigate` 把 `/`、`*` 重定向到 `/monitor`。

### 5.2 监控页流程（/monitor）

1. `MonitorPage`（[src/pages/MonitorPage.tsx](src/pages/MonitorPage.tsx)）：
   - 从 `useMonitorQueryState()` 获得 `tab/coin`，从 `useMonitorSelection()` 获得选中态。
   - 渲染一次性 `<GlobalGradDefs />`（[src/registry/monitorWidgets.tsx:621](src/registry/monitorWidgets.tsx:621)）：注入全局 SVG 渐变 `id`，被所有内联图表的 `fill="url(#wg-green)"` 引用，节省每个 widget 重复 `<defs>`。
   - 包一层 `MonitorLayout`（顶部 tab 切换），里面再嵌 `ElasticLayout`（橡皮筋滚动）。
   - 根据 `tab` 在 `<div className="grid grid-cols-12 gap-2">` 中分组渲染 widget。每个 widget 用 `WidgetCard` 包裹（标题、密度、固定高度 + col-span）。
2. Widget 内部以 `useDeribitOptions(coin)` / `useDeribitHistory(coin)` 订阅共享数据，渲染 SVG / ECharts。
3. 用户在波动率微笑或 IV 偏斜表上点击 → 把 `MonitorSelection`（`smilePoint` 或 `skewCell`）写入状态 → 右侧 `InspectorDrawer` 打开 → 内部用 BS 估算理论 Greeks 展示。

### 5.3 头寸压力测试流程（/position-builder）

1. `PositionBuilderPage` 直接 `return <PositionBuilder />`。
2. `PositionBuilder`（[src/features/positionBuilder/PositionBuilder.tsx](src/features/positionBuilder/PositionBuilder.tsx)）：
   - 从 `localStorage['pb_state_v1']` 还原 `symbol / spot / baseIv / legs`，并过滤已到期的 leg。
   - 通过 Deribit WebSocket 订阅 `deribit_price_index.<symbol>`，实时刷新 spot 价格。
   - 通过 REST `public/get_instruments` 拉取期权链，按到期日分组。
   - 每条 leg 可独立选择合约（带 `bid/ask` 实价）或保留 BS 估值。
   - 计算引擎：`bsPrice()` + `bsGreeks()` → 全组合 P&L 曲线 / 时间切片 / Spot×IV 情景矩阵 / Greeks 热力图 / Merton 跳跃扩散 VaR。
   - UI 左侧腿列表/参数；右侧 5 个标签页（`chart` / `scenario` / `greeks` / `risk` / `structure`）。

---

## 6. 模块职责详解

### 6.1 `src/App.tsx`

- `useDeribitIndexPrices()`：自维护 `prevRef`（用于上一帧涨跌判断）与 `baselineRef`（用于相对开局的百分比变动），每 2 s 拉一次 BTC/ETH 指数价。
- `TokenIcon({ symbol })`：内联 BTC/ETH/SOL/BNB SVG 图标 + 兜底字母圆点。
- `PriceTicker`：价格变动时短暂 flash 绿/红 200 ms（`text-trade-up` / `text-trade-down`）。
- `DigitalClock`：纽约时间显示，每秒重渲染。
- `AppNavigationDropdown`：左上九宫格悬浮菜单 + 「监控」「头寸」两个文本按钮，使用 `HoverPopover`。
- `TickerBar`：把 `useDeribitIndexPrices` 的两条数据渲染成 `<PriceTicker>` 列表。
- 默认导出 `App`：负责整体的三层 flex 布局（44 px header / 主区 / 34 px footer）。

### 6.2 `src/pages/MonitorPage.tsx`

- 整合所有可视组件，按当前 `tab` 渲染不同 widget 集合。
- 透传 `coin` 与 `setCoin`，使顶部段控（`MonitorLayout`）与每个 widget 内可独立的 `CoinTabs` 同步。
- 通过 `onPickSmilePoint` / `onPickSkewCell` 把 widget 内部触发的选中事件汇聚到 `selection`，再传给 `InspectorDrawer`。

### 6.3 `src/features/monitor/`

| 文件 | 职责 |
| --- | --- |
| `types.ts` | 单一来源真相：`Coin = 'BTC' \| 'ETH'`、`MONITOR_TABS`（6 个 tab 元数据，`as const`）、`MonitorSelection` 联合类型。 |
| `components/MonitorLayout.tsx` | 顶部 44 px sticky 工具条；`CoinSeg`（BTC=琥珀 / ETH=蓝）+ Tabs + 跳「头寸」链接。 |
| `components/InspectorDrawer.tsx` | 右侧抽屉。内含 Beasley-Springer-Moro 实现的 `normInv`、`normPDF`，`computeGreeks(S, T, iv, absDelta, type)` 由 Delta 反推行权价并计算 Δ/Γ/Θ/ν 与 BS 价格。 |
| `hooks/useMonitorQueryState.ts` | 极简：仅 `useState` 维护 `tab/coin`，名字暗示日后可升级为 URL 同步。 |
| `hooks/useMonitorSelection.ts` | `{ selection, setSelection, clearSelection, open }`，`open = selection.type !== 'none'`。 |
| `data/mock.ts` | 兜底 / 演示数据：`VOL`、`SMILE`、`SKEW_DATA`、`VRP_HIST`、`IVR_HIST`、`OPTIONS_SKEW`、`VOL_CONE`、`FIXED_TENOR_VAR`、`IMP_DIST`（由 `lnDist()` 生成对数正态分布）。 |

### 6.4 `src/components/`

| 文件 | 职责 |
| --- | --- |
| `ElasticLayout.tsx` | 模拟原生 iOS 橡皮筋的滚动容器；常驻 `REST_GAP=6` 顶部 + `MAX_EXTRA=20` 拉伸，使用 `motion` 的 `useMotionValue` + `animate(spring)`；同时支持触摸/指针拖拽与 wheel 过滚动两种触发路径。 |
| `card/WidgetCard.tsx` | 通用 widget 卡片。导出：`WidgetCardAction`、`WidgetCardStatus`、`CardTone`、`useCardHeader()`（让子组件能往 header 右侧塞按钮如 `CoinTabs`）；支持 `loading/empty/error/stale` 四种非 ready 状态自动渲染 `StatusPane`。 |
| `card/WidgetCardSkeleton.tsx` | shimmer 动画占位。 |
| `card/useWidgetCardActions.ts` | 媒体查询 `(hover: hover)` 与 `(pointer: fine)`，决定 actions 区域是「常显」还是「悬停揭示」。 |
| `popup/Popup.tsx` | 三个工具组件：`Backdrop`（带可选模糊）、`PopupCard`（基础 motion 卡片）、`HoverPopover`（无背景，给悬浮菜单用）、`Drawer`（侧滑抽屉，处理 Esc 关闭与 body 滚动锁）。 |
| `popup/popup.css` | 用于 Popup 的全局类（如 `.popup-backdrop`、`.popup-card`）。 |

### 6.5 `src/motion/tokens.ts`

```ts
EASE_EMPHASIS = [0.22, 1, 0.36, 1];  // Material/iOS emphasized easing
DUR_FAST = 0.12;   DUR_POP = 0.14;   DUR_CARD = 0.16;
```

供 `motion/react` 直接使用，保持全局一致动效。

### 6.6 `src/lib/utils.ts`

只有一个 `cn(...inputs)`：`twMerge(clsx(inputs))`，用于安全合并 Tailwind 类名（自动解决 `bg-red-500` 与 `bg-blue-500` 后者覆盖前者的冲突）。

---

## 7. 关键类型 / 函数说明

### 7.1 全局类型

```ts
// src/features/monitor/types.ts
type Coin = 'BTC' | 'ETH';
type MonitorTabId = 'market' | 'vol' | 'oi' | 'flow' | 'analysis' | 'trade';
type MonitorSelection =
  | { type: 'none' }
  | { type: 'smilePoint'; coin: Coin; tenor: string; label: string; value: number }
  | { type: 'skewCell';   coin: Coin; row: string;   col: string;   value: number };
```

```ts
// src/components/card/WidgetCard.tsx
type WidgetCardStatus =
  | { type: 'ready' }
  | { type: 'loading'; skeleton?: React.ReactNode }
  | { type: 'empty'; title?; description?; action? }
  | { type: 'error'; title?; description?; action? }
  | { type: 'stale'; since?: number };
```

### 7.2 数据层（registry 内部）

```ts
interface ParsedOption {
  strike: number; type: 'C'|'P'; daysToExp: number; T: number;
  iv: number; spot: number; delta: number; oi: number; volume: number;
}
interface ExpiryGroup { label; daysToExp; calls; puts; atmIV; rr25; bf25; rr10; bf10; }
interface DeribitData { spot; dvol30; pcr; expiries; callVol24h; putVol24h; fetchedAt; }
interface HistoryData { vrp; ivr; ivRankCurrent; dvolChange24h; volCone; rvByTenor; dvolSeries; rv30Series; fetchedAt; }
```

### 7.3 Black-Scholes 工具集（在 registry 与 InspectorDrawer 中各有一份）

| 函数 | 含义 |
| --- | --- |
| `normCDF(x)` | Abramowitz & Stegun 5 次多项式近似 Φ(x) |
| `normPDF(x)` | 标准正态密度 |
| `normInv(p)` | Beasley-Springer-Moro 反正态分布（仅 InspectorDrawer 使用） |
| `bsCall(S,K,T,iv)` / `bsPut(S,K,T,iv)` | 期权理论价（r=q=0，加密惯例） |
| `bsDelta(S,K,T,iv,type)` | Δ |
| `bsGamma(S,K,T,iv)` | Γ |
| `bsVega(S,K,T,iv)` | ν per 1% IV |
| `bsTheta(S,K,T,iv)` | Θ per 1 日历日 |
| `bsVanna / bsCharm` | 通过数值 bump (±1 IV / ±1 日) 求 ΔΔ |
| `closestDeltaIV(opts, target)` | 在一组 `ParsedOption` 中找最接近目标 |Δ| 的 IV |

### 7.4 时间序列工具

| 函数 | 含义 |
| --- | --- |
| `rollingRV(logRets, window)` | 滚动年化已实现波动率（√252×100） |
| `percentileAt(sorted, p)` | 线性插值分位数（用于波动率锥） |
| `fitAR1(series)` | OLS 拟合 `y_t = α + β·y_{t-1}`，返回 `{α, β, μ}`；β 钳位到 (−0.999, 0.999) |
| `forecastAR1(current, α, β, h)` | h 步均值回归预测：`μ + β^h · (y_t − μ)` |
| `lnDist(S, iv, T, pts)` | 对数正态密度采样，用于 implied move 概率分布 |

### 7.5 SVG 绘图辅助

| 函数 | 含义 |
| --- | --- |
| `mapPts(data, W, H, lo, hi, px, py)` | 数据 → SVG 坐标映射 |
| `poly(pts)` | 坐标数组 → `polyline points` 字符串 |
| `smooth(pts)` | 三次贝塞尔平滑路径 `d` |
| `area(pts, H, padY)` | 把 `smooth(pts)` 收尾到底边形成填充区域 |
| `heatColor(val, maxAbs)` | 绿/红发散热力图配色 |

### 7.6 共享调度器

| API | 说明 |
| --- | --- |
| `subscribeData<T>(key, fetcher, intervalMs, subscriber)` | 同 `key` 的多个组件复用同一份 `setInterval` 与 `lastData`；返回取消订阅函数。 |
| `POLLERS: Map<key, PollerEntry>` | 全局轮询表。 |
| `_pauseAll()` / `_resumeAll()` | 监听 `visibilitychange`：tab 隐藏时暂停所有定时器，回到前台立刻补刷一次。 |
| `DERIBIT_CACHE` / `HIST_CACHE` | TTL 缓存（30 s / 5 min），由 `fetchDeribitOptions` 与 `fetchDeribitHistory` 内部使用。 |
| `SKEW_BUFFER` | 会话级 Skew 快照环形缓冲（容量 480，约 4 小时 @ 30 s），供 `SkewHistoryWidget` 等读取。 |

### 7.7 UI 辅助

| 名称 | 说明 |
| --- | --- |
| `useCoinControl({coin, onCoinChange})` | 组件可受控/非受控混用：父传 `coin` 即受控，否则维护本地 state。 |
| `WidgetShell` | 把 `CoinTabs` 注入到 `WidgetCard` 头部右侧（依赖 `useCardHeader().setHeaderRight`）。 |
| `pickExpiries(expiries, targets[])` | 在 `ExpiryGroup[]` 中按目标天数选最近的一组，确保不重复。 |
| `CoinTabs` / `LiveBadge` / `Skeleton` | 通用小组件。 |
| `ivrColor/ivrLabel/pcrColor/pcrLabel` | IV Rank、PCR 的阈值 → 颜色 / 中文标签映射。 |

---

## 8. Widget 注册中心（registry）

[src/registry/monitorWidgets.tsx](src/registry/monitorWidgets.tsx) 是项目最大的单文件（约 7918 行）。它扮演三层职责：

1. **底层数学 & SVG 工具**（行 1–610）
2. **数据层**：Deribit 选项快照、历史快照、共享轮询器、会话级缓冲（行 130–580）
3. **Widget 实现**：上层组件全部以「`coin/onCoinChange` 受控 + `WidgetShell` 注入 CoinTabs + 数据 hook」的统一模式实现（行 990+）

### 8.1 Widget 列表（按导出顺序）

> 全部以 `CoinControlProps = { coin?: Coin; onCoinChange?: (c: Coin) => void }` 为入参。带 `*` 的不接受 coin 参数（如 `FearGreedWidget`、`PayoffProfileWidget`、`BTCETHSpreadWidget`、`CorrelationWidget`）。

| 模块 | Widget |
| --- | --- |
| **总览/工具** | `GlobalGradDefs`（仅导出渐变 defs，非 widget） |
| **行情 (market)** | `SpotTickerWidget`、`SentimentCompositeWidget`、`OrderbookDepthWidget`、`AlertsWidget`、`IVSignalWidget`、`ImpliedMoveWidget`、`LiveOptionsChainWidget`、`BlockTradeWidget`、`VolOverviewWidget`、`StrategyPricerWidget` |
| **波动率 (vol)** | `DVOLSeriesWidget`、`SkewHistoryWidget`、`TermStructureDriftWidget`、`VolSmileWidget`、`IVSurfaceWidget`、`OptionsSkewWidget`、`VRPHistoryWidget`、`VannaCharmWidget`、`VolConeWidget`、`IVRankHistoryWidget`、`RVvsIVTenorWidget`、`DollarGreeksWidget`、`CalendarSpreadWidget`、`ForwardVolWidget`、`FixedTenorWidget`、`ImpliedDistWidget` |
| **持仓 (oi)** | `OIByStrikeWidget`、`GEXWidget`、`DEXWidget`、`KeyLevelsWidget`、`ExpiryCalendarWidget`、`TopOIWidget`、`OIDeltaWidget`、`GammaPinWidget` |
| **资金流 (flow)** | `FundingRateWidget`、`FuturesBasisWidget`、`OptionsFlowWidget`、`FearGreedWidget`*、`PCRHistoryWidget`、`PremiumFlowWidget`、`LargeTradeAlertWidget` |
| **分析 (analysis)** | `VolRegimeWidget`、`GreeksScenarioWidget`、`PriceTargetProbWidget`、`EWMAForecastWidget`、`BTCETHSpreadWidget`*、`TenorIVHeatmapWidget`、`CorrelationWidget`*、`IVCheapnessWidget` |
| **交易工具 (trade)** | `PositionTrackerWidget`、`PayoffProfileWidget`*、`VerticalSpreadPricerWidget`、`WatchlistWidget`、`RollCostWidget` |
| **预留/未挂载** | `PolymarketWidget` |

### 8.2 标准 Widget 模板

```tsx
export const FooWidget = ({ coin: coinProp, onCoinChange }: CoinControlProps) => {
  const { coin, setCoin } = useCoinControl({ coin: coinProp, onCoinChange });
  const { data, loading } = useDeribitOptions(coin);            // 或 useDeribitHistory
  return (
    <WidgetShell coin={coin} setCoin={setCoin}>
      {/* SVG / ECharts / 自定义图表 */}
    </WidgetShell>
  );
};
```

`WidgetShell` 会同时：(1) 维持 widget 内容的 flex 收缩；(2) 通过 `useCardHeader().setHeaderRight` 把 `<CoinTabs>` 注入 `WidgetCard` 头部右上角。

### 8.3 数据源映射

| Hook | 调用的 REST 端点 | 频率 |
| --- | --- | --- |
| `useDeribitOptions(coin)` | `public/get_book_summary_by_currency?currency=BTC|ETH&kind=option` | TTL 30 s |
| `useDeribitHistory(coin)` | `get_index_price_history`（750 天日 K）+ `get_volatility_index_data`（365 天日 DVOL） | TTL 5 min |
| App 顶栏 | `public/get_index_price?index_name=btc_usd/eth_usd` | 2 s |
| PositionBuilder | WS `deribit_price_index.<index>` + REST `public/get_instruments`、`public/ticker` | 实时 / 按需 |

---

## 9. 头寸压力测试（PositionBuilder）

[src/features/positionBuilder/PositionBuilder.tsx](src/features/positionBuilder/PositionBuilder.tsx) 是仓库中的「重型」业务组件，约 2593 行；它本身就是一个独立子应用。

### 9.1 计算核

- `bsPrice(S, K, T, sigma, type)`、`bsGreeks(...)`：与 registry 中实现互相独立但等价；额外暴露二阶 Greeks：`vanna`、`volga`、`charm`（数值微分一日）、`speed`。
- `formatHours(h)`：`24` → `1d`，`30` → `1d6h`。
- `roundStrike(price, step)`：按品种粒度（BTC 1000 / ETH 50 / SOL 5）取整。

### 9.2 入参与预设

```ts
PRESETS = { BTC: { spot: 65000, iv: 0.55, strikeStep: 1000 },
            ETH: { spot: 3000,  iv: 0.7,  strikeStep: 50 },
            SOL: { spot: 150,   iv: 0.85, strikeStep: 5 } };
DERIBIT_INDEX = { BTC: 'btc_usd', ETH: 'eth_usd', SOL: 'sol_usd' };
```

### 9.3 策略模板

`TEMPLATES`（[src/features/positionBuilder/PositionBuilder.tsx:140](src/features/positionBuilder/PositionBuilder.tsx:140)）一键生成下列策略的 leg 数组：

`longCall · longPut · coveredCall · bullCallSpread · bearPutSpread · longStraddle · shortStrangle · ironCondor · calendar`

### 9.4 情景与压力

- `SCENARIO_PRESETS`：包含通用应力（急跌 / 崩盘 / 暴涨 / IV 压缩）与 5 个历史事件（Black Thursday、LUNA、FTX、2021 顶/牛）。
- `SPOT_OFFSETS = [-30..30%]`, `IV_OFFSETS = [+30..-30 pts]` — 用于 P&L 情景矩阵。
- `HEATMAP_SPOT × HEATMAP_IV` — Greeks 热力图轴。
- 关联应力 (`correlatedMode`)：`Δσ = -ρ × volBeta × ΔS/S`，自动联动 IV 与 spot。
- Merton 跳跃-扩散 VaR：参数 `jumpLambda / jumpMuPct / jumpSigPct`，可开启 `showJumpRisk`。

### 9.5 持久化

- `localStorage['pb_state_v1']` ← `{ symbol, spot, baseIv, legs }`（600 ms 防抖写入）。
- `localStorage['pb_scenarios_v1']` ← 自定义情景列表。
- 启动时过滤掉 `expiryTs <= now` 的 leg。

### 9.6 实时数据

- Deribit WS：`wss://www.deribit.com/ws/api/v2`，订阅 `deribit_price_index.<index>`；断开后 3 s 自动重连。
- 期权链：`public/get_instruments?currency=&kind=option&expired=false`。
- 每条 leg 选定合约后通过 `public/ticker` 拉 `best_bid / best_ask`，乘以 `underlying_price` 折算成 USDT 价。

### 9.7 UI 拆分（右栏 5 个 tab）

| Tab | 内容 |
| --- | --- |
| `chart` | 主 P&L 曲线、时间切片叠加（`showTimeSlices`） |
| `scenario` | 7×5 情景矩阵 + 应力预设 + 自定义情景保存 |
| `greeks` | Δ/Γ/ν 热力图（`heatmapMetric` 切换） |
| `risk` | Merton 跳跃 VaR、IV Rank 手动范围 |
| `structure` | 各到期日的 Greeks 分布、日历视图 |

---

## 10. 样式 / 主题体系

`src/index.css`（972 行）使用 Tailwind v4 的 `@theme` 语法集中声明 CSS 变量：

- **品牌色**：`--color-brand = #25e889`（薄荷绿），全局只有这一个。
- **背景层**：`--color-bg-base / -dim / -deep / -card / -surface-1..6 / -hover`，全部基于半透明白色叠加在纯黑底色上，配合 `backdrop-filter` 产生玻璃质感。
- **边框**：`--color-border-subtle / -strong`。
- **交易色**：`--color-trade-up: #25a750`、`--color-trade-down: #ca3f64`。
- **动效令牌**：`--ease-emphasis: cubic-bezier(0.22, 1, 0.36, 1)`、`--dur-fast/-pop/-card`，与 `src/motion/tokens.ts` 一一对应。
- **CSS 类**：`.glass`（22 px 模糊卡片）、`.glass-header`（30 px 顶栏）、`.glass-bar`、`.widget-card / -head / -head-left / -name / -meta / -actions / -body / -foot`、`.skel-block`、`animate-shimmer`、`tnum`（等宽数字 `font-variant-numeric`）等。

字体：通过 Google Fonts 引入 Inter，fallback `PingFang SC / Microsoft YaHei / Noto Sans SC`，保证中英文混排美观。

---

## 11. 依赖关系

### 11.1 运行时依赖（`package.json` dependencies）

| 包 | 作用 |
| --- | --- |
| `react` / `react-dom` ^19 | UI 核心 |
| `react-router-dom` ^7 | 客户端路由（`BrowserRouter` + `Routes` / `Navigate` / `Link`） |
| `motion` ^12 | 动画原语（`motion.div`、`AnimatePresence`、`useMotionValue`、`animate`、spring） |
| `echarts` + `echarts-for-react` | PositionBuilder 中的 P&L、热力图 |
| `plotly.js-dist` | （部分 widget 预留 3D 曲面，类型由 `src/PositionBuilder.d.ts` 声明） |
| `lucide-react` | 图标 |
| `clsx` + `tailwind-merge` | `cn()` 实用工具 |
| `zustand` | 已引入但暂未使用（`src/store/` 为空，预留） |
| `@tailwindcss/vite` + `tailwindcss` | Tailwind v4 集成 |
| `@vitejs/plugin-react` | React Fast Refresh |
| `vite` | 构建与 dev server |

### 11.2 开发依赖

`typescript` ~5.8 · `@types/node` · `tsx`（脚本运行）。

### 11.3 模块依赖图（核心边）

```
main.tsx
  └── App.tsx
        ├── components/popup/Popup.tsx
        ├── lib/utils.ts
        └── pages/
              ├── MonitorPage.tsx
              │     ├── components/ElasticLayout.tsx        (motion)
              │     ├── components/card/WidgetCard.tsx
              │     ├── features/monitor/components/MonitorLayout.tsx
              │     ├── features/monitor/components/InspectorDrawer.tsx
              │     │     └── components/popup/Popup.tsx
              │     ├── features/monitor/hooks/*
              │     └── registry/monitorWidgets.tsx
              │           ├── features/monitor/data/mock.ts
              │           └── components/card/WidgetCard.useCardHeader
              └── PositionBuilderPage.tsx
                    └── features/positionBuilder/PositionBuilder.tsx
                          ├── echarts / echarts-for-react
                          └── lib/utils.ts
```

### 11.4 外部服务

- **Deribit REST**：`https://www.deribit.com/api/v2/public/...`
- **Deribit WebSocket**：`wss://www.deribit.com/ws/api/v2`
- **Google Fonts**：Inter 字体

dev 环境下，`/deribit-ws` 由 Vite proxy 转发到 `wss://www.deribit.com/ws/api/v2`，避免本地证书与跨域问题；当前代码主要直连 Deribit，但 proxy 已就位以便切换。

---

## 12. 项目约定 & 注意事项

### 12.1 项目硬规则（[AGENTS.md](AGENTS.md)）

> 每次改动完文件后，必须立即 `git add` 并 `git commit`，防止文件被回退。

这是 AI Studio 编辑环境的硬要求，任何脚本化操作都应遵守。

### 12.2 路径别名

`tsconfig.json` 与 `vite.config.ts` 都配置了 `@/*` → 项目根目录。例如 `@/src/lib/utils`。

### 12.3 HMR 与 AI Studio

`vite.config.ts` 注释明确指出：**不要修改 HMR / watcher 配置**——AI Studio 会通过 `DISABLE_HMR=true` 关闭 HMR 防止 agent 编辑时闪屏。

### 12.4 SVG 全局渐变

任何使用了 `fill="url(#wg-green)"` 等引用的图表，必须依赖 `MonitorPage` 顶部一次性渲染的 `<GlobalGradDefs />`；如果在新页面或独立预览中复用 widget，需要先挂载这个组件。

### 12.5 共享轮询器的 key 设计

`subscribeData` 的 key 形如 `options-BTC` / `history-ETH`，与币种强绑定；新增数据源时务必沿用「`<domain>-<coin>` / `<domain>`」格式以保持调度复用。

### 12.6 滚动相关 hack

`App.tsx` 在 window 滚动时给 `<html>` 加 `is-scrolling`，配合 CSS 自定义滚动条 / 滚动遮罩；调整滚动行为时记得保留 `useCapture=true` 与 800 ms 退出延迟。

### 12.7 Strict Mode 双 effect

由于启用了 `StrictMode`，所有 `useEffect` 在 dev 模式下会被执行两次（mount→unmount→mount）。`subscribeData` 已通过 `active` 标志 + `unsubscribe` 处理；`PositionBuilder` 的 WebSocket 也会经历一次额外的 close/reopen，属正常现象。

### 12.8 已知占位

- `src/store/`、`src/hooks/`、`src/constants/` 目前为空目录，是为后续重构预留（例如把 `useMonitorQueryState` 升级为 zustand store + URL 同步）。
- `src/features/monitor/components/MonitorHeader.tsx` 仅 2 行，亦为占位。
- `PolymarketWidget` 已实现但未挂载到 `MonitorPage` 任一 tab，可按需启用。

---

## 附录 A：常用入口速查

| 想看什么 | 文件 |
| --- | --- |
| 路由配置 | [src/App.tsx:340](src/App.tsx:340) |
| 监控页 tab → widget 网格 | [src/pages/MonitorPage.tsx:85](src/pages/MonitorPage.tsx:85) |
| 共享轮询器 | [src/registry/monitorWidgets.tsx:287](src/registry/monitorWidgets.tsx:287) |
| Deribit 期权解析 | [src/registry/monitorWidgets.tsx:188](src/registry/monitorWidgets.tsx:188) |
| BS Greeks（registry 版） | [src/registry/monitorWidgets.tsx:30](src/registry/monitorWidgets.tsx:30) |
| BS Greeks（Inspector 版） | [src/features/monitor/components/InspectorDrawer.tsx:56](src/features/monitor/components/InspectorDrawer.tsx:56) |
| 头寸 BS / 高阶 Greeks | [src/features/positionBuilder/PositionBuilder.tsx:39](src/features/positionBuilder/PositionBuilder.tsx:39) |
| 策略模板 | [src/features/positionBuilder/PositionBuilder.tsx:140](src/features/positionBuilder/PositionBuilder.tsx:140) |
| 情景预设 | [src/features/positionBuilder/PositionBuilder.tsx:109](src/features/positionBuilder/PositionBuilder.tsx:109) |
| 玻璃主题 / Tailwind 变量 | [src/index.css:4](src/index.css:4) |
| 动效 token | [src/motion/tokens.ts](src/motion/tokens.ts) |
