# pi-zen-mode 设计说明

对照源码：`zen-mode.ts`（约 1020 行）。本文记录**已经落地的决策**，不是路线图。README 面向安装和使用；本文面向「为什么这样、运行时到底发生了什么」。

---

## 1. 它是什么

Pi TUI 的专注模式扩展。zen 打开时：

- **思考块、工具调用**被管起来，按开关决定运行中藏不藏、结束后收不收成一行占位。
- **模型说的话（所有 `text`）永远走原生渲染、流式出现。**
- 想看被藏的过程：`ctrl+alt+r` 展开最近一轮，`ctrl+alt+s` 从列表里挑更早的轮。

不是新的 agent 循环，也不改消息历史。只补丁两处渲染：`AssistantMessageComponent.updateContent`、`ToolExecutionComponent.render`。

---

## 2. 设计原则（按决策记）

### 2.1 zen 开着 = 管过程，不管说话

| 管 | 不管 |
| --- | --- |
| thinking 块 | assistant `text`（「我先看看」和最终答案都是这个） |
| 工具行 | 用户消息、系统消息、错误/中止提示（交给原生） |

过程可以藏；字是给用户看的。

### 2.2 两个子开关只决定显隐，不决定收不收集

zen 开着时，思考和工具**一律进 collector**。`hideThinking` / `hideTools` 只决定：

- 运行中：画原生 UI 还是画空；
- 结束后：原生还是一行占位；
- 底栏统计数字。

这样事后把「隐藏工具」从关拨到开，**已经结束的轮**里的工具行也能收成 `⚙`。早期 bug：`hideTools` 关着时根本不 `capture` 工具，后来再开找不到行。

三个全关时看起来跟没开 zen 一样，但轮次仍被管着，方便再打开某一档。

### 2.3 不要藏「中间回复」

曾经有过 `hideInterimText`。协议里 interim 和最终答案都是 `text`，运行中分不开，只可能：

- 先流出几个字，工具一开始再藏掉（闪）；或
- 没工具的轮次把答案憋到 `turn_end` 一次性倒出来。

两种都糟，选项已删除。旧 `zen-mode.json` 里的 `hideInterimText` 加载时丢弃，下次保存不再写出。

### 2.4 展开必须走原来的渲染器

折叠态自己画占位（`Text` 一行）。展开态**禁止**用 Markdown 重画 thinking——那会丢掉 compact-thinking / 原生思考 UI。

做法：安装补丁时把当时的 `updateContent` / `render` 存成 `originalAssistantUpdate` / `originalToolRender`（可能已经是别的扩展的补丁）。展开时把完整消息交回这两个函数。

### 2.5 补丁是外层包装，zen 关掉就卸掉

- 第一次需要时才 `installPatches`（第一次 busy 或打开 zen），保证套在当时已装的扩展外面。
- zen 关掉：先 `restoreAllReveal` 再 `uninstallPatches`，prototype 改回去。compact-thinking 等恢复原样。
- zen 开着时本扩展是最外层，内层输出跟着被藏或跟着被展开。

### 2.6 一轮还在跑，不准改 zen

`/zen` 面板、总开关、展开、选择框全部 `rejectIfBusy`。运行中改开关会跟流式抢同一个 `contentContainer`，关总开关会 `restoreAllReveal` 把 busy 清掉、收集中断。

一条规则：跑完再动。提示：`zen · 这轮还在跑，结束后再改`。

### 2.7 重绘是 collector 里那些组件，不是整段对话重跑

改开关或一轮结束：只遍历该 collector 的助手消息 / 工具行，重建或 `invalidate`。`presentCollector` / `revealCollector` 自己不刷屏；由 `maybeFinalize`、`setRunRevealed`、`setEnabled`、面板/选择框各刷**一帧**。终端几乎都是整帧画，但同一操作不再叠 N+1 次 `requestRender`。

### 2.8 历史以「还在屏幕上的组件」为界

`session_tree` / `session_compact` 会重建 transcript，旧组件没了，展开会指空。收到这两个事件就 `pruneZenHistory()`（顺带 `busy=false`、清 defer timer，避免 compact 发生在一轮当中时 `/zen` 被永久挡住），选择框不再列出 compact / 切分支之前的轮。

---

## 3. 运行形态

把「用户一条消息 → 模型思考 / 调工具 / 再说话，直到 idle」叫做**一轮（run）**。一轮可以跨多次 LLM turn（`turn_start` … `turn_end` 循环），直到 `ctx.isIdle() && !ctx.hasPendingMessages()`。

