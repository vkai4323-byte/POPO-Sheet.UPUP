# POPO Sheet Reference

## Table Of Contents

- Site Structure
- Addressing Internals
- Format Inference Checklist
- Name-Matched Bulk Fill
- Menu Evidence From Live POPO Sheet
- Hyperlinks
- In-Place Edit Mode
- Pixel Click Conversion
- Side Effects And Limits
- Bundled Script Contract
- Engine API Investigation

## Site Structure

- Top frame: `https://docs.popo.netease.com/...`
- Sheet iframe: `office.netease.com`, rendered on `<canvas>`
- Top-frame `evaluate` cannot read cell DOM or iframe internals because of cross-origin restrictions.
- Cell content can be read structurally through clipboard TSV when grid actions implement select +
  `Ctrl+C`.

## Addressing Internals

There is no reliable O(1) name-box addressing exposed through WebBridge. The reliable path is:

1. Focus the grid from the far-left row-number gutter, not a data cell.
2. `Control+Home` to A1.
3. Arrow-step to the anchor and extend the selection.

This is why far ranges are slower and why row/column header operations should target headers/gutters.

## Format Inference Checklist

Before supplementing a sheet, inspect the local format contract from nearby completed rows:

- Header labels and target column meanings.
- Completed rows above the target region.
- Row height and wrap behavior.
- Hyperlink style: raw URL vs `HYPERLINK` formula.
- Borders and fill colors.
- Horizontal/vertical alignment.
- Dropdown/tag chips.
- Date, time, percentage, and number formats.
- Blank-cell policy.

Prefer the closest completed row in the same section. Ask only when two plausible styles would change
business meaning or cause destructive edits.

Header inference is the agent's responsibility. Do not ask the user to type exact header names when
headers are visible, copied, or inferable from common aliases. If the copied region lacks headers,
request a wider copy that includes the header row or inspect a screenshot/nearby completed rows.

## Name-Matched Bulk Fill

This is the preferred path for tasks like "fill fan count and homepage behind the corresponding
talent" where a source file and the live POPO sheet both contain names.

### Failure Pattern To Avoid

A slow or incorrect run usually comes from one of these mistakes:

- Using the source file's row numbers as POPO row numbers. POPO may have inserted rows, hidden rows,
  section rows, filters, or a different sort order.
- Clicking fixed coordinates row by row. Long links can wrap, row height can change, the viewport can
  auto-scroll, and canvas virtualization can shift the visible grid.
- Pasting after clipboard permission was denied. The action may no-op or paste stale clipboard data.
- Continuing after a protected-cell warning. Some cells or ranges may be editable while adjacent
  cells are protected.

### Robust Procedure

1. Parse the source file into records keyed by visible talent/name. For duplicate names, keep all
   candidates and require another column or user confirmation before writing.
2. Copy the live POPO region that contains the talent/name column and the target columns. Parse this
   copied TSV as the authoritative row order. If automation cannot copy from POPO, ask the user to
   copy the visible block, not to type column names.
3. Identify target columns by header text, aliases, screenshots, and nearby completed rows. For
   example, `粉丝量(w)`/`粉丝数`, `主页链接`/`主页`, `刊例价`/`报价`, and
   `平台价截图`/`报价截图` should be treated as aliases unless local evidence says otherwise.
4. Run `scripts/name_match_tsv.py` when both source data and copied POPO TSV are available as local
   files. The script builds the planned output block from the copied POPO rows:
   - matched rows get source values,
   - unmatched rows keep their current target values,
   - duplicate/conflict rows keep their current target values,
   - protected rows keep their current target values and are skipped.
5. 🔴 CHECKPOINT: inspect `match_report.tsv` before writing. Do not paste when duplicate names,
   unexpected source-only names, or missing source rows would change business meaning.
6. Paste a full rectangular TSV only into the target columns for a contiguous editable block. This
   preserves row alignment and avoids per-cell coordinate drift.
7. Immediately copy the same target range back and compare actual values with the planned values.
   🛑 STOP if any row differs, undo if appropriate, and diagnose before another write.

### Clipboard Permission Preflight

Before UI paste fallback, verify clipboard permission with a harmless sentinel:

1. Run a browser-side clipboard write such as `__popo_clipboard_probe__`.
2. Read it back or paste it into a non-sheet scratch target if direct read is unavailable.
3. If the browser denies clipboard access, ask the user to allow clipboard permission and do not
   start data-changing paste operations yet.

### Match Report Minimum

Before writing, produce or internally inspect a compact report with:

- total POPO rows copied,
- total source records,
- exact/normalized matches,
- duplicate conflicts,
- POPO names missing from source,
- source names not present in POPO,
- planned paste blocks and skipped protected/read-only blocks.

For high-volume fills, save this report as a temporary artifact or print it in the tool log so the
operator can catch obvious mismatches before paste.

