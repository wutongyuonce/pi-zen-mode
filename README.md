<h1 align="center">Zen-mode</h1>

<p align="center">
  运行中只显示转圈，结束后只留答案。
  <br>
  <i>Distraction-free focus mode for <a href="https://github.com/earendil-works/pi-mono">Pi</a></i>
</p>


<p align="center">
  <a href="README.md">中文</a> · <a href="README.en.md">English</a>
</p>

---

运行 pi 时，每轮对话会刷出大段 reasoning、工具调用、中间小结… **Zen-mode** 把这些全部藏起来：回合进行中聊天区保持安静，只有一行 loader 在转；跑完后中间过程收成几行浅色占位，最终答案完整呈现。想看过程？一个按键即可展开：

<img src="img/PixPin_2026-09-03_22-26-25.png" alt="PixPin_2026-09-03_22-26-25" style="zoom:40%;" />

## 特性

- **运行即隐身** — 回合进行中只有 loader,零噪音
- **结束见真章** — 最终答案全文显示,中间内容折成一行占位
- **随时可回看** — `ctrl+alt+r` 展开 / 收起最近一轮完整过程
- **三档独立开关** — thinking、工具调用、中间回复 各自决定折叠还是展示
- **零侵入** — 与 [pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking) 等渲染扩展共存;关闭时完全不碰它们的渲染

## 安装

```bash
pi install git:github.com/wutongyuonce/pi-zen-mode
```

然后 `/reload`（或重启 pi）。

> 只想手动试:把 `zen-mode.ts` 放进 `~/.pi/agent/extensions/`,`/reload` 即可。

更新：`pi update --extensions`

## 用法

![PixPin_2026-09-03_22-17-07](img/PixPin_2026-09-03_22-17-07.png)

| 按键 | 作用 |
| --- | --- |
| `ctrl+alt+f` | 开关 zen 专注模式 |
| `ctrl+alt+r` | 展开 / 收起最近一轮被折叠的过程 |
| `/zen` | 打开设置面板(风格与 `/tools` 一致) |

`ctrl+o`（pi 原生）仍可单独展开某个工具的完整输出。

## 配置

配置在首次改动时自动生成于 `~/.pi/agent/zen-mode.json`(设置了 `$PI_CODING_AGENT_DIR` 则在其下):

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

| 字段 | 含义 |
| --- | --- |
| `enabled` | 总开关(运行中一律全隐藏,与子开关无关) |
| `hideThinking` | 结束后思考块折成一行 `💭`;`false` 则全文显示 |
| `hideTools` | 结束后工具调用折成一行 `⚙`;`false` 则原生完整渲染 |
| `hideInterimText` | 结束后的中间回复(非最终答案)折成一行;`false` 则全文显示 |
| `toggleKey` / `revealKey` | 快捷键,任意合法的 pi 键位字符串 |

三个子开关只影响**结束后的展示**，运行中的隐藏由 `enabled` 决定。改完 `/reload` 生效。

## 兼容性

- 需要 TUI 模式
- 与 pi-compact-thinking 并存：zen 关闭时不安装任何渲染补丁，compact-thinking 行为完全不变；开启时 zen 叠在其外层一并折叠，「展开」视图遵循内层管线（装了 compact-thinking 即显示其紧凑样式）
- 通过接管 `AssistantMessageComponent` / `ToolExecutionComponent` 渲染实现，pi 升级后内部接口变动可能需要跟进更新
- 已在 pi `0.84.x` 测试

## License

[MIT](./LICENSE)
