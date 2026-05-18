# NEXUS 期权交易平台 — UI 设计规范 / 风格指南（Design System）

> 目的：这份文档面向“接手继续开发”的朋友。它不是单纯的视觉说明，而是把现有项目的 **风格、尺寸、交互、可复用 token 与工程写法** 固化为可执行的规范，减少后续开发的沟通成本与 UI 漂移。
>
> 本项目风格定位：**暗色交易终端（Trading Terminal）** —— 多层级暗色背景、低对比边线、数字信息密集但可读、涨跌语义色明确、交互微动效克制且快速。

---

## 0. 快速索引（你要改 UI 时先看这里）

### 规范来源（以源码为准）
- 全局主题 Token / 字体 / 滚动条 / widget-card / antd 覆写：`src/index.css`
- App Shell（顶部栏高度、主区域溢出策略、卡片/网格示例）：`src/App.tsx`
- Dashboard 网格（断点/列数/rowHeight/间距）与 Widget 容器结构：`src/pages/DashboardPage.tsx`
- 期权链 Deribit 风格（局部域变量、行高、字号、hover/selected）：`src/pages/deribit-options-chain.css`
- 弹层体系（Popover/Modal/Drawer）与默认动效：`src/components/popup/Popup.tsx` + `src/components/popup/popup.css`
- 弹性滚动容器：`src/components/ElasticLayout.tsx`
- 图表（lightweight-charts）：`src/components/LightweightChart.tsx`
- 期权链像素规格参考：`reference/deribit-desktop/pixel-spec.md`

### 工程写法底线（来自 shadcn 思路的落地版）
1. **语义 Token 优先**：能用 `bg-bg-card / border-border-subtle / text-brand-blue / text-trade-up` 就不要散落 raw hex。
2. **间距用 `gap-*`，避免 `space-x/y-*`**（新增代码不再引入 `space-*`）。
3. **条件 class 必须用 `cn()`**（`src/lib/utils.ts`）。
4. **Overlay 不要在业务里到处手写 z-index**：遵循本规范的“层级表”。
5. **交易 UI 的数字必须 tabular-nums**：用 `.tnum / .data-num / .strike-num`。

---

## 1. 视觉基调（Visual Style）

### 1.1 整体气质
- **暗色、克制、信息密集**：交易终端的默认状态应该“安静”，强调信息本身（价格、盈亏、希腊值）。
- **层级靠“背景深浅 + 轻边线 + 轻阴影”区分**，避免大量高饱和色块。
- **蓝色作为主强调色（Brand Blue）**：用于选中态、聚焦态、关键按钮、链接与高亮数值。
- **涨跌色严格语义化**：涨=绿、跌=红，不要做“为了好看”而改色。

### 1.2 颜色对比与可读性（推荐规则）
- 小字号（10–13px）的文本对比要更谨慎：尽量使用 `text-slate-300/400/500` 或项目已有的 `--color-text-muted` 语义。
- 表格/期权链的 hover 背景增亮要“轻”，避免强烈闪烁（现状是轻微 brightness/filter）。

---

## 2. Design Tokens（设计变量/颜色系统）

> Tailwind v4 的 token 定义集中在 `src/index.css` 的 `@theme { ... }`。你会在代码中看到类似：`bg-bg-deep`、`bg-bg-card`、`border-border-subtle`、`text-brand-blue`、`text-trade-up` 等 class，它们来源于这里的 `--color-*` 变量。

### 2.1 全局 Token（来自 `src/index.css`）

#### Brand（品牌色）
| Token | 值 | 用途 |
|---|---:|---|
| `--color-brand-blue` | `#4D7CFF` | 主强调色：选中态、主按钮、关键高亮 |
| `--color-brand-blue-deep` | `#191970` | 深蓝背景：Tab active 背景/hover 底色等 |
| `--color-brand-blue-soft` | `#C0CBF6` | 柔和蓝：可用于弱化文本或背景（慎用） |

