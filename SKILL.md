---
name: popo-sheet
description: Operate NetEase POPO / office.netease.com online spreadsheets (docs.popo.netease.com) through a real-browser Kimi WebBridge session. Use for POPO sheet URLs, canvas-rendered grids with no DOM cells, reading cell values, name-matched bulk fills, single-cell edits, range fills, formulas, hyperlinks, row height, column width, borders, wrap, layout formatting, sheet tabs, and safe UI operations that need the user's logged-in browser.
---

# POPO Sheet via Kimi WebBridge

Use this skill for NetEase POPO online spreadsheets in the user's real browser. POPO grids are
canvas-rendered inside a cross-origin `office.netease.com` iframe, so normal DOM cell selectors do
not work. Prefer dedicated sheet actions when available; otherwise focus the office iframe and use
verified keyboard/clipboard fallback paths.

## Core Rules

1. For reading values, prefer the ShareDB snapshot path when WebBridge can evaluate the POPO top
   frame and fetch the office iframe HTML. Use grid actions next, then clipboard/UI fallback.
2. If a tool returns `Unknown tool`, stop retrying it and switch to the UI fallback path.
3. Never click hyperlink cells as a side effect. Use read/copy actions for link text; click links
   only when the user explicitly asks to open/check one.
4. Read before writing. Map columns from headers and nearby completed rows, not screenshots alone.
5. Match the existing sheet format by default: hyperlink style, row height, borders, wrap, alignment,
   dropdown/tag style, number/date format, fill color, and blank-cell policy.
6. Treat completion as data plus presentation. Verify values with read-back when possible and verify
   visual formatting with screenshots.
7. Use only one editable POPO tab. If a duplicate tab is read-only (`只读`) and writes no-op, return
   to the tab holding the edit lock.
8. For row-specific data joins, never trust external row numbers. Treat the POPO sheet's copied
   talent/name column as the source of truth, match by normalized name, then write values next to the
   matched in-sheet row.
9. Stop immediately on protected/read-only warnings such as `您尝试改变的单元格是被保护的，因此是只读的`.
   Re-read the affected range and split future writes around protected rows or columns.
10. For name-matched bulk fills, use `scripts/name_match_tsv.py` after copying the POPO target block
    whenever source data and copied POPO TSV are available as local files.
11. Do not ask the user to provide exact header names that are visible or copyable. Infer headers
    from copied TSV, screenshots, nearby completed rows, source-file columns, and common aliases. Ask
    the user for a wider copy or a business choice only after inference fails or multiple meanings
    would change the filled result.
12. Do not assume the cross-origin canvas iframe is uncontrollable. First focus the `office.netease.com`
    iframe, then verify single-key movement with CDP keyboard events. If CDP can move/select cells
    but `Ctrl+C` leaves the OS clipboard empty, escalate to OS-level keyboard input (`computer-use`,
    visible browser focus, or Windows SendKeys) before asking the user to copy manually.
13. Treat OS-level copy as unverified until the agent proves it created the selection itself. If the
    user is also working in POPO, do not use OS clipboard results as evidence unless a before/after
    screenshot proves the selected range.
14. After every data fill or write, proactively check formatting without waiting for the user to ask.
    Compare target row heights, column widths, wraps, merges, alignment, fills, font colors, borders,
    and style ids against nearby reference rows/columns; fix safe differences and screenshot the
    final rendered result when presentation matters.

## Default Workflow

Use this flow for filling, supplementing, cleaning, or formatting a POPO sheet:

1. **Orient:** open/reuse the POPO URL, confirm active sheet/tab, visible rows, editable state, and
   whether there is a header or section row.
2. **Read via snapshot if possible:** use the ShareDB snapshot path from
   `references/popo-sheet-reference.md` to fetch workbook JSON and extract rows/columns directly.
3. **Focus and verify control:** focus the office iframe, send one harmless arrow key, and verify the
   active cell moves before trying range selection.
4. **Read context:** inspect/read the header row and nearby completed rows; build a column map.
5. **Infer format:** decide how target columns should look: raw text vs formula, hyperlink formula
   vs URL, dropdown/tag cells, row height, borders, wrap, alignment, color, date/number format, and
   whether blanks should remain blank.
6. **Plan exact target range:** confirm row/column anchors before modifying.
7. **Fill values:** use `sheet_fill`/bulk paste when available; keep row order aligned.
8. **Verify values:** use `verify:true`/`sheet_read` when available.
9. **Match formatting:** apply inferred row height, column width, borders, wrap, alignment, and link
   style without waiting for a separate user reminder.
10. **Format self-check:** compare the target range against the nearest relevant reference format.
    If simple differences are safe to fix, apply them before reporting completion; ask only when the
    formatting choice would change business meaning or risk destructive edits.
11. **Final check:** screenshot the edited region and compare with nearby completed rows. Report data
   filled, format matched, and any uncertainty.

Ask only when two plausible interpretations would change business meaning or cause hard-to-reverse
edits.

## Available/Target Actions

Different WebBridge wrappers expose different actions. Use the available action if present; otherwise
use the fallback recipe.