```
turn_start
    └─ enabled? beginRun() → busy=true, 必要时装补丁

流式中 (busy)
    助手 updateContent
        ├─ 完整消息写入 assistantStates（展开要用）
        ├─ capture 进当前 collector（按 message.timestamp 去重；同 id 换组件则改指针）
        └─ filterMessage(去 thinking 或留) + originalAssistantUpdate
           文字始终留下；thinking 由 hideThinking 决定
    工具 render
        ├─ zen 开着且 busy 且尚未归属 → capture（按 toolCallId 去重；同 id 换组件则改指针）
        ├─ hideTools 关 → originalToolRender（实时工具行）
        └─ hideTools 开 → return []（一行都不出，防闪）
    tool_execution_start → activeToolIds.add(id)
    tool_execution_end   → 若已 idle 则 finalize，否则继续

turn_end / 工具结束 / abort
    maybeFinalize
        ├─ 还在忙或有排队消息 → 700ms 后再试
        ├─ idle → busy=false
        ├─ pruneUnconfirmedTools（丢掉 busy 期间被 Pi 重绘的旧工具行）
        ├─ presentCollector：占位 + 底栏
        └─ collectors.push，presentedCollector = 这一轮
```

### 3.1 运行中各开关画面

| | `hideThinking` 开 | 关 |
| --- | --- | --- |
| thinking | 从消息里滤掉，屏幕上没有思考块 | 原生存流（含 compact-thinking） |
| `text` | 始终原生存流 | 始终原生存流 |
| 工具 + `hideTools` 开 | `render()` 返回 `[]` | — |
| 工具 + `hideTools` 关 | — | 原生工具行 |

### 3.2 结束后（`presentCollector`）

对 collector 里每个组件：

- 助手：`originalAssistantUpdate(filterMessage(完整消息, !hideThinking), isStreaming=false)`。若思考被藏，在容器顶部插入一行 `◈ 思考已折叠 · N 词`。
- 工具：`invalidate()`。下一帧 `patchedToolRender`：藏则 `⚙ name — ok · N lines`（或 `failed`）；不藏则原生。若 Pi 的 `ctrl+o` 把该行 `expanded` 设为 true（会话级总开关，当前所有工具 + 之后新建的），结束后走原生完整输出，不再占位。**运行中** busy 分支先 `return []`，不看 `expanded`，所以跑着的时候 `ctrl+o` 不会把工具画出来。

最后在**本轮最后一条有可见 text 的助手消息**底下加底栏（没有可藏的东西则不加）：

```
zen · 3 次工具调用 / 1 段思考已折叠 — ctrl+alt+r 展开本轮 · ctrl+alt+s 展开更早
```

`ctrl+alt+s` 那截只在已经有更早的折叠轮时出现。

### 3.3 展开 / 再收起

- `ctrl+alt+r`：对 `presentedCollector`（最近一轮）翻转 `revealed` WeakMap。
- `ctrl+alt+s`：SettingsList，每行 `#序号 · 多久以前 · N 工具 / M 思考`。Enter 翻转那一轮，Esc 关。编号 `#1` 是最近一轮，列表本身按时间从早到晚。
- 展开：完整消息交给 `originalAssistantUpdate`；工具 `invalidate` 后走 `originalToolRender`。
- 再收起：走 `presentCollector`（和结束时同一套占位 + 底栏）。
- 关总开关：`restoreAllReveal()` 再 `uninstallPatches()`。session 结束同样先还原再卸补丁。

---

## 4. 功能清单

| 能力 | 入口 |
| --- | --- |
| 总开关 | `/zen` 第一项，或 `ctrl+alt+f`（可配） |
| 隐藏思考 | `/zen` · ◈ |
| 隐藏工具 | `/zen` · ⚙ |
| 展开最近一轮 | `ctrl+alt+r`（可配） |
| 挑选任意一轮 | `ctrl+alt+s`（可配） |
| Pi 全局展开工具 | 自带 `ctrl+o`：会话级 `toolOutputExpanded`，当前所有工具行 + 之后新建的工具行 |
| 状态指示 | `ctx.ui.setStatus("zen", "◉ zen")`，跟其它扩展状态同一行；自定义 footer（如 pi-statusline）走它自己的 extension-status |
| 配置持久化 | `~/.pi/agent/zen-mode.json`（或 `$PI_CODING_AGENT_DIR` 下） |