#### Surface / Background（背景层级：从深到浅）
| Token | 值 | 推荐用途（示例） |
|---|---:|---|
| `--color-bg-base` | `#060606` | 最底层：header/main/footer 的底色 |
| `--color-bg-dim` | `#1F2021` | ticker/次底层条带 |
| `--color-bg-deep` | `#3E3F40` | App 背景（某些页面/区域） |
| `--color-bg-card` | `#131318` | 卡片底色（Card/Panel） |
| `--color-surface-1` | `#15151A` | 弹层底色（或更靠上的 surface） |
| `--color-surface-2` | `#1A1A24` | 卡片之上一级（hover/弹层内层） |
| `--color-surface-3` | `#1C1C24` | hover / 输入背景等 |
| `--color-surface-4` | `#1E1E26` | Tab 默认、输入容器等 |
| `--color-surface-5` | `#2A2A35` | Tab active/描边辅助等 |
| `--color-surface-6` | `#31333F` | 输入框激活、按钮按下等 |
| `--color-bg-hover` | `#26262E` | 卡片 hover 背景（轻微抬升） |

#### Borders（边线）
| Token | 值 | 用途 |
|---|---:|---|
| `--color-border-subtle` | `#2F2F38` | 默认分割线、卡片边线、表格细线 |
| `--color-border-strong` | `#3E3E4A` | 强调边线：hover/active/选中描边 |

#### Input / Text muted（表单与弱化文本）
| Token | 值 | 用途 |
|---|---:|---|
| `--color-input-bg` | `#31333F` | 输入框背景 |
| `--color-text-muted` | `#8B93A5` | 次级文本、说明文字、弱化数值 |

#### Trading（交易语义色）
| Token | 值 | 用途 |
|---|---:|---|
| `--color-trade-up` | `#1EC98C` | 涨/盈利/买盘/正向（success） |
| `--color-trade-down` | `#FF4D6A` | 跌/亏损/卖盘/负向（destructive） |

#### Radius（圆角基线）
| Token | 值 | 用途 |
|---|---:|---|
| `--radius-button` | `8px` | 默认按钮/小控件圆角 |
| `--radius-modal` | `12px` | 弹窗/面板圆角（PopupCard 默认也是 12px） |

### 2.2 语义别名建议（写法统一用语义，底层再映射到当前 token）
> 目前代码里同时存在“语义 token（bg-bg-card）”与“少量 raw hex”。为了后续维护，建议新增 UI 时优先遵循下面这套 **语义→当前 token** 的映射（先写在文档里即可，不强制立刻改代码）。

| 语义（概念） | 推荐映射到本项目 token |
|---|---|
| `background` | `--color-bg-base` |
| `card` | `--color-bg-card` |
| `popover / overlay` | `--color-surface-1`（或 `popup.css` 的 `--popup-card-bg`） |
| `border` | `--color-border-subtle` |
| `primary` | `--color-brand-blue` |
| `primary-contrast` | `text-white`（在高亮按钮内） |
| `muted-foreground` | `--color-text-muted` |
| `success` | `--color-trade-up` |
| `destructive` | `--color-trade-down` |

### 2.3 局部主题域：Deribit 期权链 Token（来自 `src/pages/deribit-options-chain.css`）
> 期权链使用 `.db-oc-root` 作为作用域容器，定义了 `--db-*` 变量；这是“局部设计系统”，不要让它泄漏到全局页面。

关键变量（节选，开发时建议按原文件完整查看）：
- Surfaces：`--db-bg-main / --db-bg-header / --db-bg-row-even / --db-bg-row-odd / --db-bg-strike / --db-bg-hover / --db-bg-selected`
- Lines：`--db-border / --db-border-strong`
- Text：`--db-text / --db-muted / --db-dim`
- Trading：`--db-up / --db-down / --db-warn`
- Accent：`--db-accent / --db-accent-soft / --db-accent-weak`
- Sizing rhythm：`--db-row-h: 32px`、`--db-cell-px`、`--db-font-cell`、`--db-font-header`

该文件还包含 `.db-oc-root.deribit` 的“桌面 Deribit 截图匹配调参”版本（更偏蓝、更接近现网），属于可切换风格配置。

### 2.4 选中高亮与滚动条（来自 `src/index.css`）
#### 文本选中（Selection）
- 根容器使用：`selection:bg-brand-blue/30`（见 `src/App.tsx` 根节点）。

#### 全局滚动条策略：默认“隐身”，滚动时显现品牌蓝
在 `src/index.css`：
- `::-webkit-scrollbar`：6px（横/竖）
- 默认 `scrollbar-thumb` 透明（`rgba(77, 124, 255, 0)`）
- 当 `html` 具备 `is-scrolling` class 时，thumb 变为品牌蓝并带透明度（`0.65` → active `0.9`）
- Firefox 使用 `scrollbar-color` 做同等策略

