# POPO Sheet Tool Copy

这是 POPO Sheet 自动化能力的 MCP/plugin 工具。agent 的主入口是
`skills/popo-sheet-tool-copy/SKILL.md`，它负责把“理解需求 -> 读取 POPO -> 搜集/整理来源内容 -> 写入 -> 格式整理 -> 验证”串成一个简洁流程。

## 范围

- 通过 ShareDB snapshot 读取 POPO workbook。
- 将用户提供的文件、页面、URL 或搜索结果整理成可写入的来源表。
- 按表格内名字解析内部 `rowId,colId`。
- 通过 ShareDB JSON0 op 写入简单文本/链接单元格。
- 应用基础格式：行高、列宽、合并单元格、单元格文本和已有 style id。
- 写入后用 fresh snapshot 验证，而不是依赖滚动截图。
- 保存 WebBridge 响应和截图为诊断 artifact。

## 目录

- `.codex-plugin/plugin.json`: plugin 元信息。
- `.mcp.json`: 从本目录启动 MCP server 的配置。
- `mcp/server.cjs`: MCP server 和 CLI 入口。
- `skills/popo-sheet-tool-copy/SKILL.md`: agent 使用本工具的主引导入口。
- `test-inputs/`: 可复用的 CLI 调试输入。
- `docs/verification.md`: 实机验证记录和已知边界。

## 本地验证

使用 Codex 自带 Node.js runtime：

```powershell
$node = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node .\mcp\server.cjs --list-tools
& $node --check .\mcp\server.cjs
```

调用工具时，优先用 `@file.json` 传参，避免 Windows shell 转义问题：

```powershell
& $node .\mcp\server.cjs --call popo_write_from_source_file '@.\test-inputs\write-from-source-dry-run.json'
```

## 可用工具

- `popo_get_snapshot_summary`
- `popo_resolve_by_name`
- `popo_probe_write_channel`
- `popo_write_by_name`
- `popo_write_from_source_file`
- `popo_apply_basic_format`
- `popo_screenshot_checkpoint`

## 验证原则

数据正确性优先用 ShareDB snapshot 验证。截图只作为 UI fallback、故障诊断和视觉格式证据。