| Intent | Preferred action | Fallback |
|---|---|---|
| read range | ShareDB snapshot workbook JSON | `sheet_read`, then CDP/OS copy TSV |
| fill values | `sheet_fill range:"D10" values:[[...]] verify:true` | set OS clipboard + OS-level `Ctrl+V` |
| select cell/range | `sheet_goto range:"D10"` | keyboard addressing from A1 |
| focus grid | `sheet_goto` or grid action focus | focus `document.querySelector('iframe').contentWindow.focus()` then CDP key test |
| select rows | `sheet_select_rows rows:"2:11"` | drag/select left row-number gutter |
| select columns | `sheet_select_columns columns:"J:J"` | click/drag column-letter header |
| set row height | `sheet_set_row_height rows:"2:11" height:60` | row gutter right-click -> `设置行高` |
| set column width | `sheet_set_column_width columns:"J:J" width:160` | column header right-click -> `设置列宽` |
| apply borders | `sheet_apply_borders range:"A1:Q11" sides:"all"` | toolbar border dropdown |
| set wrap | `sheet_set_wrap range:"H2:H11" enabled:false` | toolbar/menu wrap control |

## Name-Matched Bulk Fill

Use this low-freedom workflow when filling values such as fan counts, homepages, IDs, notes, or
status fields "after the corresponding talent/name":

1. **Acquire the real POPO target block first.** Use available sheet, browser, CDP, or OS-level
   controls to copy one header row plus the in-sheet name column and the columns to fill. If CDP
   navigation works but clipboard length is `0`, switch to OS-level `Ctrl+C` before asking the user.
   Ask the user to copy a wider visible block only after automated copy paths fail; do not ask them
   to type the header names manually.
2. **Infer columns, then generate paste data and a report.** Run `scripts/name_match_tsv.py` with the
   source file and copied POPO TSV. Use `--preset talent-basic` for达人/粉丝/主页/刊例价/截图 style
   jobs unless the task names a narrower target. The script outputs a target-column TSV for paste and
   a match report.
3. **🔴 CHECKPOINT - inspect before writing.** Stop before paste if the report contains duplicate
   source names, duplicate POPO names, missing source rows that should be filled, or unexpected
   source-only names. Ask the user when those conflicts affect business meaning.
4. **Paste TSV by contiguous editable blocks.** Select only the target columns for the same POPO rows
   used to build the paste TSV. Preserve unmatched/conflict rows by pasting their current values from
   the copied POPO TSV. Avoid per-cell coordinate loops.
5. **🛑 STOP on write failure.** If clipboard permission fails, pasted values shift, a protected-cell
   toast appears, or the active sheet becomes read-only, stop immediately. Re-copy the affected range
   before attempting another write.
6. **Verify by copy-back.** After each paste, copy the same POPO range back to TSV and compare the
   actual values against the planned values. Screenshot only after data verification passes.

Script pattern:

```bash
python scripts/name_match_tsv.py \
  --source talent_data_for_popo.md \
  --popo copied_popo_block.tsv \
  --preset talent-basic \
  --out-paste paste.tsv \
  --out-report match_report.tsv
```

Hard anti-patterns for this workflow:

- Do not paste by external/reference row numbers.
- Do not keep clicking fixed Y coordinates after pasted links change row height or scroll position.
- Do not use screenshots as the only evidence for name matching.
- Do not continue writing after a protected-cell toast or clipboard-denied error.
- Do not ask the user "which header is X" when the header row can be copied, screenshotted, or
  inferred from common aliases.

## Common Recipes

- Read headers: `sheet_read range:"A1:T3"` and map header text to columns.
- Bulk fill: read header first, then `sheet_fill` from the top-left anchor with a 2D array and
  `verify:true`.
- Formula: fill a leading-`=` formula, e.g. `=SUM(D10:D20)`.
- Hyperlink: if nearby links are blue/clickable, use
  `=HYPERLINK("https://www.douyin.com/user/...", "主页")` or the local display convention. If nearby
  cells store raw URLs, keep raw URLs.
- Clipboard preflight: before UI paste fallback, confirm browser clipboard permission by writing and
  reading a harmless sentinel. If permission fails, ask the user to allow clipboard access before any
  data-changing operation.
- WebBridge request files on Windows: write JSON bodies as UTF-8 **without BOM** before calling
  `curl.exe`; a BOM can produce `invalid character 'ï' looking for beginning of value`.
- Keyboard selection: for `Shift`/`Ctrl` combinations, send modifier `keyDown`, then the normal key
  sequence, then modifier `keyUp`. Do not rely on `modifiers` bitmasks for POPO range selection.
- Clipboard escalation: if CDP `Ctrl+C` returns empty clipboard after a visible selection, use
  OS-level input (`computer-use`, focused browser window, or Windows SendKeys `^c`). For paste, place
  TSV into the OS clipboard first, then use OS-level `Ctrl+V`.
- Undo a mistake: use `Control+Z` immediately, then re-read/re-screenshot before retrying.

## Verified Formatting Paths

### Row Height

Use for "调整行高", "设置行距", "行高 60", or "和上面一样高".

1. Select target rows from the **left row-number gutter**, not normal cells.
2. Right-click the selected row-number gutter.
3. Choose `设置行高`.
4. Enter the requested height and confirm.
5. Screenshot-check target rows against nearby reference rows.

Validated live: rows 2-11 on sheet `执行` were set to height `60`; header row 1 stayed unchanged.

### Column Width

1. Select target column headers.
2. Right-click the column-letter header.
3. Choose `设置列宽`.
4. Enter width and confirm.
5. Screenshot-check neighboring columns.

### Borders / Wrap

Select the target range, use toolbar border/wrap controls, then screenshot-check. Visual formatting
cannot be verified by `sheet_read`.

## More Detail

For POPO internals, menu evidence, format inference checklist, keyboard/clipboard fallback,
name-matched bulk-fill failure modes, pixel-click conversion, in-place edit mode, side effects, and
blocked engine API notes, read
`references/popo-sheet-reference.md` only when needed.