常用工具类：
- `.hide-scrollbar`：彻底隐藏滚动条（用于极窄容器或需要更“纯净”视觉的区域）

**规范建议**
- 列表/表格默认用“滚动时出现”的滚动条策略，避免 UI 长期被滚动条噪声干扰。
- 只有在空间极窄且滚动条会明显破坏布局时才用 `.hide-scrollbar`。

---

## 3. Typography（字体与数字规范）

### 3.1 全局字体
在 `src/index.css` 中：
- `--font-sans`：`Inter` + 中文 fallback（苹方/微软雅黑/Noto Sans SC 等）。
- `body` 默认使用：`font-sans`、`antialiased`、`font-normal`、`letter-spacing: -0.02em`，并开启 `font-variant-numeric: tabular-nums`（保证数字列对齐）。

### 3.2 数字排版（交易 UI 的硬规则）
项目定义了三个常用类（见 `src/index.css`）：
- `.tnum`：tabular-nums（适合所有数据表格/行情数字）。
- `.data-num`：用于期权链/表格数据（Inter + tabular-nums）。
- `.strike-num`：执行价（Inter 600 + tabular-nums）。

#### 使用场景清单（新增 UI 必须遵循）
- 价格、涨跌幅、盈亏、希腊值、成交量、持仓量、保证金率、盘口量、订单簿、K 线 tooltip 数值：**必须 `.tnum` 或 `.data-num`**。
- 执行价（Strike）与关键锚点数值：**用 `.strike-num`**（更突出、避免“看不见主线”）。

---

## 4. Layout & Page Sizing（页面大小、布局与响应式）

### 4.1 App Shell（整体框架）
在 `src/App.tsx`：
- 根容器：`h-screen overflow-hidden`（应用占满视口，页面内部自行处理滚动）。
- 顶部栏（Header）：**固定高度 48px**（`h-[48px]`），并设置较高层级 `z-[150]` 防止被页面内 sticky 覆盖。
- 主内容区（Main）：`flex-1 relative overflow-hidden bg-bg-base`，通过内部页面/容器控制滚动。

#### 交互细节
- 全局选中文本高亮：`selection:bg-brand-blue/30`（根容器上设置）。

### 4.2 统一滚动容器：ElasticLayout
在 `src/components/ElasticLayout.tsx`：
- 上下有静态分隔条（默认 **6px**）：`restGap` 默认 6。
- overscroll 时顶部会弹性拉伸：额外高度由 Motion spring 控制（MAX_EXTRA=20）。
- 适用：需要“交易终端质感”的长列表页面、可滚动面板、仪表盘容器。

**规范建议**
- 页面级容器如果内部滚动很多，优先用 `ElasticLayout`；不要让 `body` 滚动（项目的 `body` 已做 `overscroll-behavior: none`）。
- 如果 scroll 容器不是 ElasticLayout 内部的 div（例如外层自定义），使用 `detectionRef` 指定真正的 scrollTop 检测节点。

### 4.3 Dashboard 网格（react-grid-layout）
在 `src/pages/DashboardPage.tsx`：
- breakpoints：`{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }`
- cols：`{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }`
- `rowHeight = 50`
- `margin = [8, 8]`
- `containerPadding = [8, 8]`

**这套参数决定了“页面密度”**：Widget 的高度以“行”为单位（行高 50px）。新增 Widget 时要考虑在不同断点下的最小可用尺寸（minW/minH）。

### 4.4 Tailwind 响应式与 Container Query
- Tailwind 响应式断点（示例：`hidden md:flex`、`hidden lg:flex`、`xl:visible`）用于“宏观布局”切换。
- Dashboard 的 Widget 容器使用了 `@container` 与 `@max-[150px]`（见 `DashboardPage.tsx`，标题在容器过窄时自动隐藏），用于“组件自适应”。

**规范建议**
- 宏观布局用 `sm/md/lg/xl`；组件内部细节（例如标题是否显示）优先用 container query，避免为了一个小细节引入大量断点判断。

---

## 5. Components（组件规范：形态、状态、交互）

### 5.1 WidgetCard（核心容器）
WidgetCard 是整个终端的“基础积木”，来源：
- 视觉外观：`src/index.css` 的 `.widget-card`（渐变 border + depth shadow + hover 轻上浮）
- 结构与交互：`src/pages/DashboardPage.tsx` 的 `WidgetContainer`

