# POPO-Sheet.UPUP

这是一个面向 POPO / office.netease.com 在线表格的 Codex Tool/plugin。目标是让一个 agent 拿到 POPO 表格任务后，可以快速理解需求、读取表格、搜集或整理来源内容、按表格内名字匹配写入、整理格式，并完成回读验证。

## 适用场景

- 通过 ShareDB snapshot 读取 POPO 工作簿结构，减少滚动截图和盲点坐标。
- 按表格内真实可见的达人名/账号名匹配源数据，而不是相信外部行号。
- 将用户给的文件、浏览器页面、URL 或搜索结果整理成小型来源表，再写入 POPO。
- 写入前生成可粘贴 TSV 和匹配报告，提前发现重名、缺失、错位。
- 通过 ShareDB JSON0 op 写入简单文本和链接字段。
- 复用已有样式 id、行高、列宽和合并单元格等基础格式。
- 写入后用 fresh snapshot 回读验证；截图主要用于视觉格式确认。

## 文件结构

- `tools/popo-sheet-tool-copy/skills/popo-sheet-tool-copy/SKILL.md`: agent 使用这个 Tool 时的主引导入口。
- `references/popo-sheet-reference.md`: POPO 内部结构、失败模式、键盘/剪贴板 fallback 和格式检查细节。
- `scripts/name_match_tsv.py`: 根据源数据和 POPO 复制 TSV 生成粘贴块与匹配报告。
- `.mcp.json`: 根目录 MCP 配置，指向隔离的工具副本。
- `tools/popo-sheet-tool-copy/`: 可安装/可调试的 MCP/plugin 工具，包含 skill、MCP server、测试输入和验证记录。

## 快速验证

如果 Windows 里的 `python` 或 `node` 没有配置到 `PATH`，可以使用 Codex 自带 runtime：

```powershell
$python = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$node = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"

& $python .\scripts\name_match_tsv.py --help
& $node --check .\tools\popo-sheet-tool-copy\mcp\server.cjs
& $node .\tools\popo-sheet-tool-copy\mcp\server.cjs --list-tools
```

如果 PowerShell 里中文显示成乱码，通常是终端输出编码问题，文件本身是 UTF-8。可以用：

```powershell
Get-Content -Encoding UTF8 README.md
```

## Agent 使用入口

当前只把一个入口交给 agent：

- skill 入口：`tools/popo-sheet-tool-copy/skills/popo-sheet-tool-copy/SKILL.md`
- MCP server：`tools/popo-sheet-tool-copy/mcp/server.cjs`
- MCP 配置：根目录 `.mcp.json` 或工具目录 `.mcp.json`

根目录不再维护并列的主 `SKILL.md`，避免 agent 在两个规则源之间摇摆；当前仓库只保留工具目录内的 agent skill。

可用工具：

- `popo_get_snapshot_summary`
- `popo_resolve_by_name`
- `popo_probe_write_channel`
- `popo_write_by_name`
- `popo_write_from_source_file`
- `popo_apply_basic_format`
- `popo_screenshot_checkpoint`

实机验证记录和当前边界见 `tools/popo-sheet-tool-copy/docs/verification.md`。

## GitHub CLI

这个仓库是公开仓库，所以普通 `git fetch` / `git pull` 可以不登录 GitHub CLI 直接读取。后续要 push 分支或创建 PR 时，确认 `gh` 已登录：

```powershell
gh auth status
```

## 安全原则

- 先读后写。
- 需要外部搜集内容时，先整理成结构化来源表，再批量写入。
- 按 POPO 表格内复制或 snapshot 得到的名字匹配，不按外部行号写入。
- 批量写入先 `dryRun:true`。
- 遇到重名、缺失预期行、保护单元格、剪贴板失败、只读 tab，立即停止。
- 数据正确性用 fresh snapshot 验证。
- 数据填完后主动检查格式；截图是视觉证据，不是数据正确性的唯一证据。
