## Summary
根据你提供的截图与要求，修复并统一期权链页面顶部标题栏交互：
1) **滑块（underline）必须随“激活标题页/Tab”移动**，位置在标题栏下方，带轻微发光动画；
2) **标题栏右侧 hover 弹出黑色 X 方块**，点击关闭“当前激活 Tab”（不是关闭页面）；
3) **选中态不再出现蓝色框**（包含 border / focus ring / 背景蓝底），而是用“选中字体更大 + 下方滑块”表达；
4) **组件库中的期权链条目提供更贴近真实页面的预览样式**（顶部 tabs + underline + 表格骨架 + 右上角黑色 X 方块）。

---

## Current State Analysis
### 你反馈的现象（本地 dev）
- 滑块位置不移动：切换激活 tab 时 underline 不跟随。
- 右侧黑色 X 没有出现：hover 标题栏时没有从右侧滑出黑色关闭方块。
- 选中 tab 有蓝色框：截图标注的“1”处不希望出现蓝色边框/蓝色选中框。

### 相关文件
- 顶部标题栏 Tabs、underline 计算与渲染：  
  `src/pages/OptionsChainPage.tsx`
- Tab 关闭与激活迁移逻辑：  
  `src/store/useWorkspaceStore.ts`（`removeOptionsChainTab`）
- 组件库 action 添加期权链 Tab：  
  `src/App.tsx`
- 组件库期权链预览样式：  
  `src/registry/index.tsx`（`WIDGET_REGISTRY['options-chain'].preview`）

---

## Proposed Changes
> 视觉与动效遵循 frontend-design：暗色终端风格、减少噪音、状态指示明确；动效使用短促的 transform/opacity 与位置过渡，避免挤压布局。

### 1) underline（滑块）必须随激活 Tab 移动
文件：`src/pages/OptionsChainPage.tsx`

#### 1.1 统一 underline 的“定位信息来源”
- 使用 `tabBtnRefs: Map<tabId, HTMLButtonElement>` 记录**每个 tab 的 button DOM**；
- 激活 tab 的 id 统一通过 `derivedActiveTabId` 得出（优先 `activeOptionsTabId`，否则用 URL 与 tabs 匹配，再 fallback 到 tabs[0]）；

#### 1.2 underline 更新时机（解决“不移动”）
把 underline 更新从“只依赖 tabs.length”改为覆盖以下触发条件：
- `derivedActiveTabId` 变化（用户点击切换 / URL 变化 / store 激活变化）
- `optionsChainTabs` 增删（新增/关闭 tab）
- Tab 容器横向滚动（`scrollLeft` 变化会影响视觉位置）
- 容器尺寸变化（窗口 resize / 字体大小变化导致 offsetWidth 变化）

实现建议（执行者按项目习惯二选一）：
- **方案 A（推荐）**：`useLayoutEffect + requestAnimationFrame`，并在 `tabScrollRef.current` 上绑定 `scroll` 事件（passive），在 scroll 时重新计算；
- **方案 B**：引入 `ResizeObserver` 监听 tab 容器与 active tab button 尺寸变化，配合 `scroll` 事件。

#### 1.3 underline 外观（发光滑块）
- 位置：标题栏下方（`bottom: 0` 或略微负值以贴合分割线）
- 样式：渐变 + 轻微 glow
  - `background: linear-gradient(90deg, rgba(255,255,255,0.65), rgba(255,255,255,0.95), rgba(255,255,255,0.65))`
  - `boxShadow: 0 0 10px rgba(255,255,255,0.55), 0 0 22px rgba(255,255,255,0.25)`
- 动效：`transition-[left,width,opacity] duration-150 ease-out`

#### 1.4 避免被裁切
Tab 条容器补充：
- `overflow-x-auto` 保持
- 增加 `overflow-y-visible`（允许 underline glow 溢出）
- 必要时增加 `pb-1` 给 underline 留空间

---

### 2) 移除蓝色框（选中态不靠蓝框表达）
文件：`src/pages/OptionsChainPage.tsx`

对顶部 tab button：
- active 时不再设置蓝色 border/background；
- 同时清理 focus 样式，避免 focus-visible ring 是蓝色：
  - 使用 `focus-visible:ring-white/25` 或 `ring-white/30`
- 选中态只通过：
  - **字体更大**（例如 inactive 16px，active 18px）
  - **font-weight 更粗**
  - **下方滑块**

---

### 3) 右侧 hover 弹出黑色 X，点击关闭“当前 Tab”
文件：`src/pages/OptionsChainPage.tsx`

#### 3.1 X 的显示逻辑
- 标题栏根节点加 `group`，X 按钮默认隐藏：
  - `opacity-0 translate-x-2`
- hover 标题栏显示：
  - `group-hover:opacity-100 group-hover:translate-x-0`
- 外观：黑色方块（更方、更“硬朗”）
  - 背景 `#000` 或 `#0F1015`
  - `rounded-[4px]` 或 `rounded-[6px]`

#### 3.2 点击行为：关闭“当前激活 tab”
- 点击 X 调用：`removeOptionsChainTab(derivedActiveTabId)`
- 当仅剩 1 个 tab 时：
  - X 不显示或禁用（与“至少保留一个 tab”的策略一致）

---

### 4) store：关闭 tab 后的 active 迁移更符合直觉（可选但强烈建议）
文件：`src/store/useWorkspaceStore.ts`

当前 `removeOptionsChainTab` 若关闭 active tab，会把 active 指向 `remaining` 最后一个；建议改为更常见的 tab 行为：
- 关闭当前 tab 后，active 指向**原 index 的右侧 tab**；没有右侧则指向左侧。

实现要点：
1) 计算被删除 tab 的 index：`idx`
2) 过滤 `remaining`
3) 如果删的是 active：`nextActiveId = remaining[Math.min(idx, remaining.length-1)].id`

---

### 5) 组件库：期权链预览更贴近真实 UI
文件：`src/registry/index.tsx`

在 `WIDGET_REGISTRY['options-chain'].preview` 中：
- 顶部展示 tabs + 发光 underline（静态即可）
- 右上角放一个黑色 X 方块（静态即可）
- 下方保留表格骨架（让用户一眼能看出是“期权链”）

---

## Assumptions & Decisions
- 关闭 X 的点击行为以你明确回答为准：**关闭当前激活 Tab**（不是退出期权链页面）。
- underline 的“激活判断”以 `activeOptionsTabId` 为主；若其为空才 fallback 到 URL 匹配。
- 蓝色框的来源包含：border / background / focus ring 三类，均需要清理，避免截图标注“1”的蓝框再次出现。

---

## Verification Steps
1) **滑块随激活移动**
   - 在标题栏点击不同 tab：滑块必须跟随移动（left/width 匹配 tab 文本区域）
   - 横向滚动 tab 条：滑块位置保持正确
2) **hover 右侧黑色 X**
   - 鼠标移入标题栏：右侧黑色 X 方块从右侧滑出
   - 点击 X：关闭当前 tab；页面不跳走
   - 当只剩 1 个 tab：X 不出现或不可点击
3) **无蓝框**
   - 激活 tab 不出现蓝色边框/蓝底/focus 蓝 ring
   - 选中态通过“更大字体 + underline”表达
4) **组件库预览**
   - 打开组件库选择“期权链”：预览卡片中能看到 tabs + underline + 表格骨架 + 右上角 X（静态）