#### 结构（推荐固定结构，不要随意变）
- 左上角：标题条（同时是拖拽把手，非 fullscreen 时 `.widget-drag-handle`）
- 右上角：操作按钮（fullscreen / close），默认隐藏，hover 显示
- 内容区：`pt-8 pb-2 px-2`（为顶部标题条预留空间）

#### 视觉与交互（不要破坏这种“交易终端触感”）
- hover：轻微上浮 `translateY(-1.5px)` + shadow 加深（见 `.widget-card:not(.is-fullscreen):hover`）
- fullscreen：增加 `.is-fullscreen`，底色更深、阴影更强

### 5.2 Button / IconButton / Pill（按钮体系）
项目按钮总体特征：
- **小而密**：常见高度区间 26/32/36/40px（Header 本身 48px）。
- **圆角偏大**：按钮常用 8px（与 `--radius-button` 一致），弹层/面板 12px。
- **动效短促**：常见 `120ms` 或 `0.14s`（Popup），ease 多用 `cubic-bezier(0.22,1,0.36,1)`。

规范建议（新增组件时）
- 默认按钮高度：32px；Header 区域的 IconButton：32px（现状大量使用 `w-[32px] h-[32px]`）。
- hover 只做“轻底色 + 轻发光/描边”，避免大面积颜色翻转。
- 图标按钮不要随意加大图标尺寸；保持 `13–16px` 区间更贴近终端密度。

### 5.3 Overlay（Popover / Modal / Drawer）
来源：`src/components/popup/Popup.tsx` + `src/components/popup/popup.css`

#### PopupCard（统一卡片外观）
`popup.css` 中定义了弹层基础样式：
- 背景：`--popup-card-bg: #14171a`
- border：`rgba(255,255,255,0.10)`
- 圆角：`12px`
- 阴影：`0 24px 60px rgba(0,0,0,0.55)`

#### 动效（统一曲线）
在 `Popup.tsx`：
- `POPUP_EASE = [0.22, 1, 0.36, 1]`
- Popover 默认：`opacity + y(-6) + scale(0.98)` → `0.14s`
- Modal 默认：`opacity + y(10) + scale(0.98)` → `0.14s`
- Drawer 默认：从侧边滑入 `x: ±24`，默认宽度 **420px**，并强制 `borderRadius: 0`（贴边抽屉）

#### 层级表（建议遵循，减少 z-index 孤岛）
> 现状代码里同时存在 `header z-[150]`、Popover 默认 z=120/121、Modal/Drawer 默认 z=100 等。为了后续不混乱，新增弹层请遵循下面的“约定值”。

| 层级语义 | 建议 z-index | 说明 |
|---|---:|---|
| Header / TopBar | 150 | 顶部栏需要压住页面内部 sticky |
| Popover / Dropdown | 120–129 | 下拉、悬浮卡片，避免压住 Modal |
| Modal / Drawer | 100–109 | 模态、抽屉 |
| Fullscreen 遮罩/浮层 | 90–99 | 例如 Dashboard fullscreen 的 backdrop（现状是 90） |

**硬规则**
- 新增业务组件时：不要随手写 `z-[9999]`；如果确实需要新层级，先更新本表（并解释原因）。
- Modal/Drawer 打开时要禁用 body 滚动（现状已实现）。
- Esc 关闭（现状已实现）；新增弹层要确保键盘可退出。

### 5.4 Table（Ant Design：仅用于 TradeLog 场景）
来源：`src/pages/TradeLogPage.tsx`（使用 `ConfigProvider` + `Table`）与 `src/index.css` 的 `.trade-log-table` 覆写块。

#### 风格要点（沿用现状）
- 表头更暗：`#0B0C0E`，字号 12px，font-weight 700，边线 `#1E1E26`
- 行 hover：轻微白色蒙层 `rgba(255,255,255,0.04)`
- 偶数行：更轻的底色 `rgba(255,255,255,0.012)`
- checkbox：暗色边框 + 选中 brand blue
- 横向滚动条：品牌蓝 thumb + active 更亮

**规范建议**
- 优先用 antd theme/token 能解决的部分；确实无法覆盖的细节再用 CSS 覆写，并把原因记录在代码注释里（避免覆写越来越不可控）。

---

## 6. Charts & Trading UI（图表与交易专属 UI 规范）

