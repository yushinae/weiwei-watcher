## Summary
本次只解决你明确指出的 3 件事，并且口径一致、不再混淆：
1) **标题栏下方的滑块（underline）必须跟随“当前激活 Tab”移动**（你截图里的 1），并带轻微发光动效；
2) **标题栏右侧 hover 弹出黑色 X 方块，点击关闭“当前激活 Tab”**（关闭这一排标签中当前激活的那个标签），不是关闭页面/跳路由；
3) **组件库里“期权链”需要更贴近真实期权链的预览样式**（tabs + underline + 表格骨架 + 右上角黑色 X 方块示意）。

同时：**选中态不再出现蓝色框**（不靠蓝色 border/背景表达选中），而是靠“选中文字更大 + 下方滑块”表达。

---

## Current State Analysis
### 你指出的问题
- 滑块位置不移动：切换激活 tab 时 underline 不跟随。
- 右侧黑色 X 没有：标题栏 hover 时没有从右侧滑出黑色关闭方块。
- 蓝色框不需要：截图标注处的蓝色框（包含 border/focus ring/背景蓝底）要去掉。

### 涉及文件（执行时只改这些）
- `src/pages/OptionsChainPage.tsx`：标题栏 tabs、underline 计算与渲染、右侧按钮区域
- `src/store/useWorkspaceStore.ts`：`removeOptionsChainTab` 关闭后 active 迁移规则
- `src/registry/index.tsx`：组件库 `options-chain` 的 preview 样式
- `src/App.tsx`：无需改行为（仍是 append 不切换），仅用于验证链路

---

## Proposed Changes
> 视觉风格遵循 frontend-design：暗色终端、密度高但不杂乱；状态指示明确（字号/滑块），动效短促（opacity/transform/left&width）。

### 1) 标题栏右侧黑色 X：关闭“当前激活 Tab”（不是关闭页面）
文件：`src/pages/OptionsChainPage.tsx`

#### 1.1 明确“当前激活 Tab”的 id
统一使用 `derivedActiveTabId`（当前文件里已存在或可轻量补齐）：
- 优先 `activeOptionsTabId`
- 否则用 URL (`coin`,`expiry`) 匹配 `optionsChainTabs` 的那一个
- 最后 fallback `optionsChainTabs[0]?.id`

#### 1.2 关闭逻辑（点击 X）
新增函数：
- 若 `optionsChainTabs.length <= 1`：不允许关闭（与 store 的“至少保留一个 tab”一致）
- 否则调用：`removeOptionsChainTab(derivedActiveTabId)`

**禁止** `navigate('/options')` 或任何路由跳转。

#### 1.3 X 的展示（hover 从右侧弹出）
标题栏容器加 `group`，X 按钮默认：
- `opacity-0 translate-x-2 pointer-events-none`
hover：
- `group-hover:opacity-100 group-hover:translate-x-0 group-hover:pointer-events-auto`
黑色方块风格：
- `background: #000` 或 `#0F1015`
- `rounded-[4px]~[6px]`（更像“方块”）
- 边框 `rgba(255,255,255,0.12)`

---

### 2) 滑块（underline）必须随激活 Tab 移动，并带发光
文件：`src/pages/OptionsChainPage.tsx`

#### 2.1 确保每个 Tab button 都被测量
为“标题栏 tabs”里每个 tab 的 `<button>` 绑定 ref，写入：
- `tabBtnRefs.current.set(tab.id, buttonEl)`

（重点：Deribit 头部 tabs 与 Nexus 头部 tabs 都要绑定，否则会出现“滑块不动/定位不到”）

#### 2.2 underline 更新时机（解决“不移动”根因）
把 underline 的计算抽成 `recalcUnderline()`，并在以下时机调用：
- `useLayoutEffect`：依赖 `derivedActiveTabId`、`optionsChainTabs.length`
- `window resize`：字体/布局变化导致 offset/width 变化时重新测量

计算规则（与截图一致）：
- `left = activeBtn.offsetLeft + 内边距修正`
- `width = activeBtn.offsetWidth - 内边距修正`
（避免滑块覆盖到按钮左右 padding）

#### 2.3 发光样式（你选“发光滑块”）
underline 使用：
- 渐变背景：`linear-gradient(90deg, rgba(255,255,255,0.65), rgba(255,255,255,0.95), rgba(255,255,255,0.65))`
- glow：`boxShadow: 0 0 10px rgba(255,255,255,0.55), 0 0 22px rgba(255,255,255,0.25)`
- 动画：`transition-[left,width,opacity] duration-150 ease-out`

并确保容器不裁切 glow：
- tabs 容器补 `overflow-y-visible`（保留 `overflow-x-auto`）
- 适当 `pb-1` 给滑块留空间（滑块在标题栏下方）

---

### 3) 去掉蓝色框：选中态只靠“字体更大 + underline”
文件：`src/pages/OptionsChainPage.tsx`

#### 3.1 active tab 样式
- active 字号更大（示例：inactive 16px，active 18px；或 deribit 内部 12→13/14）
- active font 更粗（`font-extrabold`）
- active 不再使用蓝色 border/background（例如移除 `rgba(77,124,255,...)`）

#### 3.2 focus 样式避免蓝 ring
- `focus-visible:ring-white/25`（或灰白），不要 `ring-[#4D7CFF]`

---

### 4) 关闭 Tab 后 active 迁移规则（避免体验“跳到最后一个”）
文件：`src/store/useWorkspaceStore.ts`

修改 `removeOptionsChainTab(id)`：
- 先拿到被删除 tab 的 index（删除前数组）
- 删除后若删的是 active：
  - 优先激活左邻（index-1）
  - 否则激活右邻（删除后仍在同 index 的那个）
  - 再 fallback remaining 最后一个
- 若只剩 0：继续拒绝删除（保持“至少一个 tab”）

这保证右侧 X “关闭当前 tab”时，激活迁移符合常见 tab 行为，你也更容易预期滑块移动到哪里。

---

### 5) 组件库期权链预览样式升级
文件：`src/registry/index.tsx`，条目：`WIDGET_REGISTRY['options-chain'].preview`

预览必须包含：
- 顶部 tabs（active 字更大）
- 下方发光 underline（静态展示即可）
- 右上角黑色 X 方块（静态示意即可）
- 表格骨架（让用户一眼认出是“期权链”）

---

## Assumptions & Decisions
1) “黑色 X”点击行为以你刚刚这句为准：**关闭当前激活 Tab**，不做路由跳转。
2) 最后一个 Tab 不允许关闭（避免页面空状态）；X 可隐藏或禁用（二者选其一，优先隐藏减少噪音）。
3) “蓝色框”包含：border、background、focus ring；三者都必须清理掉。

---

## Verification Steps
1) **滑块会移动**
   - 点击不同 Tab：滑块必须移动到当前激活 Tab 下方（位置/宽度随文字变化）
2) **右侧黑色 X 会出现且能关闭当前 Tab**
   - 鼠标移入标题栏：右侧黑色 X 方块从右侧滑出
   - 点击：关闭当前激活 Tab；页面不跳转
   - 关闭后：active 按“左邻优先”迁移，滑块随之移动
3) **无蓝色框**
   - 选中态没有蓝边框/蓝底/focus 蓝 ring
4) **组件库预览**
   - 组件库选择“期权链”：能看到 tabs + 发光滑块 + 黑色 X 示意 + 表格骨架

