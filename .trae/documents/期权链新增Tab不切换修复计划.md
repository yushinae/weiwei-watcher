## Summary
修复“在期权链页面通过组件库点击「添加」期权链时，会替换/切换当前期权链”的问题，目标行为为：**仅在标题栏右侧追加一个新的期权链 Tab，不改变当前正在查看的 Tab**；并补齐 URL ↔ Tab 的同步防抖/防循环，避免后续再次出现“被 URL 同步强行切走”的体验问题。

---

## Current State Analysis
### 现象（用户反馈）
- 在 `/options-chain` 页面打开组件库，选择“期权链”后点击「添加」，期望：右侧新增一个 Tab 且不切换；实际：**替换当前 Tab（体验上像当前页面被改了）**。

### 相关代码链路（已定位）
- 组件库弹窗提交按钮（在期权链页时）触发 `addOptionsChainTab(...)`：  
  - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/App.tsx)
- Tabs 状态由 zustand 维护：`optionsChainTabs` / `activeOptionsTabId`：  
  - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/store/useWorkspaceStore.ts)
- 期权链页面存在 URL→store 的同步 effect（会“强制激活” URL 对应 tab）：  
  - [View file](computer:///sessions/69fe3756e484ed01dcb8d637/workspace/src/pages/OptionsChainPage.tsx)

### 根因假设（需要以实际复现为准）
虽然组件库侧已尝试“追加但不激活”，但页面层仍存在 URL 同步逻辑：一旦 URL 参数在某些路径发生变化（或 activeTab 与 URL 不一致），就可能触发“open/activate”行为，导致用户体感上“替换当前 Tab”。
要可靠解决，需要把 **“追加”** 与 **“打开/激活”** 的语义彻底拆开，并为 URL↔Tab 同步加 guard，杜绝误触发。

---

## Proposed Changes
### 1) Store：拆分动作，明确语义（推荐做法，修复核心）
文件：`src/store/useWorkspaceStore.ts`

新增两个 action（或改造现有 action）：
- `appendOptionsChainTab(coinId, expiry)`  
  - 只保证 tab 存在且追加到数组末尾
  - **不修改** `activeOptionsTabId`
- `openOptionsChainTab(coinId, expiry)`  
  - 保证 tab 存在
  - **设置** `activeOptionsTabId` 为目标 tab（如果已存在则激活；不存在则创建并激活）

同时保留/封装兼容：
- 若现有代码已在大量地方调用 `addOptionsChainTab`，则：
  - 让 `addOptionsChainTab` 内部调用 `openOptionsChainTab`（保持旧语义：默认激活）
  - 新增的“追加不切换”逻辑统一改用 `appendOptionsChainTab`

为什么这样做：
- 防止“activate 参数漏传/被默认值覆盖”导致误切换
- 让调用点的意图清晰：追加 vs 打开

### 2) 组件库弹窗：在期权链页面点击「添加」时只追加（不切换）
文件：`src/App.tsx`

定位弹窗“添加组件”的 onClick 分支：
- 当 `selectedWidgetId === 'options-chain' && location.pathname === '/options-chain'`：
  - 改为调用 `appendOptionsChainTab(coinId, expiry)`（expiry 取当前 URL 的 expiry）
  - **不做** `navigate()` / 不改 URL
  - 关闭弹窗即可

额外建议：
- 追加成功后可选：自动把 Tab bar scroll 到最右（让用户明确看到新增 tab）

### 3) OptionsChainPage：做稳健的 URL ↔ tab 同步（避免“被 URL 强行切走”）
文件：`src/pages/OptionsChainPage.tsx`

新增两段带 guard 的同步逻辑（防循环）：

**(A) URL → store（只在不一致时才 open）**
- 当 URL 参数 `(coin, expiry)` 与当前 activeTab 不一致时，调用 `openOptionsChainTab(urlCoinId, urlExpiryStr)`
- 如果一致，则不做任何事

**(B) store(activeTab) → URL（用户点击 tab 才更新 URL）**
- 当用户点击 Tab 改变 `activeOptionsTabId` 时：
  - 若 activeTab 与当前 URL 不一致：`navigate('/options-chain?...', { replace: true })`
  - 用 `replace` 避免历史栈膨胀

**关键点**
- 追加 tab（append）不会改变 activeTab，因此不会触发(B)更新 URL
- 只有当用户主动点 Tab 切换，才更新 URL
- URL 手动改动/从别处跳转进入时，才触发(A) open

### 4) UI/可用性修复（按 web-interface-guidelines 做最小合规）
文件：涉及 `src/pages/OptionsChainPage.tsx` 与组件库弹窗相关按钮区域（`src/App.tsx`）

- 给“添加/关闭/切换 tab”等 icon-only 按钮补充 `aria-label`（不要只依赖 title）
- 若存在 `outline-none`，补 `focus-visible` 样式（至少有 ring/border 高亮）
- Tab 的 active 状态不要只靠颜色（保留现有下划线/粗体即可）

---

## Assumptions & Decisions
- “右侧新增一个期权链页面”在现有架构中对应“新增一个 OptionsChain Tab”，而非新 route/new window。
- 保持页面始终至少有一个期权链：关闭最后一个 tab 时自动回退到第一个/最近一个 tab（若用户确认需要，可在执行阶段一并补齐）。
- U 本位/币本位只影响 coinId（例如 BTC-USD / BTC-USDC），新增 tab 不应强制切换 URL。

---

## Verification Steps
1) 打开 `/options-chain?coin=BTC-USD&expiry=15+MAY+26`，确认自动 open 对应 tab，并且 URL 与 activeTab 一致。
2) 在页面点击标题栏“+”→ 打开组件库 → 选择另一个 `coinId` → 点击「添加」：
   - 期望：tabs 数量 +1，新增 tab 出现在最右侧；**当前 activeTab 不变**；页面内容不变；URL 不变。
3) 手动点击新 tab：
   - 期望：activeTab 切换；URL replace 更新到新 coin/expiry；不会重复新增 tab。
4) 关闭非 active tab：active 不变；关闭 active tab：自动切到邻近/最后一个 tab（策略按实现），并同步 URL。
5) 刷新页面：tabs 与 active 能正确恢复，且不会在加载后瞬间跳到别的 tab。

