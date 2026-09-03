/**
 * zen-mode — Focus / distraction-free output for pi-tui.
 *
 * While zen is on, thinking and tools are collected. The two hide*
 * switches only choose visibility (and thus the footer counts): unhidden
 * categories keep their native renderer live; hidden ones stay blank until
 * the run ends, then become one-line placeholders. Assistant text always
 * streams through the original renderer — interim vs final cannot be told
 * apart, so zen does not try. Toggling a switch re-presents only the tracked
 * components of each run. ctrl+alt+r restores the captured original
 * renderer for the last run.
 *
 * Compatibility:
 * - Render hooks are only patched while zen logic needs them and always
 *   delegate to the method captured at install time when zen is off, so other
 *   extensions that patch the same components (e.g. pi-compact-thinking's
 *   AssistantMessageComponent patch) keep their exact behavior when zen is
 *   disabled. When zen is on this extension is deliberately the outermost
 *   renderer, so inner patches' output is hidden along with the built-in.
 * - The "reveal" view calls the captured original renderer, so whichever
 *   inner pipeline is installed decides the expanded appearance.
 *
 * Toggles (keys configurable via zen-mode.json "toggleKey"/"revealKey"/"pickerKey"):
 *   ctrl+alt+f  master on/off (persisted to ~/.pi/agent/zen-mode.json)
 *   ctrl+alt+r  reveal/collapse the last run's hidden content
 *   ctrl+alt+s  open a picker of every collapsed run (expand any of them)
 *   /zen        settings panel (same visual style as /tools)
 *
 * Config keys (zen-mode.json): enabled, hideThinking, hideTools,
 * toggleKey, revealKey, pickerKey.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  AssistantMessageComponent,
  type ExtensionAPI,
  type ExtensionContext,
  getAgentDir,
  getSettingsListTheme,
  ToolExecutionComponent,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  SettingsList,
  Spacer,
  Text,
  type SettingItem,
  type TUI,
} from "@earendil-works/pi-tui";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";

function configPath(): string {
  return join(getAgentDir(), "zen-mode.json");
}
const WIDGET_ID = "zen-mode-render-loop";

interface ZenConfig {
  enabled: boolean;
  hideThinking: boolean;
  hideTools: boolean;
  toggleKey?: string;
  revealKey?: string;
  pickerKey?: string;
}

const DEFAULT_CONFIG: ZenConfig = {
  enabled: false,
  hideThinking: true,
  hideTools: true,
};

const DEFAULT_TOGGLE_KEY = "ctrl+alt+f";
const DEFAULT_REVEAL_KEY = "ctrl+alt+r";
const DEFAULT_PICKER_KEY = "ctrl+alt+s";

function normalizeKey(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  return /^[a-z+0-9]+$/.test(normalized) ? normalized : fallback;
}

/* ------------------------------------------------------------------ */
/* Internal shapes — mirror the public fields of the exported pi        */
/* components (same approach as pi-compact-thinking).                  */
/* ------------------------------------------------------------------ */

interface AssistantInternals {
  contentContainer: Container;
  outputPad: number;
  markdownTheme?: unknown;
  hiddenThinkingLabel: string;
  isStreaming: boolean;
  lastMessage?: AssistantMessage;
  markdownTransformers?: unknown[];
}

type ContentPart = {
  type: string;
  text?: string;
  thinking?: string;
};

interface ToolInternals {
  toolName: string;
  toolCallId: string;
  args?: Record<string, unknown>;
  result?: { isError?: boolean; content?: ContentPart[] } | null;
  expanded: boolean;
  isPartial: boolean;
}

type TrackKind = "assistant" | "tool";

interface TrackedEntry {
  kind: TrackKind;
  component: object;
  id?: string;
}

interface RunCollector {
  comps: TrackedEntry[];
  startedAt: number;
  finalTextIndex: number;
  // IDs of already-collected messages/tool calls, so a run is never
  // double-counted when pi recreates a component instance.
  seen: Set<string>;
}