### 6.1 颜色注入原则（图表不要“自己发明一套色板”）
- 图表背景/网格/文字/涨跌色 **必须** 来自全局 token（或明确映射到 token）。
- 如果图表库要求传入具体色值（例如 lightweight-charts 的 `colors` 参数），在业务层传入时也要从 token 派生，而不是硬编码。

### 6.2 lightweight-charts（K 线）
来源：`src/components/LightweightChart.tsx`

建议在业务层约定一个接口（写法示例）：
```ts
type ChartColors = {
  backgroundColor: string
  textColor: string
  gridColor: string
  upColor: string
  downColor: string
}
```

映射建议：
- `upColor` → trade-up（success）
- `downColor` → trade-down（destructive）
- `gridColor` → border-subtle 的近似（或更暗一点）
- `backgroundColor` → bg-card / surface-1

### 6.3 Recharts（示例：市场页主图）
来源：`src/App.tsx`（AreaChart 示例）
- 渐变与线条使用品牌蓝：`#4D7CFF`
- Tooltip 容器：深色背景 + 细边线 + 8px 圆角

**规范建议**
- Tooltip 统一采用 PopupCard 的视觉（背景/边线/阴影/圆角），避免每个图表 tooltip 都长得不一样。

### 6.4 行情/价格与涨跌闪烁
来源：`src/App.tsx`（Ticker/Price 相关逻辑）
- 涨跌色使用 `text-trade-up / text-trade-down`
- 短暂闪烁用于强调变化（不要长时间闪）

**硬规则**
- 涨跌色永远语义化：不要引入第三套“绿色/红色”。
- 数字必须 `.tnum`，减少跳动与错读。

### 6.5 期权链（Deribit 风格）
来源：`src/pages/deribit-options-chain.css`

核心原则：
- 行高固定 **32px**（`--db-row-h`），配合 12–13px 字号，保证密度与可读性。
- hover/selected 都是“轻微增亮/轻蓝底”而非强烈变色。
- 支持 Deribit 桌面调参模式：`.db-oc-root.deribit`（更接近参考截图）。

建议把 `reference/deribit-desktop/pixel-spec.md` 当作“像素验收标准”（例如对齐、间距、字号、按钮尺寸）。

---

## 7. Engineering Rules（工程规范：代码评审清单）

### 7.1 className 拼接与条件渲染
- 必须使用 `cn()`（`src/lib/utils.ts`），禁止在 JSX 中堆叠复杂模板字符串三元表达式。

### 7.2 间距
- 新增代码：**禁止使用** `space-x-* / space-y-*`  
  改用：`flex gap-*` 或 `flex flex-col gap-*`（更适合条件渲染与组件封装）。

### 7.3 Token 与颜色
- 新增代码：**不要**随意硬编码 `#RRGGBB`。
- 如果临时需要（例如图表库只接受色值、或者在试验阶段）：必须在旁边标注原因 + TODO（后续收敛到 token）。

### 7.4 Overlay 层级
- 新增弹层不允许写 `z-[9999]` 这种“核爆式层级”。
- 必须遵循本文“层级表”；若不够用，先更新层级表并解释原因。

### 7.5 可访问性（A11y）最低要求
> 交易终端经常大量快捷操作；键盘可达性比普通网站更重要。

Checklist（新增交互控件必须满足）：
- [ ] 可聚焦：Tab 能遍历到所有按钮/输入/菜单项
- [ ] 焦点可见：`focus-visible` 有清晰样式（不要完全依赖鼠标 hover）
- [ ] 输入有 label 或 `aria-label`
- [ ] 错误态用 `aria-invalid`，辅助说明用 `aria-describedby`
- [ ] 弹层支持 Esc 关闭（Popover/Modal/Drawer 已支持；新增弹层必须保持一致）

---

## 8. 附录：常用尺寸速查（来自现状代码归纳）

> 这些不是“凭空建议”，而是当前项目里反复出现、用于维持一致性的尺寸基线。

- Header 高度：48px（`src/App.tsx`）
- Widget 内容 padding：`pt-8 pb-2 px-2`（`src/pages/DashboardPage.tsx`）
- Dashboard 网格：rowHeight=50，margin=8，containerPadding=8（`src/pages/DashboardPage.tsx`）
- Drawer 默认宽度：420px（`src/components/popup/Popup.tsx`）
- PopupCard 圆角：12px（`src/components/popup/popup.css`）
- 期权链行高：32px（`src/pages/deribit-options-chain.css`）
