<h1 align="center">Zen-mode</h1>

<p align="center">
  Nothing while it runs — only the answer when it's done.
  <br>
  <i>Distraction-free focus mode for <a href="https://github.com/earendil-works/pi-mono">Pi</a></i>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

---

Every turn in Pi floods the chat with reasoning blocks, tool calls and interim notes. **Zen-mode** hides whichever of those you switch off: unhidden categories keep their native UI live (thinking blocks stay looking like thinking blocks); hidden ones vanish as they appear, collapse to a dim one-liner when the run ends, and the final answer still shows. One keypress unfolds the hidden process again.

<img src="img/PixPin_2026-09-03_22-26-25.png" alt="PixPin_2026-09-03_22-26-25" style="zoom:40%;" />

## Features

- **Hide while running, per switch** — thinking / tools / interim replies each choose live vs hidden
- **Native UI for what's visible** — unhidden thinking keeps compact-thinking / built-in styling
- **Answer-first when done** — full final answer, one-line placeholders for what was hidden
- **Reveal on demand** — `ctrl+alt+r` restores the last run through the original renderer
- **Non-invasive** — coexists with renderer extensions like [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking); when zen is off it never touches their rendering

## Install

```bash
pi install git:github.com/wutongyuonce/pi-zen-mode
```

Then `/reload` (or restart Pi).

> Want a quick try? Drop `zen-mode.ts` into `~/.pi/agent/extensions/` and `/reload`.

Update with `pi update --extensions`.

## Usage

![PixPin_2026-09-03_22-17-07](img/PixPin_2026-09-03_22-17-07.png)

| Key | Action |
| --- | --- |
| `ctrl+alt+f` | Toggle zen focus mode |
| `ctrl+alt+r` | Reveal / collapse the **latest** run's hidden process |
| `ctrl+alt+s` | Open a picker to reveal / collapse **any** collapsed run |
| `/zen` | Open the settings panel (same style as `/tools`) |

`ctrl+o` (Pi built-in) still expands a single tool's full output.

> After a **compaction** (auto or `/compact`) or a branch switch, runs before that point no longer have live components — their full process was replaced by the summary — so those collapsed runs can't be expanded; the picker only lists runs collapsed afterwards.

## Configuration

Created on first change at `~/.pi/agent/zen-mode.json` (or under `$PI_CODING_AGENT_DIR` when set):

```json
{
  "enabled": true,
  "hideThinking": true,
  "hideTools": true,
  "hideInterimText": true,
  "toggleKey": "ctrl+alt+f",
  "revealKey": "ctrl+alt+r",
  "pickerKey": "ctrl+alt+s"
}
```

| Key | Meaning |
| --- | --- |
| `enabled` | Master switch |
| `hideThinking` | Hide thinking while running; collapse to a one-line `💭` when done; `false` streams the native thinking UI |
| `hideTools` | Hide tool calls while running; collapse to a one-line `⚙` when done; `false` streams native tool rows |
| `hideInterimText` | Hide interim replies while running; collapse to a one-liner when done; `false` streams them live |
| `toggleKey` / `revealKey` / `pickerKey` | The three shortcuts — any valid Pi keybinding string |

While zen is on, all three categories are tracked. The sub-toggles only choose **hidden vs visible** (and the footer counts). Turn one off and that category uses the native renderer; turn it back on and already-finished runs collapse those rows to placeholders — only the tracked components are redrawn. `ctrl+alt+r` reveals through the original renderer. `/reload` after changes.

## Compatibility

- Requires TUI mode
- Coexists with pi-compact-thinking: with zen off no renderer patches are installed and compact-thinking behaves exactly as before; with zen on it wraps them and collapses their output too — the reveal view follows whichever inner pipeline is installed (compact-thinking shows its compact style when present)
- Implemented by hooking the `AssistantMessageComponent` / `ToolExecutionComponent` renderers — internal UI APIs may change in future Pi releases, so the extension may need updates after upgrading
- Tested with Pi `0.84.x`

## License

[MIT](./LICENSE)