/* ------------------------------------------------------------------ */
/* Extension state                                                     */
/* ------------------------------------------------------------------ */

export default function zenMode(pi: ExtensionAPI) {
  let config: ZenConfig = loadConfig();
  const toggleKey = normalizeKey(config.toggleKey, DEFAULT_TOGGLE_KEY);
  const revealKey = normalizeKey(config.revealKey, DEFAULT_REVEAL_KEY);
  const pickerKey = normalizeKey(config.pickerKey, DEFAULT_PICKER_KEY);
  type KeyIdParam = Parameters<typeof pi.registerShortcut>[0];

  const assistantProto = AssistantMessageComponent.prototype as unknown as {
    updateContent: (
      this: AssistantMessageComponent,
      message: AssistantMessage,
      isStreaming?: boolean,
    ) => void;
  };
  const toolProto = ToolExecutionComponent.prototype as unknown as {
    render: (this: ToolExecutionComponent, width: number) => string[];
  };
  let originalAssistantUpdate = assistantProto.updateContent;
  let originalToolRender = toolProto.render;
  let patchInstalled = false;

  // Latest message per assistant component.
  const assistantStates = new WeakMap<AssistantMessageComponent, AssistantMessage>();
  // Which collector a component belongs to (for tool placeholder rendering).
  const compCollector = new WeakMap<object, RunCollector>();
  // Per-collector reveal flag (raw transcript vs. placeholders).
  const revealed = new WeakMap<RunCollector, boolean>();

  // Current hidden run group; spans consecutive turns until the agent idles.
  let collector: RunCollector | undefined;
  // Every collector ever presented, so zen-off / shutdown can restore all of
  // them (not just the newest) to their original rendering.
  const collectors: RunCollector[] = [];
  let busy = false;
  let presentedCollector: RunCollector | undefined;
  // toolCallIds Pi actually started during the current busy epoch (from
  // tool_execution_start events) — collection is event-driven so re-renders
  // of older rows are never counted.
  const activeToolIds = new Set<string>();

  let activeTui: TUI | undefined;
  let activeTheme: Theme | undefined;
  let activeCtx: ExtensionContext | undefined;
  let deferTimer: ReturnType<typeof setTimeout> | undefined;

  /* ---------------- config ---------------- */

  function loadConfig(): ZenConfig {
    try {
      if (existsSync(configPath())) {
        const raw = JSON.parse(readFileSync(configPath(), "utf8")) as Partial<ZenConfig>;
        return {
          enabled: raw.enabled ?? DEFAULT_CONFIG.enabled,
          hideThinking: raw.hideThinking ?? DEFAULT_CONFIG.hideThinking,
          hideTools: raw.hideTools ?? DEFAULT_CONFIG.hideTools,
          toggleKey: raw.toggleKey,
          revealKey: raw.revealKey,
          pickerKey: raw.pickerKey,
        };
      }
    } catch {
      // fall back to defaults
    }
    return { ...DEFAULT_CONFIG };
  }

  function saveConfig() {
    try {
      mkdirSync(dirname(configPath()), { recursive: true });
      writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
    } catch {
      // non-fatal
    }
  }

  /* ---------------- collection ---------------- */

  function ensureCollector(): RunCollector {
    if (!collector) {
      collector = {
        comps: [],
        startedAt: Date.now(),
        finalTextIndex: -1,
        seen: new Set(),
      };
    }
    return collector;
  }

  function capture(kind: TrackKind, component: object, id?: string): RunCollector {
    const col = ensureCollector();
    if (id) {
      if (col.seen.has(id)) {
        const entry = col.comps.find((e) => e.id === id);
        if (entry && entry.component !== component) {
          compCollector.delete(entry.component);
          entry.component = component;
          compCollector.set(component, col);
        }
        return col;
      }
      col.seen.add(id);
    } else if (col.comps.some((e) => e.component === component)) {
      return col;
    }
    col.comps.push({ kind, component, id });
    compCollector.set(component, col);
    return col;
  }

  /* ---------------- styling helpers ---------------- */

  function dim(s: string): string {
    return activeTheme ? activeTheme.fg("muted", s) : s;
  }
  function think(s: string): string {
    return activeTheme ? activeTheme.italic(activeTheme.fg("thinkingText", s)) : s;
  }

  function contentOf(m: AssistantMessage): ContentPart[] {
    return (m.content ?? []) as ContentPart[];
  }
  function visibleTextParts(m: AssistantMessage): ContentPart[] {
    return contentOf(m).filter((p) => p.type === "text" && (p.text ?? "").trim());
  }
  function visibleThinking(m: AssistantMessage): ContentPart[] {
    return contentOf(m).filter((p) => p.type === "thinking" && (p.thinking ?? "").trim());
  }

  function filterMessage(
    message: AssistantMessage,
    includeThinking: boolean,
  ): AssistantMessage {
    const content = contentOf(message).filter((p) => p.type !== "thinking" || includeThinking);
    return { ...message, content: content as AssistantMessage["content"] };
  }

  function prependChild(container: Container, child: Spacer | Text) {
    const kids = container.children.slice();
    container.clear();
    container.addChild(child);
    for (const k of kids) container.addChild(k);
  }

  /* ---------------- presentation ---------------- */

  function assistantInternals(comp: AssistantMessageComponent): AssistantInternals {
    return comp as unknown as AssistantInternals;
  }

  /** Collapsed presentation for one assistant message. */
  function presentAssistant(comp: AssistantMessageComponent) {
    const self = assistantInternals(comp);
    const message = assistantStates.get(comp) ?? self.lastMessage;
    if (!message) return;
    const container = self.contentContainer;
    const thinkingParts = visibleThinking(message);
    const includeThinking = !config.hideThinking;

    // Text always goes through the captured original renderer. Thinking
    // is native when unhidden, a placeholder when hidden.
    originalAssistantUpdate.call(
      comp,
      filterMessage(message, includeThinking),
      false,
    );

    if (!includeThinking && thinkingParts.length > 0) {
      const joined = thinkingParts.map((p) => (p.thinking ?? "").trim());
      const words = joined.reduce((a, t) => a + t.split(/\s+/).length, 0);
      const runs = joined.length;
      const line = new Text(
        think(`◈ ${runs > 1 ? `${runs} 段思考` : "思考"}已折叠 · ${words} 词`),
        self.outputPad,
        0,
      );
      if (container.children.length > 0) {
        prependChild(container, line);
        prependChild(container, new Spacer(1));
      } else {
        container.addChild(new Spacer(1));
        container.addChild(line);
      }
    }

    if (container.children.length === 0) {
      const stop = message.stopReason;
      if (stop === "aborted" || stop === "error") {
        const err =
          message.errorMessage ||
          (stop === "aborted" ? "Operation aborted" : "Error");
        container.addChild(new Spacer(1));
        container.addChild(
          new Text(
            activeTheme ? activeTheme.fg("error", `⛔ ${err}`) : `⛔ ${err}`,
            self.outputPad,
            0,
          ),
        );
      }
    }
  }

  function collapseSummary(col: RunCollector): { tools: number; thinking: number } {
    let tools = 0;
    let thinking = 0;
    for (const entry of col.comps) {
      if (entry.kind === "tool") {
        tools++;
      } else {
        const comp = entry.component as AssistantMessageComponent;
        const message = assistantStates.get(comp);
        if (!message) continue;
        if (config.hideThinking && visibleThinking(message).length > 0) thinking++;
      }
    }
    return { tools: config.hideTools ? tools : 0, thinking };
  }

  /** Dim footer appended to the final answer listing what was collapsed. */
  function addCollapseFooter(col: RunCollector) {
    if (col.finalTextIndex < 0) return;
    const counts = collapseSummary(col);
    const hidden = counts.tools + counts.thinking;
    if (hidden === 0) return;
    const comp = col.comps[col.finalTextIndex].component as AssistantMessageComponent;
    const self = assistantInternals(comp);
    const parts: string[] = [];
    if (counts.tools > 0) parts.push(`${counts.tools} 次工具调用`);
    if (counts.thinking > 0) parts.push(`${counts.thinking} 段思考`);
    self.contentContainer.addChild(new Spacer(1));
    const olderHint =
      collectors.some((c) => c !== col)
        ? ` · ${pickerKey} 展开更早`
        : "";
    self.contentContainer.addChild(
      new Text(
        dim(`zen · ${parts.join(" / ")}已折叠 — ${revealKey} 展开本轮${olderHint}`),
        self.outputPad,
        0,
      ),
    );
  }

  function safeInvalidate(comp: ToolExecutionComponent) {
    try {
      comp.invalidate();
    } catch {
      // component may be mid-teardown
    }
  }

  function presentCollector(col: RunCollector) {
    // Identify the final answer: last assistant message with visible text.
    let finalTextIndex = -1;
    col.comps.forEach((entry, idx) => {
      if (entry.kind !== "assistant") return;
      const comp = entry.component as AssistantMessageComponent;
      const message = assistantStates.get(comp);
      if (message && visibleTextParts(message).length > 0) finalTextIndex = idx;
    });
    col.finalTextIndex = finalTextIndex;

    col.comps.forEach((entry) => {
      if (entry.kind === "assistant") {
        presentAssistant(entry.component as AssistantMessageComponent);
      } else {
        // Tools are rendered lazily by the patched render() — refresh them so
        // placeholders appear.
        safeInvalidate(entry.component as ToolExecutionComponent);
      }
    });

    addCollapseFooter(col);
  }

  function refreshCollapsedRuns() {
    for (const col of collectors) {
      if (revealed.get(col) === true) continue;
      presentCollector(col);
    }
  }

  /** Full transcript of one collector (original renderers). */
  function revealCollector(col: RunCollector) {
    for (const entry of col.comps) {
      if (entry.kind === "assistant") {
        const comp = entry.component as AssistantMessageComponent;
        const message = assistantStates.get(comp);
        if (message) {
          try {
            originalAssistantUpdate.call(comp, message, false);
          } catch {
            // fall back to collapsed presentation on error
            presentAssistant(comp);
          }
        }
      } else {
        safeInvalidate(entry.component as ToolExecutionComponent);
      }
    }
  }

  /* ---------------- patched renderers ---------------- */

  function ownedByLiveRun(component: object): RunCollector | undefined {
    const owned = compCollector.get(component) as RunCollector | undefined;
    if (!owned) return undefined;
    if (owned === collector) return owned;
    if (collectors.includes(owned) || owned === presentedCollector) return owned;
    return undefined; // pruned / detached: treat as not owned
  }

  function toolPlaceholderLines(component: ToolExecutionComponent): string[] {
    const info = component as unknown as ToolInternals;
    const isError = info.result?.isError === true;
    const lines = info.result?.content
      ? info.result.content.reduce(
          (acc, p) =>
            acc +
            (p.type === "text" && p.text
              ? p.text.split("\n").filter((l) => l.trim()).length
              : 0),
          0,
        )
      : 0;
    const status = isError ? "failed" : lines > 0 ? `ok · ${lines} lines` : "done";
    return [dim(`${isError ? "⚠" : "⚙"} ${info.toolName} — ${status}`)];
  }

  function patchedAssistantUpdate(
    this: AssistantMessageComponent,
    message: AssistantMessage,
    isStreaming?: boolean,
  ) {
    try {
      const self = assistantInternals(this);
      self.lastMessage = message;
      self.isStreaming = isStreaming ?? self.isStreaming ?? false;
      assistantStates.set(this, message);

      const owned = ownedByLiveRun(this);
      if (owned && owned !== collector) {
        // Component of an earlier (presented) run got touched again: keep
        // that run's own presentation instead of re-collecting it.
        if (revealed.get(owned) === true) {
          originalAssistantUpdate.call(this, message, isStreaming);
        } else {
          presentAssistant(this);
        }
        return;
      }

      if (!(config.enabled && busy)) {
        originalAssistantUpdate.call(this, message, isStreaming);
        return;
      }

      // Zen + running: hide only the categories whose switches are on.
      // Unhidden thinking/text stream through the original renderer so the
      // native (or compact-thinking) UI stays intact. A message is collected
      // once (by timestamp) even if pi streams many updates.
      const ts = message.timestamp;
      const id =
        typeof ts === "number" || typeof ts === "string" ? `m:${ts}` : undefined;
      capture("assistant", this, id);
      const includeThinking = !config.hideThinking;
      originalAssistantUpdate.call(
        this,
        filterMessage(message, includeThinking),
        isStreaming,
      );
    } catch {
      originalAssistantUpdate.call(this, message, isStreaming);
    }
  }

  function patchedToolRender(this: ToolExecutionComponent, width: number) {
    try {
      if (!config.enabled) {
        return originalToolRender.call(this, width);
      }

      // Always collect during a zen run so toggling hideTools later can
      // still find the row. Visibility is decided below, not at capture.
      let owned = ownedByLiveRun(this);
      if (!owned && busy) {
        const info = this as unknown as ToolInternals;
        capture("tool", this, `t:${info.toolCallId ?? info.toolName}`);
        owned = collector;
      }

      if (!config.hideTools) {
        return originalToolRender.call(this, width);
      }

      if (owned === collector && busy) return [];
      if (owned) {
        if (revealed.get(owned) === true || (this as unknown as ToolInternals).expanded) {
          return originalToolRender.call(this, width);
        }
        return toolPlaceholderLines(this);
      }
      if (busy) return [];
      return originalToolRender.call(this, width);
    } catch {
      return originalToolRender.call(this, width);
    }
  }

  /* ---------------- lifecycle ---------------- */

  function beginRun() {
    busy = true;
    installPatches();
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = undefined;
  }

  /** Tools whose tool_execution_start never fired during this busy epoch are
   * legacy rows Pi merely re-rendered (e.g. after a /reload or a scroll
   * repaint). They are not part of the run: unlink them so their normal
   * rendering returns and they are not counted. */
  function pruneUnconfirmedTools(col: RunCollector, confirmed: Set<string>) {
    const kept: TrackedEntry[] = [];
    for (const entry of col.comps) {
      if (entry.kind === "tool") {
        const comp = entry.component as unknown as ToolInternals;
        const key = comp.toolCallId ?? comp.toolName;
        if (key && !confirmed.has(key)) {
          compCollector.delete(comp);
          safeInvalidate(entry.component as ToolExecutionComponent);
          continue;
        }
      }
      kept.push(entry);
    }
    col.comps = kept;
  }

  function maybeFinalize(ctx: ExtensionContext) {
    if (!config.enabled || !busy || !collector) return;
    if (!ctx.isIdle() || ctx.hasPendingMessages()) {
      scheduleDeferredFinalize();
      return;
    }
    busy = false;
    const col = collector;
    collector = undefined;
    // Snapshot the tools Pi actually started in this epoch before clearing.
    const confirmed = new Set(activeToolIds);
    activeToolIds.clear();
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = undefined;

    if (col.comps.length === 0) return;
    pruneUnconfirmedTools(col, confirmed);
    if (col.comps.length === 0) return;
    presentCollector(col);
    collectors.push(col);
    presentedCollector = col;
    activeTui?.requestRender(true);
  }

  function scheduleDeferredFinalize() {
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = setTimeout(() => {
      deferTimer = undefined;
      if (busy && activeCtx) maybeFinalize(activeCtx);
    }, 700);
  }

  /** Show the raw transcript for everything captured (used when zen turns off). */
  function restoreAllReveal() {
    const seen = new Set<RunCollector>();
    if (collector) seen.add(collector);
    for (const col of collectors) seen.add(col);
    if (presentedCollector) seen.add(presentedCollector);
    collector = undefined;
    busy = false;
    activeToolIds.clear();
    presentedCollector = undefined;
    collectors.length = 0;
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = undefined;
    for (const col of seen) revealCollector(col);
  }

  /* ---------------- master toggle & status ---------------- */

  // Indicator shown in the extension-status channel: with the built-in footer
  // it lands on the same line as other extension statuses; a custom footer
  // (e.g. pi-statusline) renders it through its own extension-status surface.
  const STATUS_KEY = "zen";

  function syncZenStatus() {
    const ctx = activeCtx;
    if (!ctx || ctx.mode !== "tui") return;
    if (config.enabled) {
      ctx.ui.setStatus(STATUS_KEY, "◉ zen");
    } else {
      ctx.ui.setStatus(STATUS_KEY, undefined);
    }
  }

  function setEnabled(next: boolean, ctx: ExtensionContext | undefined) {
    if (config.enabled === next) return;
    config.enabled = next;
    saveConfig();
    if (ctx) activeCtx = ctx;
    if (next) {
      installPatches();
    } else {
      restoreAllReveal();
      uninstallPatches();
    }
    syncZenStatus();
    if (activeTui) activeTui.requestRender(true);
  }

  /* ---------------- per-run reveal ---------------- */

  function setRunRevealed(col: RunCollector, on: boolean) {
    revealed.set(col, on);
    if (on) revealCollector(col);
    else presentCollector(col);
    activeTui?.requestRender(true);
  }

  function toggleReveal() {
    const col = presentedCollector;
    if (!col || col.comps.length === 0) {
      activeCtx?.ui.notify("zen · 暂无已折叠内容");
      return;
    }
    setRunRevealed(col, !(revealed.get(col) ?? false));
  }

  /** Compaction / branch switches rebuild the transcript: earlier runs'
   * components are gone, so their collapsed content can no longer be shown.
   * Drop the history so the picker never offers unexpandable runs. */
  function pruneZenHistory() {
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = undefined;
    busy = false;
    collector = undefined;
    collectors.length = 0;
    presentedCollector = undefined;
    activeToolIds.clear();
  }


  /* ---------------- patch install / restore ---------------- */

  function installPatches() {
    if (patchInstalled) return;
    // Capture whatever is currently installed (possibly another extension's
    // patch, e.g. pi-compact-thinking) and wrap it. Called lazily on the
    // first busy run / enable, i.e. after every other extension's
    // session_start handler ran — so this patch is always the outermost one.
    originalAssistantUpdate = assistantProto.updateContent;
    originalToolRender = toolProto.render;
    assistantProto.updateContent = patchedAssistantUpdate;
    toolProto.render = patchedToolRender;
    patchInstalled = true;
  }

  function uninstallPatches() {
    if (!patchInstalled) return;
    assistantProto.updateContent = originalAssistantUpdate;
    toolProto.render = originalToolRender;
    patchInstalled = false;
  }

  /* ---------------- /zen settings panel ---------------- */

  function zenSettingItems(): SettingItem[] {
    return [
      {
        id: "enabled",
        label: "◎  专注模式 · focus mode",
        currentValue: config.enabled ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "hideThinking",
        label: "◈ 运行时隐藏思考 · thinking",
        currentValue: config.hideThinking ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "hideTools",
        label: "⚙ 运行时隐藏工具 · tools",
        currentValue: config.hideTools ? "on" : "off",
        values: ["on", "off"],
      },
    ];
  }

  function applyZenChange(id: string, value: string, ctx: ExtensionContext) {
    const on = value === "on";
    if (id === "enabled") {
      setEnabled(on, ctx);
    } else if (id === "hideThinking") {
      config.hideThinking = on;
      saveConfig();
      refreshCollapsedRuns();
    } else if (id === "hideTools") {
      config.hideTools = on;
      saveConfig();
      refreshCollapsedRuns();
    }
  }

  async function openZenPanel(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("/zen requires TUI mode", "error");
      return;
    }
    await ctx.ui.custom((tui, theme, _kb, done) => {
      // Gentle rotating mark on the title while the panel is open.
      const frames = ["◴", "◷", "◶", "◵"];
      let frame = 0;
      const timer = setInterval(() => {
        frame = (frame + 1) % frames.length;
        tui.requestRender();
      }, 240);
      const stop = () => clearInterval(timer);

      const container = new Container();
      container.addChild(
        new (class {
          render(_width: number) {
            const mark = theme.fg("accent", frames[frame]);
            return [
              `${mark}  ${theme.fg("accent", theme.bold("zen · Focus Mode"))}`,
              theme.fg("muted", "两个开关控制运行时藏思考 / 工具;文字始终走原生 UI。结束后隐藏项收成占位。"),
              "",
            ];
          }
          invalidate() {}
        })(),
      );
      const items = zenSettingItems();
      const settingsList = new SettingsList(
        items,
        Math.min(items.length + 4, 15),
        getSettingsListTheme(),
        (id, newValue) => {
          applyZenChange(id, newValue, ctx);
          tui.requestRender();
        },
        () => {
          clearInterval(timer);
          done(undefined);
        },
      );
      container.addChild(settingsList);
      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          settingsList.handleInput?.(data);
          tui.requestRender();
        },
        dispose() {
          stop();
        },
      };
    });
  }

  /* ---------------- run picker (choose which collapsed run) ---------------- */

  function runLabel(col: RunCollector, ordinal: number): string {
    const counts = collapseSummary(col);
    const parts: string[] = [];
    if (counts.tools > 0) parts.push(`${counts.tools} 工具`);
    if (counts.thinking > 0) parts.push(`${counts.thinking} 思考`);
    const detail = parts.length > 0 ? parts.join(" / ") : "过程";
    const secs = Math.max(0, Math.round((Date.now() - col.startedAt) / 1000));
    const when = secs < 90 ? `${secs}s 前` : `${Math.round(secs / 60)}m 前`;
    return `#${ordinal} · ${when} · ${detail}`;
  }

  async function openRunPicker(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") {
      ctx.ui.notify("zen · 展开面板需要 TUI 模式", "error");
      return;
    }
    const total = collectors.length;
    if (total === 0) {
      ctx.ui.notify("zen · 暂无已折叠的轮次");
      return;
    }
    await ctx.ui.custom((tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(
        new (class {
          render(_width: number) {
            return [
              theme.fg("accent", theme.bold("zen · 展开哪一轮?")),
              theme.fg("muted", `${total} 轮已折叠 · ↑↓ 选择 · Enter 展开/收起 · Esc 关闭`),
              "",
            ];
          }
          invalidate() {}
        })(),
      );
      const items: SettingItem[] = collectors.map((col, index) => ({
        id: `zen-run-${index}`,
        label: runLabel(col, total - index),
        currentValue: revealed.get(col) ? "展开" : "收起",
        values: ["收起", "展开"],
      }));
      const settingsList = new SettingsList(
        items,
        Math.min(items.length + 3, 12),
        getSettingsListTheme(),
        (id, newValue) => {
          const index = Number(id.replace("zen-run-", ""));
          const col = collectors[index];
          if (col) setRunRevealed(col, newValue === "展开");
        },
        () => done(undefined),
      );
      container.addChild(settingsList);
      return {
        render(width: number) {
          return container.render(width);
        },
        invalidate() {
          container.invalidate();
        },
        handleInput(data: string) {
          settingsList.handleInput?.(data);
          tui.requestRender();
        },
      };
    });
  }

  /* ---------------- pi wiring ---------------- */

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeCtx = ctx;
    activeTheme = ctx.ui.theme;
    // NOTE: patches are installed lazily (first busy run / enable) so zen
    // always wraps whatever other extensions installed during session_start.

    // Empty widget = render handle only; the visible indicator is a status
    // item so it shares the statusline with other extensions instead of
    // occupying its own row.
    ctx.ui.setWidget(WIDGET_ID, (tui, theme) => {
      activeTui = tui;
      activeTheme = theme;
      return { render: () => [], invalidate() {} };
    });
    syncZenStatus();
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    activeCtx = ctx;
    activeTheme = ctx.ui.theme;
    // Branch switches rebuild the transcript; earlier collapsed runs no
    // longer have live components to reveal.
    pruneZenHistory();
  });

  // Compaction replaces earlier messages with a summary entry, so collapsed
  // runs before the compact point can no longer be expanded — drop that
  // history and keep only runs collapsed after the compaction.
  pi.on("session_compact", async () => {
    pruneZenHistory();
  });

  pi.on("session_shutdown", (_event, ctx) => {
    if (deferTimer) clearTimeout(deferTimer);
    deferTimer = undefined;
    restoreAllReveal();
    if (ctx.mode === "tui") {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setWidget(WIDGET_ID, undefined);
    }
    uninstallPatches();
    activeTui = undefined;
    activeTheme = undefined;
    activeCtx = undefined;
  });

  pi.on("turn_start", async () => {
    if (config.enabled) beginRun();
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!config.enabled) return;
    activeCtx = ctx;
    if (ctx.isIdle() && !ctx.hasPendingMessages()) {
      maybeFinalize(ctx);
    } else {
      scheduleDeferredFinalize();
    }
  });

  pi.on("message_end", async (event, ctx) => {
    if (!config.enabled || !busy) return;
    activeCtx = ctx;
    const msg = event.message as AssistantMessage;
    if (msg.role !== "assistant") return;
    // Aborted/errored turns may skip turn_end entirely.
    if (msg.stopReason === "aborted" || msg.stopReason === "error") {
      scheduleDeferredFinalize();
    }
  });

  // tool_execution_start is the allow-list for pruneUnconfirmedTools:
  // patchedToolRender also sees older rows Pi re-paints during a run.
  pi.on("tool_execution_start", async (_event, ctx) => {
    if (!config.enabled || !busy) return;
    activeCtx = ctx;
    const evt = _event as { toolCallId?: string; toolName?: string };
    const id = evt.toolCallId ?? evt.toolName;
    if (id) activeToolIds.add(id);
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    if (!config.enabled || !busy) return;
    activeCtx = ctx;
    maybeFinalize(ctx);
  });

  function rejectIfBusy(ctx: ExtensionContext): boolean {
    if (!busy) return false;
    ctx.ui.notify("zen · 这轮还在跑，结束后再改");
    return true;
  }

  pi.registerCommand("zen", {
    description: "zen focus mode: hide thinking/tools while running, keep the final answer",
    handler: async (_args, ctx) => {
      activeCtx = ctx;
      if (rejectIfBusy(ctx)) return;
      await openZenPanel(ctx);
    },
  });

  pi.registerShortcut(toggleKey as KeyIdParam, {
    description: "Toggle zen focus mode",
    handler: async (ctx) => {
      activeCtx = ctx;
      if (rejectIfBusy(ctx)) return;
      const next = !config.enabled;
      setEnabled(next, ctx);
      ctx.ui.notify(
        next
          ? `zen · focus mode on — 运行时按开关隐藏 (${revealKey} 展开本轮)`
          : "zen · focus mode off",
      );
    },
  });

  pi.registerShortcut(revealKey as KeyIdParam, {
    description: "Toggle zen reveal of the last run",
    handler: async (ctx) => {
      activeCtx = ctx;
      if (rejectIfBusy(ctx)) return;
      toggleReveal();
    },
  });

  pi.registerShortcut(pickerKey as KeyIdParam, {
    description: "Choose a collapsed zen run to expand/collapse",
    handler: async (ctx) => {
      activeCtx = ctx;
      if (rejectIfBusy(ctx)) return;
      await openRunPicker(ctx);
    },
  });
}
