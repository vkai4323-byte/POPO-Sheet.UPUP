# POPO Sheet Tool Copy

Isolated experimental tool project for POPO Sheet automation. This folder is intentionally separate
from the installed `popo-sheet` skill so tool work can be implemented and verified without polluting
the existing skill package.

## Scope

- Read POPO workbook data through the verified ShareDB snapshot path.
- Resolve internal `rowId,colId` cells by in-sheet names.
- Write simple text/link cells through the verified ShareDB JSON0 op path.
- Verify writes through a fresh snapshot, not repeated scroll screenshots.
- Save WebBridge responses and screenshots as stable diagnostic artifacts.
- Provide a thin routing skill that tells Codex when and how to call the MCP tools.

## Skill + Tool Relationship

This project is designed to use both:

- The Skill (`skills/popo-sheet-tool-copy/SKILL.md`) is the routing and safety layer. It tells Codex
  which tool to call, when to dry-run, and when to stop.
- The MCP server (`mcp/server.cjs`) is the execution layer. It performs WebBridge calls, ShareDB
  snapshot reads, JSON0 writes, matching, and verification.

The tools can still be run directly from the CLI for testing, but the intended Codex experience is:
the skill triggers, then the agent calls the MCP tools instead of rewriting fragile scripts.

## Tools

- `popo_get_snapshot_summary`
- `popo_resolve_by_name`
- `popo_probe_write_channel`
- `popo_write_by_name`
- `popo_write_from_source_file`
- `popo_screenshot_checkpoint`

## Direct Test Mode

Use the bundled Node.js runtime:

```powershell
$node = "C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node .\mcp\server.cjs --list-tools
& $node .\mcp\server.cjs --call popo_probe_write_channel '{"session":"popo-brf-repair"}'
```

For Windows-safe JSON arguments, use `@file.json`:

```powershell
& $node .\mcp\server.cjs --call popo_write_from_source_file '@.\test-inputs\write-from-source-dry-run.json'
```

## MCP Mode

The MCP config is in `.mcp.json`. This copy is not installed into a marketplace yet.

## Verification Rule

For data correctness, prefer ShareDB snapshot verification. Screenshots are diagnostic and
presentation evidence only.
