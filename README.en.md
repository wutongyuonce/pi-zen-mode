<h1 align="center">zen-mode</h1>

<p align="center">
  Nothing while it runs — only the answer when it's done.
  <br>
  <i>Distraction-free focus mode for <a href="https://github.com/earendil-works/pi-mono">Pi</a></i>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

---

Every turn in Pi floods the chat with reasoning blocks, tool calls and interim notes. **zen-mode** silences all of it: while a run is streaming the chat area stays clean — just the native loader spinning — and when it finishes, the process is collapsed into a few dim one-liners while the final answer is rendered in full. One keypress unfolds the whole run again.

```
  default                                zen
──────────────────────────────      ──────────────────────────────
 you: find every TODO in repo       you: find every TODO in repo

     ⏳ (loader spinning)
     ⏳ bash grep TODO
     ✓ 42 found
     💭 (a screen of reasoning)      ⚙ bash — ok · 42 lines
     ⏳ read config.json             💭 thinking collapsed · 318 words
     full tool output…
     "let me check one more…"
     (final answer)                   (final answer, full)
```

## Features

- **Silent while running** — nothing but the loader during a turn
- **Answer-first when done** — full final answer, one-line placeholders for the rest
- **Reveal on demand** — `ctrl+alt+r` unfolds / refolds the last run
- **Independent toggles** — thinking, tool calls and interim replies collapse separately
- **Non-invasive** — coexists with renderer extensions like [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking); when zen is off it never touches their rendering

## Install

```bash
pi install git:github.com/wutongyuonce/pi-zen-mode
```

Then `/reload` (or restart Pi).

> Want a quick try? Drop `zen-mode.ts` into `~/.pi/agent/extensions/` and `/reload`.

Update with `pi update --extensions`.

## Usage

| Key | Action |
| --- | --- |
| `ctrl+alt+f` | Toggle zen focus mode |
| `ctrl+alt+r` | Reveal / collapse the last run's hidden process |
| `/zen` | Open the settings panel (same style as `/tools`) |

`ctrl+o` (Pi built-in) still expands a single tool's full output.

## Configuration

Created on first change at `~/.pi/agent/zen-mode.json` (or under `$PI_CODING_AGENT_DIR` when set):

```json
{
  "enabled": true,
  "hideThinking": true,
  "hideTools": true,
  "hideInterimText": true,
  "toggleKey": "ctrl+alt+f",
  "revealKey": "ctrl+alt+r"
}
```

| Key | Meaning |
| --- | --- |
| `enabled` | Master switch (everything is hidden while running regardless of the sub-toggles) |
| `hideThinking` | Collapse thinking blocks to a one-line `💭` after the run; `false` renders them in full |
| `hideTools` | Collapse tool calls to a one-line `⚙`; `false` uses the built-in full rendering |
| `hideInterimText` | Collapse interim replies (non-final text); `false` renders them in full |
| `toggleKey` / `revealKey` | Shortcut keys — any valid Pi keybinding string |

The three sub-toggles only affect **presentation after the run**; hiding *while* running is controlled by `enabled`. `/reload` after changes.

## Compatibility

- Requires TUI mode
- Coexists with pi-compact-thinking: with zen off no renderer patches are installed and compact-thinking behaves exactly as before; with zen on it wraps them and collapses their output too — the reveal view follows whichever inner pipeline is installed (compact-thinking shows its compact style when present)
- Implemented by hooking the `AssistantMessageComponent` / `ToolExecutionComponent` renderers — internal UI APIs may change in future Pi releases, so the extension may need updates after upgrading
- Tested with Pi `0.84.x`

## License

[MIT](./LICENSE)