`/zen` 面板：标题行有 ◴◷◶◵ 慢转，选项带图标，风格对齐 `/tools`。

---

## 5. 数据模型

一轮一个 `RunCollector`：

```
comps: { kind: "assistant" | "tool", component, id? }[]
startedAt
finalTextIndex   // 最后一条带可见 text 的助手在 comps 里的下标，底栏挂这里
seen: Set<string>  // "m:<timestamp>" / "t:<toolCallId>"
```

`capture(id)`：没见过就推进 comps；见过且组件实例变了，就把那条的 `component` 指针改到新实例（Pi 重建同一条消息时，折叠/展开不能还握着已摘掉的旧组件）。

旁路索引（都不持有强引用组件以外的生命周期）：

- `assistantStates: WeakMap<助手组件, 完整 AssistantMessage>` — 展开用完整消息，不能用滤掉 thinking 之后的。
- `compCollector: WeakMap<组件, RunCollector>` — 工具 render 时知道自己属于哪一轮。
- `revealed: WeakMap<RunCollector, boolean>`
- `collector` — 正在进行的轮；idle 后清空。
- `collectors[]` — 已经 present 过的轮，关 zen 时要全部还原。
- `presentedCollector` — `ctrl+alt+r` 的目标（最新一轮）。
- `activeToolIds` — 本 busy 期内真正 `tool_execution_start` 过的 id。Pi 滚动重绘旧工具行时也会进 `render`，不能凭 render 计数。finalize 时 `pruneUnconfirmedTools`：没在这个集合里的工具行从 collector 摘掉并 `invalidate` 回原生。

`busy`：从 `beginRun` 到成功 `maybeFinalize`。一轮可含多次 turn，busy 一直为真。

---

## 6. 渲染补丁（怎么藏、怎么还）

安装（懒）：

```
originalAssistantUpdate = AssistantMessageComponent.prototype.updateContent  // 当时的
originalToolRender      = ToolExecutionComponent.prototype.render
prototype 换成 patched*
```

卸载：prototype 写回 original。

### 6.1 `patchedAssistantUpdate`

1. 把完整 `message` 存进 `assistantStates` 和 `lastMessage`。
2. 若组件已属于**更早的** collector：按那一轮的 `revealed` 决定 `original` 还是 `presentAssistant`，不再重新 capture。
3. 若 `!(enabled && busy)`：直接 original（zen 关，或已 present 的空闲期）。
4. busy：`capture("assistant", …, "m:"+timestamp)`，再 `original(filterMessage(message, !hideThinking), isStreaming)`。

`filterMessage` 只可能拿掉 `type === "thinking"`。`text` / `toolCall` 等原样留下。

### 6.2 `patchedToolRender`

1. zen 关：original。
2. zen 开、busy、还没有归属：capture。**无论 hideTools。**
3. `hideTools` 关：original。
4. `hideTools` 开：
   - 当前轮且 busy → `[]`
   - 已 present 且 revealed 或 `expanded` → original
   - 已 present 未展开 → 占位一行
   - busy 但尚未归属（极端）→ `[]`

占位文案：`⚙ {toolName} — ok · N lines` / `failed` / `done`，用 theme `muted`。

`ctrl+o` 是 Pi 的全局工具展开，不是单条。运行中命中「当前轮且 busy → `[]`」，不看 `expanded`；一轮结束才看。新工具行创建时会带上当时的 `toolOutputExpanded`，所以展开过后再跑一轮，结束后仍会完整显示。

### 6.3 为什么 thinking 展开不是 Markdown

早期折叠态用 `Markdown` 把 thinking 重画成斜体字，展开后思考块「变成纯文字」。正确路径是永远把可见的 thinking 交给 `originalAssistantUpdate`（可能是 compact-thinking）。占位只在藏的时候自己加一行 `Text`。

---

## 7. 事件与生命周期

| 事件 | 行为 |
| --- | --- |
| `session_start`（仅 TUI） | 记下 ctx/theme；挂一个空 widget 拿到 `TUI`；`syncZenStatus`。**不在这里装补丁。** |
| `turn_start` | enabled 则 `beginRun` |
| `turn_end` | enabled 则 `maybeFinalize` 或 700ms 延期 |
| `message_end` | 仅 abort/error：有的 turn 不会发 `turn_end`，延期 finalize |
| `tool_execution_start` | `activeToolIds.add` |
| `tool_execution_end` | `maybeFinalize`（工具刚结束时常常还没 idle，会走延期） |
| `session_tree` / `session_compact` | `pruneZenHistory` |
| session 结束 | 清 status/widget，卸补丁 |

