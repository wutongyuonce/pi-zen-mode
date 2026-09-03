<h1 align="center">Zen-mode</h1>

<p align="center">
  Hide thinking and tools. Words still stream.
  <br>
  <i>Distraction-free focus mode for <a href="https://github.com/earendil-works/pi-mono">Pi</a></i>
</p>

<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a> · <a href="DESIGN.md">Design notes (中文)</a>
</p>

---

Every turn in Pi floods the chat with reasoning blocks and tool calls. **Zen-mode** hides whichever of those you switch off: unhidden categories keep their native UI live; hidden ones vanish as they appear and collapse to a dim one-liner when the run ends. Assistant text always streams — zen does not try to hide "interim" replies. One keypress unfolds the hidden process again.



## Features

- **Hide while running, per switch** — thinking / tools each choose live vs hidden; text always streams
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



| Key | Action |
| --- | --- |
| `ctrl+alt+f` | Toggle zen focus mode |
| `ctrl+alt+r` | Reveal / collapse the **latest** run's hidden process |
| `ctrl+alt+s` | Open a picker to reveal / collapse **any** collapsed run |
| `/zen` | Open the settings panel (same style as `/tools`) |

`ctrl+o` is Pi's **global** tool-output toggle (not per row): it expands every tool currently on screen and new tool rows inherit that flag. While a run is in flight zen still paints tools as empty; after the run, if the flag is on, tools render in full instead of the one-line placeholder. Press `ctrl+o` again to collapse and placeholders come back.

While a run is in progress `/zen` and the three shortcuts are ignored — change settings after it finishes so a half-streamed turn is not rewritten mid-flight.

> After a **compaction** (auto or `/compact`) or a branch switch, runs before that point no longer have live components — their full process was replaced by the summary — so those collapsed runs can't be expanded; the picker only lists runs collapsed afterwards.

## Configuration

Created on first change at `~/.pi/agent/zen-mode.json` (or under `$PI_CODING_AGENT_DIR` when set):

```json
{
  "enabled": true,
  "hideThinking": true,
  "hideTools": true,
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
| `toggleKey` / `revealKey` / `pickerKey` | The three shortcuts — any valid Pi keybinding string |

While zen is on, thinking and tools are tracked. The two sub-toggles only choose **hidden vs visible** (and the footer counts). Text is never hidden — interim chatter and the final answer are the same `text` parts on the wire. Turn a switch off and that category uses the native renderer; turn it back on and already-finished runs collapse those rows to placeholders — only the tracked components are redrawn. `ctrl+alt+r` reveals through the original renderer. `/reload` after changes.

## Compatibility

- Requires TUI mode
- Implemented by hooking the `AssistantMessageComponent` / `ToolExecutionComponent` renderers — internal UI APIs may change in future Pi releases, so the extension may need updates after upgrading
- Tested with Pi `0.84.x`

## License

[MIT](./LICENSE)
