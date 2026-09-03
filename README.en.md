<h1 align="center">🔖 Zen-mode</h1>

<p align="center">
  Hide thinking and tools. Words still stream.
  <br>
  <i>Distraction-free focus mode for <a href="https://github.com/earendil-works/pi-mono">Pi</a></i>
</p>
<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a> · <a href="DESIGN.md">Design notes (中文)</a>
</p>
Every turn in Pi floods the chat with reasoning and tool calls. **Zen-mode** hides those two kinds of process output with switches: turn a switch off and that category keeps its native UI (thinking blocks stay looking like thinking blocks); turn it on and the output is hidden. The model's words always stream as usual. When the run finishes, what was hidden is re-rendered as a dim one-line placeholder.

<p align="center">
  <img src="img/image-20260904020809983.png" alt="zen collapsed run" width="480" />
</p>

Want to see the hidden process? `Ctrl+Alt+R` unfolds the latest run:

<p align="center">
  <img src="img/image-20260904020905103.png" alt="zen reveal latest run" width="560" />
</p>

`Ctrl+Alt+S` unfolds earlier runs:

<p align="center">
  <img src="img/PixPin_2026-09-04_02-44-45.png" alt="zen run picker" width="560" />
</p>

## Features

- **Hide per switch** — thinking / tools each choose live vs hidden; text always streams
- **Native UI for what's visible** — unhidden thinking keeps compact-thinking / built-in styling
- **Answer-first when done** — full final answer, one-line placeholders for what was hidden
- **Reveal on demand** — `ctrl+alt+r` / `ctrl+alt+s` restore the latest run or pick an earlier one through the original renderer
- **Non-invasive** — coexists with renderer extensions like [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking); when zen is off it never touches their rendering

## Install

```bash
pi install git:github.com/wutongyuonce/pi-zen-mode
```

Then `/reload` (or restart Pi).

> Want a quick try? Drop `zen-mode.ts` into `~/.pi/agent/extensions/` and `/reload`.

Update with `pi update --extensions`.

## Usage

`/zen` opens the settings panel:

<p align="center">
  <img src="img/PixPin_2026-09-04_02-43-34.png" alt="zen settings panel" width="560" />
</p>

Besides the **focus mode** switch, there are two more:

* **thinking** — whether thinking blocks are hidden for every turn while focus mode is on
* **tools** — whether tool rows are hidden for every turn while focus mode is on

## Shortcuts

| Key | Action |
| --- | --- |
| `ctrl+alt+f` | Toggle zen focus mode |
| `ctrl+alt+r` | Reveal / collapse the **latest** run's hidden process |
| `ctrl+alt+s` | Open a picker to reveal / collapse **any** collapsed run |

`ctrl+o` is Pi's **global** tool-output toggle (not per row): it expands every tool currently on screen, and new tool rows inherit that flag. While a run is in flight zen still paints tools as empty; after the run, if the flag is on, tools render in full instead of the one-line placeholder. Press `ctrl+o` again to collapse and placeholders come back.

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
| `hideThinking` | Hide thinking while running; collapse to a one-line `◈` when done; `false` streams the native thinking UI |
| `hideTools` | Hide tool calls while running; collapse to a one-line `⚙` when done; `false` streams native tool rows |
| `toggleKey` / `revealKey` / `pickerKey` | The three shortcuts — any valid Pi keybinding string |

While zen is on, thinking and tools are tracked (so you can flip a switch later). The two sub-toggles only choose **hidden vs visible**, and the footer counts. Text is never hidden — interim chatter and the final answer are the same `text` parts on the wire, so hiding them would flash a few characters then vanish. Turn a switch off and that category uses the native renderer; turn it back on and already-finished runs collapse those rows to placeholders (only the tracked components are redrawn). `ctrl+alt+r` reveals through the original renderer. `/reload` after changes.

## Compatibility

- Requires TUI mode
- Implemented by hooking the `AssistantMessageComponent` / `ToolExecutionComponent` renderers — internal UI APIs may change in future Pi releases, so the extension may need updates after upgrading
- Tested with Pi `0.84.x`

## License

[MIT](./LICENSE)