`maybeFinalize` 成功条件：`enabled && busy && collector && ctx.isIdle() && !ctx.hasPendingMessages()`。否则 `scheduleDeferredFinalize`（700ms，单飞，后来的会重置计时）。

`beginRun`：`busy=true`，必要时 `installPatches`，清掉未触发的 defer timer。

---

## 8. 配置

路径：`join(getAgentDir(), "zen-mode.json")`。

```json
{
  "enabled": false,
  "hideThinking": true,
  "hideTools": true,
  "toggleKey": "ctrl+alt+f",
  "revealKey": "ctrl+alt+r",
  "pickerKey": "ctrl+alt+s"
}
```

- 默认总开关是关的；两个 hide 默认开（打开 zen 即藏思考和工具）。
- 键位只接受 `/^[a-z+0-9]+$/`，否则回落到上面三个默认。曾用 `ctrl+alt+z`，和 pi-transcribe 冲突，才改成 `ctrl+alt+f`。
- 加载时显式挑字段，丢弃未知键（含旧的 `hideInterimText`）。
- 改面板或快捷键会立刻 `saveConfig`。键位在 session 启动时读一次，改 json 里的 `*Key` 要 `/reload`。

---

## 9. 边界、刻意不做的事

- **开 zen 之前的对话**不会被追溯隐藏。只从打开之后的 run 开始收集。关再开：新 run 重新收；旧的如果还在 `collectors` 里且组件还在，改开关会 `refreshCollapsedRuns`。
- **compact / 切分支之前的轮**不能展开，选择框里也不会再出现。
- **运行中**不能开面板、不能改开关、不能展开。
- **不藏文字。** 若将来再加，必须先解决「text 在工具出现前无法分类」；不要用延迟猜测。
- 空 collector（这一轮完全没抓住组件）finalize 时直接丢弃，不进 `collectors`。
- 助手消息 abort/error 且容器被掏空时，补一行 `⛔ …`，避免空白。
- 只在 `ctx.mode === "tui"` 工作；`/zen` 在非 TUI 下报错。

---

## 10. 兼容性

- 需要 Pi TUI。随 `AssistantMessageComponent` / `ToolExecutionComponent` 内部字段走，大版本升级可能要跟。测过 Pi `0.84.x`。
- 与 [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking) 共存：zen 关 = 不装补丁；zen 开 = 包在外面；展开 = 内层长什么样就还什么样。
- 状态走 `setStatus`，不占用聊天区 widget 行（空 widget 只为拿到 `TUI.requestRender`）。
- npm 包名 `pi-zen-mode`，keyword `pi-package`，可被 [pi.dev/packages](https://pi.dev/packages/pi-zen-mode) 收录。安装：`pi install npm:pi-zen-mode`（也可 `pi install git:github.com/wutongyuonce/pi-zen-mode`）。

---

## 11. 源码地图

都在 `zen-mode.ts` 一个文件里，`export default function zenMode(pi)`。

| 区域 | 职责 |
| --- | --- |
| 文件头注释 | 原则备忘 |
| `ZenConfig` / `loadConfig` / `saveConfig` | 持久化 |
| `RunCollector` / `capture` | 收集与去重 |
| `filterMessage` / `presentAssistant` / `presentCollector` | 结束后怎么画 |
| `collapseSummary` / `addCollapseFooter` | 底栏 |
| `patchedAssistantUpdate` / `patchedToolRender` | 运行中怎么画 |
| `beginRun` / `maybeFinalize` / `pruneUnconfirmedTools` | 一轮的起止 |
| `setEnabled` / `syncZenStatus` / `restoreAllReveal` | 总开关 |
| `setRunRevealed` / `toggleReveal` / `openRunPicker` | 回看（收起复用 `presentCollector`） |
| `pruneZenHistory` | compact / 切分支：清名单、busy、defer timer |
| `openZenPanel` / `applyZenChange` | `/zen` |
| `rejectIfBusy` + `registerCommand` / `registerShortcut` | 入口 |
| `pi.on(...)` | 事件 |

改行为时优先改「原则」对应的那一段，不要在补丁里再加一套分类逻辑。
