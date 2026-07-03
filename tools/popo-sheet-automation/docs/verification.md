# Verification Log

This file records live validation for the POPO Sheet Automation tool.

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
- `node mcp/server.cjs --list-tools`: returned 7 tools after adding `popo_apply_basic_format`.
- MCP stdio smoke test:
  - `initialize`: returned server info `popo-sheet-automation@0.1.0`.
  - `tools/list`: returned all 7 tool schemas, including `popo_apply_basic_format`.

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

### Live Formatting Experiment

Using session `popo-format-experiment` against:

- POPO document: `https://docs.popo.netease.com/lingxi/caaec78ed44a411da780aa85599e7495?tab=7`
- Sheet title: `艺人执行`
- Sheet id: `1768116030219172`
- Test range: `D4:F6`

Validated on 2026-07-02:

- `popo_get_snapshot_summary` with a URL now waits for the `office.netease.com` iframe and succeeds
  after navigation.
- `popo_get_snapshot_summary` identified workbook `tabs` as a sheet-id list and found sheet title
  metadata under `sheets[sheetId].title`.
- ShareDB formatting op successfully wrote:
  - row heights for rows 4-6,
  - column widths for columns D-F,
  - `spans["3,3"] = [1,3]` for merged `D4:F4`,
  - cell text and existing style ids in `D4:F6`.
- First merge attempt failed because `spans` did not exist on the empty sheet:
  `Referenced element not an object (it was undefined)`.
  The correct behavior is to create the parent `spans` object when missing.
- Successful write moved version `3824 -> 3825`.
- Fresh snapshot verification returned true for row heights, column widths, span, and cell style ids.
- Screenshot before/after confirmed rendered row height, column width, fills, font colors, wrapping,
  and after reload, merged-cell rendering.
- New `popo_apply_basic_format` dry run against the already-formatted range returned `opCount: 0`.
- New `popo_apply_basic_format` non-dry-run verification returned:
  - `mode: unchanged`,
  - `versionBefore: 3825`,
  - `versionAfter: 3825`,
  - row, column, span, and cell verification all true.

Formatting artifacts:

- `artifacts/format-experiment/screenshot-before/artist-exec-before.png`
- `artifacts/format-experiment/screenshot-after/artist-exec-after.png`
- `artifacts/format-experiment/screenshot-after-reload/artist-exec-after-reload.png`

### Live Format Clone Experiment

Using session `popo-openwhite-format` against the same POPO document:

- Sheet title: `开白信息`
- Sheet id: `1766654945698891`
- Reference format: existing `A:G` account-information table
- Test range: `I1:O8`

Validated on 2026-07-02:

- `popo_get_snapshot_summary` read the sheet format contract:
  - `rowHeights` mostly `26`,
  - `colWidths` for A-G such as `150`, `266`, `116`, `100`, `155`, `115`, `100`,
  - vertical merge spans in the role column,
  - header/data style ids such as `737`, `543`, `745`, `743`, `738`, `196`, and `18`.
- Target range `I1:O8` was verified empty before writing.
- `popo_apply_basic_format` dry run generated:
  - `opCount: 64`,
  - 7 column-width changes,
  - 2 vertical merge spans,
  - 56 cell/style writes.
- Real write moved version `3825 -> 3826`.
- Fresh snapshot verification returned true for row heights, column widths, spans, and all 56 cells.
- Screenshot confirmed the cloned block renders like the reference table: gray contact columns, white
  applicant column, green merged role column, yellow login/password/account-type columns, and
  repeated simulated account rows.

This validates the agent can infer and reproduce a local POPO format contract instead of only
applying hand-picked colors.

### Artifact Folders

- `artifacts/live-resolve`
- `artifacts/live-probe`
- `artifacts/live-dry-run`
- `artifacts/live-unchanged-verify`
- `artifacts/live-source-dry-run`
- `artifacts/live-screenshot`
- `artifacts/format-experiment`
- `artifacts/openwhite-format`

### Important Boundaries

- This validation avoids repeated scroll screenshots. Data correctness is verified structurally.
- The write channel was probed with an empty op to avoid unnecessary data mutation.
- Actual changed-value write behavior was previously validated manually in the same POPO document;
  this POPO Sheet Automation tool verified its own matching, planning, no-op safety, and fresh snapshot
  verification path.
