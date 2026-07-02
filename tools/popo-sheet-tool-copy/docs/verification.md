# Verification Log

This file records live validation for the isolated POPO Sheet tool copy.

## Expected Live Test Target

- POPO document: `https://docs.popo.netease.com/lingxi/d716742ef3ca4dca90855a302d97ba2f?tab=4`
- Sheet id: `0`
- Name column internal id: `3`
- BRF column internal id: `403791563974998`
- Known rows:
  - `我杀猪了` should map to row id `107`, visual row `32`
  - `糖醋里脊本脊` should map to row id `710553112252531`, visual row `34`

## Verification Status

Validated on 2026-07-02 with bundled Node.js `v24.14.0`.

### Static / Local

- `node --check mcp/server.cjs`: passed.
- `node mcp/server.cjs --list-tools`: returned 6 tools.
- MCP stdio smoke test:
  - `initialize`: returned server info `popo-sheet-tool-copy@0.1.0`.
  - `tools/list`: returned all 6 tool schemas, including `popo_write_from_source_file`.

### Live WebBridge / POPO

Using session `popo-brf-repair` against the open POPO document:

- `popo_resolve_by_name`
  - resolved `我杀猪了` to row id `107`, address `I32`.
  - resolved `糖醋里脊本脊` to row id `710553112252531`, address `I34`.
  - read BRF cell values from ShareDB snapshot without scrolling.
- `popo_probe_write_channel`
  - sent an empty ShareDB op.
  - server ACK returned `a:"op"` and no error.
  - no data value was changed.
- `popo_write_by_name` dry run
  - generated a plan for both BRF links.
  - `opCount: 0` because both target values already matched.
- `popo_write_by_name` non-dry-run unchanged verification
  - mode: `unchanged`.
  - `versionBefore` equals `versionAfter`.
  - fresh snapshot verification returned both fields `"0"` and `"1"` as correct for both rows.
- `popo_write_from_source_file` dry run
  - read `test-inputs/brf-source.tsv`.
  - source row count: `2`.
  - edit count: `2`.
  - generated the same I32/I34 plan through the batch file path.
- `popo_screenshot_checkpoint`
  - accepted the returned WebBridge temp screenshot path.
  - copied it to `artifacts/live-screenshot/checkpoint.png`.

### Artifact Folders

- `artifacts/live-resolve`
- `artifacts/live-probe`
- `artifacts/live-dry-run`
- `artifacts/live-unchanged-verify`
- `artifacts/live-source-dry-run`
- `artifacts/live-screenshot`

### Important Boundaries

- This validation avoids repeated scroll screenshots. Data correctness is verified structurally.
- The write channel was probed with an empty op to avoid unnecessary data mutation.
- Actual changed-value write behavior was previously validated manually in the same POPO document;
  this isolated tool copy verified its own matching, planning, no-op safety, and fresh snapshot
  verification path.