## Menu Evidence From Live POPO Sheet

### Row Header

Validated row-height path:

1. Select rows from left row-number gutter.
2. Right-click selected gutter.
3. Choose `设置行高`.
4. Enter height.
5. Confirm and screenshot-check.

Live validation: rows 2-11 were set to `60`; row 1 stayed unchanged.

Failure signatures:

- No `设置行高`: clicked normal cells instead of row gutter.
- Height still wrong: selection missed rows or wrap state affected display.
- Writes no-op: likely read-only duplicate tab.

### Column Header

Observed column-header right-click menu:

- `复制`
- `剪切`
- `全部粘贴`
- `选择性粘贴`
- `清除`
- `隐藏列`
- `向左插入 <n> 列`
- `向右插入 <n> 列`
- `删除第<n>列`
- `设置列宽`

### Ordinary Cell Context Menu

Observed on a normal non-link cell:

- `复制`
- `复制为图片`
- `复制定位链接`
- `剪切`
- `全部粘贴`
- `选择性粘贴`
- `清除`
- `富文本编辑`
- `隐藏行`
- `隐藏列`
- `插入单元格`
- `删除单元格`
- `添加评论`

Do not use ordinary-cell clicks to select hyperlink cells unless explicitly opening a link.

### Border Dropdown

Observed toolbar border dropdown includes:

- Multiple border-position icons for side/inside/all/none style operations.
- Border line style dropdown.
- Border color dropdown.

Use screenshots to distinguish explicit borders from default gridlines.

### Quick Fill

Observed toolbar quick-fill dropdown:

- `智能填充`
- `序列填充`

These can alter data; require explicit user intent and before/after verification.

### Sheet Tab Menu

Observed bottom sheet-tab context menu:

- `插入`
- `删除`
- `隐藏工作表`
- `创建副本`
- `创建为独立表格`

Delete/export/share-style operations require explicit confirmation.

## Hyperlinks

Grid actions never click data cells, so they do not open links. To check/open a link only when the
user asks:

1. Read link text/formula first.
2. Select the link cell.
3. Click once intentionally.
4. Inspect opened page/tab.
5. Return to the sheet tab.

## In-Place Edit Mode

Overwrite with `sheet_fill` when possible. To edit inside an existing cell:

1. Select cell.
2. Double-click to enter edit mode.
3. `Control+A`.
4. Paste/type replacement.
5. `Enter` to commit or `Escape` to cancel.

## Pixel Click Conversion

If using screenshot coordinates:

1. Get `innerWidth` from `evaluate`.
2. Compute `scale = innerWidth / screenshotWidth`.
3. Convert screenshot coordinates to CSS coordinates.

Prefer keyboard/header selection over blind pixel clicks.

## Side Effects And Limits

- Clipboard-backed actions temporarily modify the OS clipboard; robust wrappers should restore it.
- Values containing tab/newline can split TSV blocks and misalign paste.
- Visual formatting needs screenshot verification; `sheet_read` verifies only content.

## Bundled Script Contract

Use `scripts/name_match_tsv.py` to remove repeated ad hoc matching logic.

Required inputs:

- `--source`: Markdown table, TSV, or CSV source file.
- `--popo`: TSV copied from POPO with one header row.
- `--target-cols`: comma-separated POPO target column headers, only when exact targets are known.
- `--out-paste`: paste TSV path.
- `--out-report`: match report TSV path.

Optional inputs:

- `--name-col`: shared name column header.
- `--source-name-col` and `--popo-name-col`: separate name headers when the two files differ.
- `--preset talent-basic`: auto-detect common talent columns such as name, fans, homepage, rate, and
  rate screenshot. Use this before asking the user for header names.
- `--source-map`: comma-separated `POPO_COL=SOURCE_COL` overrides when target column names differ.

Outputs:

- `paste.tsv`: target columns only, one row per copied POPO data row, no header row. Select the same
  target columns in POPO data rows before pasting.
- `match_report.tsv`: row-level statuses: `matched`, `missing_source`, `duplicate_source`,
  `duplicate_popo`, and `source_only`.

🛑 STOP conditions:

- Any `duplicate_source` or `duplicate_popo` row affects a row the user expects to fill.
- `missing_source` appears for names that should be present.
- `source_only` contains names the user expected to appear in the POPO section.
- The copied POPO TSV does not include the target headers.

## Engine API Investigation

Direct engine access is currently blocked through Kimi WebBridge:

- The real grid engine runs in the `office.netease.com` child iframe.
- Cross-frame JS access throws `SecurityError`.
- WebBridge `evaluate` runs in the top frame only.
- CDP target/frame access is restricted.
- Loading the office iframe URL standalone renders blank.

Production path remains grid actions plus verified UI recipes unless the transport gains frame-targeted
execution or a stable POPO postMessage/API path.
