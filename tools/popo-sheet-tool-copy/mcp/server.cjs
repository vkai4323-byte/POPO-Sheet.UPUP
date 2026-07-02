#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const WEBBRIDGE_ENDPOINT = "http://127.0.0.1:10086/command";
const DEFAULT_ARTIFACT_DIR = path.resolve(process.cwd(), "artifacts");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function stableName(value) {
  return String(value || "value").replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 80);
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function readJsonArg(raw) {
  if (!raw) return {};
  if (raw.startsWith("@")) {
    return JSON.parse(fs.readFileSync(raw.slice(1), "utf8"));
  }
  return JSON.parse(raw);
}

function parseTableFile(sourcePath) {
  const text = fs.readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];

  if (lines[0].trim().startsWith("|")) {
    const rows = lines
      .map((line) => line.trim())
      .filter((line) => line.startsWith("|"))
      .map((line) => line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
    const header = rows[0] || [];
    const dataRows = rows.slice(1).filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)));
    return dataRows.map((row) => Object.fromEntries(header.map((name, idx) => [name, row[idx] || ""])));
  }

  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const splitLine = (line) => {
    if (delimiter === "\t") return line.split("\t");
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cells.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cells.push(current);
    return cells;
  };
  const header = splitLine(lines[0]).map((cell) => cell.trim());
  return lines.slice(1).map((line) => {
    const cells = splitLine(line);
    return Object.fromEntries(header.map((name, idx) => [name, (cells[idx] || "").trim()]));
  });
}

function buildEditsFromSourceFile(input) {
  const sourcePath = path.resolve(input.sourcePath);
  const rows = parseTableFile(sourcePath);
  const nameColumn = input.sourceNameColumn;
  const valueColumn = input.sourceValueColumn;
  if (!nameColumn || !valueColumn) throw new Error("sourceNameColumn and sourceValueColumn are required");
  const edits = rows
    .map((row, index) => ({
      name: row[nameColumn],
      value: row[valueColumn],
      sourceRow: index + 2,
    }))
    .filter((edit) => edit.name && (input.includeBlankValues || edit.value));
  return { sourcePath, sourceRowCount: rows.length, edits };
}

async function callWebBridge(action, args = {}, options = {}) {
  const session = options.session || args.session || "popo-sheet-tool";
  const artifactDir = path.resolve(options.artifactDir || args.artifactDir || DEFAULT_ARTIFACT_DIR);
  const body = { action, args, session };
  const response = await fetch(WEBBRIDGE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    data = { ok: false, parseError: error.message, raw: text };
  }

  const responsePath = path.join(artifactDir, `${timestamp()}-${stableName(action)}.response.json`);
  writeJson(responsePath, data);
  return { data, responsePath };
}

async function maybeNavigate(input) {
  if (input.skipNavigate || !input.url) return null;
  return await callWebBridge(
    "navigate",
    {
      url: input.url,
      newTab: Boolean(input.newTab),
      group_title: input.groupTitle || "POPO Sheet Tool",
    },
    input
  );
}

function makeWaitForOfficeIframeScript(timeoutMs) {
  return `
(async () => {
  const timeoutMs = ${Number(timeoutMs) || 10000};
  const deadline = Date.now() + timeoutMs;

  function iframeSummary() {
    return Array.from(document.querySelectorAll("iframe")).map((iframe, index) => ({
      index,
      src: iframe.src || "",
      title: iframe.title || "",
      width: iframe.clientWidth,
      height: iframe.clientHeight,
    }));
  }

  function findOfficeIframe() {
    const frames = iframeSummary();
    return frames.find((frame) => frame.src.includes("office.netease.com") && frame.src.includes("identity=")) ||
      frames.find((frame) => frame.src.includes("office.netease.com")) ||
      frames.find((frame) => frame.src.includes("identity="));
  }

  while (Date.now() < deadline) {
    const match = findOfficeIframe();
    if (match) {
      return JSON.stringify({ ok: true, url: location.href, iframe: match, iframeCount: iframeSummary().length });
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return JSON.stringify({ ok: false, url: location.href, iframeCount: iframeSummary().length, iframes: iframeSummary() });
})()
`;
}

async function waitForOfficeIframe(input) {
  const call = await callWebBridge(
    "evaluate",
    { code: makeWaitForOfficeIframeScript(input.iframeTimeoutMs || 10000) },
    input
  );
  const parsed = parseEvaluateString(call.data);
  parsed.artifacts = parsed.artifacts || {};
  parsed.artifacts.iframeWaitResponsePath = call.responsePath;
  if (!parsed.ok) {
    throw new Error(`No POPO office iframe found after wait: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

function parseEvaluateString(response) {
  if (!response || !response.ok) {
    throw new Error(`WebBridge command failed: ${JSON.stringify(response)}`);
  }
  const value = response.data && response.data.value;
  if (typeof value !== "string") {
    throw new Error(`Expected evaluate string result, got: ${JSON.stringify(response.data)}`);
  }
  return JSON.parse(value);
}

function makeSnapshotScript(options) {
  return `
(async () => {
  const options = ${JSON.stringify(options)};

  function colLetters(indexOneBased) {
    let n = indexOneBased;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  async function fetchSnapshot() {
    function findOfficeIframe() {
      const frames = Array.from(document.querySelectorAll("iframe")).map((iframe, index) => ({
        iframe,
        index,
        src: iframe.src || "",
        title: iframe.title || "",
      }));
      const match = frames.find((frame) => frame.src.includes("office.netease.com") && frame.src.includes("identity=")) ||
        frames.find((frame) => frame.src.includes("office.netease.com")) ||
        frames.find((frame) => frame.src.includes("identity="));
      if (!match) {
        throw new Error("No POPO office iframe found: " + JSON.stringify({
          url: location.href,
          iframeCount: frames.length,
          iframes: frames.map((frame) => ({ index: frame.index, src: frame.src, title: frame.title })),
        }));
      }
      return match.iframe;
    }

    const iframe = findOfficeIframe();
    const iframeUrl = new URL(iframe.src);
    const identity = iframeUrl.searchParams.get("identity");
    const source = iframeUrl.searchParams.get("from") || "POPO_DOC";
    const lang = iframeUrl.searchParams.get("popo_locale") || "zh-CN";
    const wsUrl = iframeUrl.origin.replace("https", "wss") + "/node/?" +
      new URLSearchParams({
        identity,
        serverType: "GEZHI",
        source,
        wantCompress: "false",
        lang,
      });

    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("snapshot timeout")), options.timeoutMs || 15000);
      let begin = null;
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.begin) {
          begin = msg;
          ws.send(JSON.stringify({ a: "f", c: msg.collectionID, d: msg.docID }));
        } else if (msg.a === "f") {
          clearTimeout(timer);
          ws.close();
          resolve({ begin, fetch: msg, wsUrl });
        }
      };
      ws.onerror = () => reject(new Error("snapshot websocket error"));
    });
  }

  function compactCell(cell) {
    if (!cell) return null;
    const out = {};
    for (const key of Object.keys(cell).sort()) {
      if (Object.prototype.hasOwnProperty.call(cell, key)) out[key] = cell[key];
    }
    return out;
  }

  function summarizeTabs(tabs) {
    if (Array.isArray(tabs)) {
      return tabs.map((tab, index) => ({
        index,
        id: String(tab.id ?? tab.sheetId ?? tab.name ?? index),
        sheetId: String(tab.sheetId ?? tab.id ?? index),
        name: String(tab.name ?? tab.title ?? tab.text ?? ""),
        rawKeys: Object.keys(tab || {}).sort(),
        rawPreview: Array.isArray(tab) ? tab.slice(0, 18) : Object.fromEntries(Object.entries(tab || {}).slice(0, 18)),
      }));
    }
    if (tabs && typeof tabs === "object") {
      return Object.entries(tabs).map(([id, tab]) => ({
        id: String(id),
        sheetId: String(tab.sheetId ?? tab.id ?? id),
        name: String(tab.name ?? tab.title ?? tab.text ?? ""),
        rawKeys: Object.keys(tab || {}).sort(),
        rawPreview: Array.isArray(tab) ? tab.slice(0, 18) : Object.fromEntries(Object.entries(tab || {}).slice(0, 18)),
      }));
    }
    return [];
  }

  function summarizeSheetMeta(sheets) {
    return Object.fromEntries(Object.entries(sheets || {}).map(([id, sheet]) => {
      const meta = {};
      for (const [key, value] of Object.entries(sheet || {})) {
        if (["cells", "rows", "cols"].includes(key)) continue;
        if (value && typeof value === "object") {
          meta[key] = Array.isArray(value)
            ? value.slice(0, 20)
            : Object.fromEntries(Object.entries(value).slice(0, 20));
        } else {
          meta[key] = value;
        }
      }
      return [String(id), {
        keys: Object.keys(sheet || {}).sort(),
        name: String(sheet?.name ?? sheet?.title ?? sheet?.text ?? sheet?.["0"] ?? ""),
        meta,
      }];
    }));
  }

  function summarizeStyleRoots(workbook, styleIds) {
    const out = {};
    const selectedStyleIds = (styleIds || []).map(Number).filter((id) => Number.isFinite(id));
    for (const [key, value] of Object.entries(workbook || {})) {
      if (!/style|format|theme|color|font|border|fill/i.test(key)) continue;
      if (key === "styles" && value && typeof value === "object") {
        const list = Array.isArray(value.list) ? value.list : [];
        out[key] = {
          type: "object",
          keys: Object.keys(value).sort(),
          listCount: list.length,
          first: list.slice(0, 12),
          selected: Object.fromEntries(selectedStyleIds.map((id) => [String(id), list[id] || null])),
        };
        continue;
      }
      if (value && typeof value === "object") {
        out[key] = {
          type: Array.isArray(value) ? "array" : "object",
          count: Array.isArray(value) ? value.length : Object.keys(value).length,
          sample: Array.isArray(value)
            ? value.slice(0, 20)
            : Object.fromEntries(Object.entries(value).slice(0, 20)),
        };
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  const got = await fetchSnapshot();
  const workbook = got.fetch.data.data;
  const version = got.fetch.data.v;
  const sheetId = String(options.sheetId || "0");
  const sheet = workbook.sheets[sheetId];
  if (!sheet) throw new Error("Sheet not found: " + sheetId);

  const rows = sheet.rows || [];
  const cols = sheet.cols || [];
  const cells = sheet.cells || {};
  const targetColIds = (options.targetColIds || []).map(String);
  const requestedNames = (options.names || []).map(String);
  const nameColId = String(options.nameColId || "3");
  const includeRows = options.rows || [];

  const found = [];
  if (requestedNames.length) {
    const wanted = new Set(requestedNames);
    for (let i = 0; i < rows.length; i++) {
      const rowId = String(rows[i]);
      const nameCell = cells[rowId + "," + nameColId];
      const name = nameCell && nameCell["0"];
      if (wanted.has(String(name))) {
        const entry = {
          name,
          rowId,
          visualRow: i + 1,
          nameCell: compactCell(nameCell),
          targets: {},
        };
        for (const colId of targetColIds) {
          const visualCol = cols.findIndex((x) => String(x) === colId) + 1;
          entry.targets[colId] = {
            colId,
            visualCol,
            address: visualCol > 0 ? colLetters(visualCol) + String(i + 1) : null,
            cell: compactCell(cells[rowId + "," + colId]),
          };
        }
        found.push(entry);
      }
    }
  }

  const rowSummaries = includeRows.map((visualRow) => {
    const rowId = String(rows[Number(visualRow) - 1]);
    const obj = { visualRow, rowId, cells: {} };
    for (const colId of [nameColId, ...targetColIds]) {
      obj.cells[colId] = compactCell(cells[rowId + "," + colId]);
    }
    return obj;
  });

  const sampleRowNumbers = Array.isArray(options.sampleRows)
    ? options.sampleRows.map(Number)
    : Array.from({ length: Number(options.sampleRows || 0) }, (_, idx) => idx + 1);
  const sampleColIds = (options.sampleColIds || cols.slice(0, Number(options.sampleCols || 0))).map(String);
  const sampleGrid = sampleRowNumbers.map((visualRow) => {
    const rowId = String(rows[Number(visualRow) - 1]);
    const obj = { visualRow, rowId, cells: {} };
    for (const colId of sampleColIds) {
      const visualCol = cols.findIndex((x) => String(x) === colId) + 1;
      obj.cells[colId] = {
        visualCol,
        address: visualCol > 0 ? colLetters(visualCol) + String(visualRow) : null,
        cell: compactCell(cells[rowId + "," + colId]),
      };
    }
    return obj;
  });

  return JSON.stringify({
    version,
    collectionID: got.begin.collectionID,
    docID: got.begin.docID,
    clientID: got.begin.clientID,
    sheetId,
    rootKeys: Object.keys(workbook || {}).sort(),
    styleRoots: options.includeStyleRoots ? summarizeStyleRoots(workbook, options.styleIds) : null,
    tabs: summarizeTabs(workbook.tabs),
    sheetKeys: Object.keys(workbook.sheets || {}),
    sheetMeta: summarizeSheetMeta(workbook.sheets || {}),
    rowCount: rows.length,
    colCount: cols.length,
    cols: cols.slice(0, options.maxCols || 30).map((id, idx) => ({
      colId: String(id),
      visualCol: idx + 1,
      letter: colLetters(idx + 1),
    })),
    found,
    rowSummaries,
    sampleGrid,
  });
})()
`;
}

function makeWriteByNameScript(input) {
  return `
(async () => {
  const input = ${JSON.stringify(input)};

  function colLetters(indexOneBased) {
    let n = indexOneBased;
    let s = "";
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function compactCell(cell) {
    if (!cell) return null;
    const out = {};
    for (const key of ["0", "1", "100", "101"]) {
      if (Object.prototype.hasOwnProperty.call(cell, key)) out[key] = cell[key];
    }
    return out;
  }

  function makeWsUrl() {
    function findOfficeIframe() {
      const frames = Array.from(document.querySelectorAll("iframe")).map((iframe, index) => ({
        iframe,
        index,
        src: iframe.src || "",
        title: iframe.title || "",
      }));
      const match = frames.find((frame) => frame.src.includes("office.netease.com") && frame.src.includes("identity=")) ||
        frames.find((frame) => frame.src.includes("office.netease.com")) ||
        frames.find((frame) => frame.src.includes("identity="));
      if (!match) {
        throw new Error("No POPO office iframe found: " + JSON.stringify({
          url: location.href,
          iframeCount: frames.length,
          iframes: frames.map((frame) => ({ index: frame.index, src: frame.src, title: frame.title })),
        }));
      }
      return match.iframe;
    }

    const iframe = findOfficeIframe();
    const iframeUrl = new URL(iframe.src);
    const identity = iframeUrl.searchParams.get("identity");
    const source = iframeUrl.searchParams.get("from") || "POPO_DOC";
    const lang = iframeUrl.searchParams.get("popo_locale") || "zh-CN";
    return iframeUrl.origin.replace("https", "wss") + "/node/?" +
      new URLSearchParams({
        identity,
        serverType: "GEZHI",
        source,
        wantCompress: "false",
        lang,
      });
  }

  async function fetchSnapshot() {
    const wsUrl = makeWsUrl();
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("snapshot timeout")), input.timeoutMs || 15000);
      let begin = null;
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.begin) {
          begin = msg;
          ws.send(JSON.stringify({ a: "f", c: msg.collectionID, d: msg.docID }));
        } else if (msg.a === "f") {
          clearTimeout(timer);
          ws.close();
          resolve({ begin, fetch: msg });
        }
      };
      ws.onerror = () => reject(new Error("snapshot websocket error"));
    });
  }

  async function submitOp(version, op) {
    const wsUrl = makeWsUrl();
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("op timeout")), input.timeoutMs || 15000);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.begin) {
          ws.send(JSON.stringify({
            a: "op",
            c: msg.collectionID,
            d: msg.docID,
            v: version,
            op,
            src: msg.clientID,
            seq: 1,
          }));
        } else if (msg.a === "op") {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      };
      ws.onerror = () => reject(new Error("op websocket error"));
    });
  }

  const sheetId = String(input.sheetId || "0");
  const nameColId = String(input.nameColId || "3");
  const targetColId = String(input.targetColId);
  const fields = input.fields || ["0", "1"];
  if (!targetColId) throw new Error("targetColId is required");
  if (!Array.isArray(input.edits) || !input.edits.length) throw new Error("edits are required");

  const before = await fetchSnapshot();
  const workbook = before.fetch.data.data;
  const version = before.fetch.data.v;
  const sheet = workbook.sheets[sheetId];
  if (!sheet) throw new Error("Sheet not found: " + sheetId);

  const rows = sheet.rows || [];
  const cols = sheet.cols || [];
  const cells = sheet.cells || {};
  const byName = new Map();
  for (let i = 0; i < rows.length; i++) {
    const rowId = String(rows[i]);
    const nameCell = cells[rowId + "," + nameColId];
    const name = nameCell && nameCell["0"];
    if (!name) continue;
    const key = String(name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push({ name, rowId, visualRow: i + 1 });
  }

  const visualCol = cols.findIndex((x) => String(x) === targetColId) + 1;
  const plan = [];
  const errors = [];
  const op = [];
  for (const edit of input.edits) {
    const matches = byName.get(String(edit.name)) || [];
    if (matches.length !== 1) {
      errors.push({ name: edit.name, status: matches.length ? "duplicate_name" : "missing_name", count: matches.length });
      continue;
    }
    const match = matches[0];
    const cellKey = match.rowId + "," + targetColId;
    const cell = cells[cellKey] || {};
    const item = {
      name: edit.name,
      rowId: match.rowId,
      visualRow: match.visualRow,
      visualCol,
      address: visualCol > 0 ? colLetters(visualCol) + String(match.visualRow) : null,
      before: compactCell(cell),
      value: edit.value,
      fields,
      changed: false,
    };
    for (const field of fields) {
      if (cell[field] !== edit.value) {
        item.changed = true;
        const part = { p: ["sheets", sheetId, "cells", cellKey, field], oi: edit.value };
        if (Object.prototype.hasOwnProperty.call(cell, field)) part.od = cell[field];
        op.push(part);
      }
    }
    plan.push(item);
  }

  if (errors.length) {
    return JSON.stringify({ ok: false, mode: "blocked", version, errors, plan });
  }

  if (input.dryRun) {
    return JSON.stringify({ ok: true, mode: "dryRun", version, opCount: op.length, plan });
  }

  let ack = null;
  if (op.length) {
    ack = await submitOp(version, op);
    if (ack.error) return JSON.stringify({ ok: false, mode: "opError", version, ack, plan });
  }

  const after = await fetchSnapshot();
  const afterCells = after.fetch.data.data.sheets[sheetId].cells || {};
  const verification = plan.map((item) => {
    const cell = afterCells[item.rowId + "," + targetColId] || {};
    const fieldResults = {};
    for (const field of fields) fieldResults[field] = cell[field] === item.value;
    return {
      name: item.name,
      rowId: item.rowId,
      address: item.address,
      value: item.value,
      after: compactCell(cell),
      ok: Object.values(fieldResults).every(Boolean),
      fields: fieldResults,
    };
  });

  return JSON.stringify({
    ok: verification.every((x) => x.ok),
    mode: op.length ? "written" : "unchanged",
    versionBefore: version,
    versionAfter: after.fetch.data.v,
    ack,
    opCount: op.length,
    plan,
    verification,
  });
})()
`;
}

function makeProbeWriteScript(input) {
  return `
(async () => {
  const input = ${JSON.stringify(input || {})};
  function makeWsUrl() {
    function findOfficeIframe() {
      const frames = Array.from(document.querySelectorAll("iframe")).map((iframe, index) => ({
        iframe,
        index,
        src: iframe.src || "",
        title: iframe.title || "",
      }));
      const match = frames.find((frame) => frame.src.includes("office.netease.com") && frame.src.includes("identity=")) ||
        frames.find((frame) => frame.src.includes("office.netease.com")) ||
        frames.find((frame) => frame.src.includes("identity="));
      if (!match) {
        throw new Error("No POPO office iframe found: " + JSON.stringify({
          url: location.href,
          iframeCount: frames.length,
          iframes: frames.map((frame) => ({ index: frame.index, src: frame.src, title: frame.title })),
        }));
      }
      return match.iframe;
    }

    const iframe = findOfficeIframe();
    const iframeUrl = new URL(iframe.src);
    const identity = iframeUrl.searchParams.get("identity");
    const source = iframeUrl.searchParams.get("from") || "POPO_DOC";
    const lang = iframeUrl.searchParams.get("popo_locale") || "zh-CN";
    return iframeUrl.origin.replace("https", "wss") + "/node/?" +
      new URLSearchParams({ identity, serverType: "GEZHI", source, wantCompress: "false", lang });
  }
  const wsUrl = makeWsUrl();
  const fetched = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error("fetch timeout")), input.timeoutMs || 15000);
    let begin = null;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.begin) { begin = msg; ws.send(JSON.stringify({ a: "f", c: msg.collectionID, d: msg.docID })); }
      else if (msg.a === "f") { clearTimeout(timer); ws.close(); resolve({ begin, fetch: msg }); }
    };
    ws.onerror = () => reject(new Error("fetch websocket error"));
  });
  const ack = await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => reject(new Error("op timeout")), input.timeoutMs || 15000);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.begin) {
        ws.send(JSON.stringify({
          a: "op",
          c: msg.collectionID,
          d: msg.docID,
          v: fetched.fetch.data.v,
          op: [],
          src: msg.clientID,
          seq: 1,
        }));
      } else if (msg.a === "op") {
        clearTimeout(timer);
        ws.close();
        resolve(msg);
      }
    };
    ws.onerror = () => reject(new Error("op websocket error"));
  });
  return JSON.stringify({
    ok: !ack.error,
    version: fetched.fetch.data.v,
    ack: { a: ack.a, error: ack.error, v: ack.v, src: ack.src, seq: ack.seq },
    collectionID: fetched.begin.collectionID,
    docID: fetched.begin.docID,
  });
})()
`;
}

function makeApplyBasicFormatScript(input) {
  return `
(async () => {
  const input = ${JSON.stringify(input || {})};

  function findOfficeIframe() {
    const frames = Array.from(document.querySelectorAll("iframe")).map((iframe, index) => ({
      iframe,
      index,
      src: iframe.src || "",
      title: iframe.title || "",
    }));
    const match = frames.find((frame) => frame.src.includes("office.netease.com") && frame.src.includes("identity=")) ||
      frames.find((frame) => frame.src.includes("office.netease.com")) ||
      frames.find((frame) => frame.src.includes("identity="));
    if (!match) {
      throw new Error("No POPO office iframe found: " + JSON.stringify({
        url: location.href,
        iframeCount: frames.length,
        iframes: frames.map((frame) => ({ index: frame.index, src: frame.src, title: frame.title })),
      }));
    }
    return match.iframe;
  }

  function makeWsUrl() {
    const iframeUrl = new URL(findOfficeIframe().src);
    const identity = iframeUrl.searchParams.get("identity");
    const source = iframeUrl.searchParams.get("from") || "POPO_DOC";
    const lang = iframeUrl.searchParams.get("popo_locale") || "zh-CN";
    return iframeUrl.origin.replace("https", "wss") + "/node/?" +
      new URLSearchParams({ identity, serverType: "GEZHI", source, wantCompress: "false", lang });
  }

  async function fetchSnapshot() {
    const wsUrl = makeWsUrl();
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("snapshot timeout")), input.timeoutMs || 15000);
      let begin = null;
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.begin) {
          begin = msg;
          ws.send(JSON.stringify({ a: "f", c: msg.collectionID, d: msg.docID }));
        } else if (msg.a === "f") {
          clearTimeout(timer);
          ws.close();
          resolve({ begin, fetch: msg });
        }
      };
      ws.onerror = () => reject(new Error("snapshot websocket error"));
    });
  }

  async function submitOp(version, op) {
    const wsUrl = makeWsUrl();
    return await new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => reject(new Error("op timeout")), input.timeoutMs || 15000);
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.begin) {
          ws.send(JSON.stringify({
            a: "op",
            c: msg.collectionID,
            d: msg.docID,
            v: version,
            op,
            src: msg.clientID,
            seq: 1,
          }));
        } else if (msg.a === "op") {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      };
      ws.onerror = () => reject(new Error("op websocket error"));
    });
  }

  function getAt(root, path) {
    let node = root;
    for (const part of path) {
      if (!node || !Object.prototype.hasOwnProperty.call(node, part)) return { exists: false, value: undefined };
      node = node[part];
    }
    return { exists: true, value: node };
  }

  function sameValue(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function pushSet(op, workbook, path, value) {
    const old = getAt(workbook, path);
    if (old.exists && sameValue(old.value, value)) return false;
    const part = { p: path, oi: value };
    if (old.exists) part.od = old.value;
    op.push(part);
    return true;
  }

  function normalizeRowId(sheet, item) {
    if (item.rowId !== undefined && item.rowId !== null) return String(item.rowId);
    if (item.visualRow === undefined || item.visualRow === null) throw new Error("rowId or visualRow is required");
    const rowId = sheet.rows?.[Number(item.visualRow) - 1];
    if (rowId === undefined) throw new Error("visualRow out of range: " + item.visualRow);
    return String(rowId);
  }

  function normalizeColId(sheet, item) {
    if (item.colId !== undefined && item.colId !== null) return String(item.colId);
    if (item.visualCol === undefined || item.visualCol === null) throw new Error("colId or visualCol is required");
    const colId = sheet.cols?.[Number(item.visualCol) - 1];
    if (colId === undefined) throw new Error("visualCol out of range: " + item.visualCol);
    return String(colId);
  }

  const sheetId = String(input.sheetId || "0");
  const before = await fetchSnapshot();
  const workbook = before.fetch.data.data;
  const version = before.fetch.data.v;
  const sheet = workbook.sheets[sheetId];
  if (!sheet) throw new Error("Sheet not found: " + sheetId);

  const base = ["sheets", sheetId];
  const op = [];
  const plan = {
    rowHeights: [],
    colWidths: [],
    spans: [],
    cells: [],
  };

  const rowHeights = input.rowHeights || [];
  const colWidths = input.colWidths || [];
  const spans = input.spans || [];
  const cells = input.cells || input.cellWrites || [];

  if (rowHeights.length) {
    const map = {};
    for (const item of rowHeights) {
      const rowId = normalizeRowId(sheet, item);
      map[rowId] = Number(item.height);
      plan.rowHeights.push({ ...item, rowId, height: Number(item.height) });
    }
    if (sheet.rowHeights && typeof sheet.rowHeights === "object") {
      for (const [rowId, height] of Object.entries(map)) pushSet(op, workbook, [...base, "rowHeights", rowId], height);
    } else {
      pushSet(op, workbook, [...base, "rowHeights"], map);
    }
  }

  if (colWidths.length) {
    const map = {};
    for (const item of colWidths) {
      const colId = normalizeColId(sheet, item);
      map[colId] = Number(item.width);
      plan.colWidths.push({ ...item, colId, width: Number(item.width) });
    }
    if (sheet.colWidths && typeof sheet.colWidths === "object") {
      for (const [colId, width] of Object.entries(map)) pushSet(op, workbook, [...base, "colWidths", colId], width);
    } else {
      pushSet(op, workbook, [...base, "colWidths"], map);
    }
  }

  if (spans.length) {
    const map = {};
    for (const item of spans) {
      const rowId = normalizeRowId(sheet, item);
      const colId = normalizeColId(sheet, item);
      const key = rowId + "," + colId;
      const value = [Number(item.rowSpan || 1), Number(item.colSpan || 1)];
      map[key] = value;
      plan.spans.push({ ...item, rowId, colId, key, value });
    }
    if (sheet.spans && typeof sheet.spans === "object") {
      for (const [key, value] of Object.entries(map)) pushSet(op, workbook, [...base, "spans", key], value);
    } else {
      pushSet(op, workbook, [...base, "spans"], map);
    }
  }

  if (cells.length) {
    const map = {};
    for (const item of cells) {
      const rowId = normalizeRowId(sheet, item);
      const colId = normalizeColId(sheet, item);
      const key = rowId + "," + colId;
      const oldCell = sheet.cells?.[key] || {};
      const nextCell = item.cell ? { ...item.cell } : { ...oldCell };
      if (Object.prototype.hasOwnProperty.call(item, "value")) nextCell["0"] = item.value;
      if (Object.prototype.hasOwnProperty.call(item, "link")) nextCell["1"] = item.link;
      if (Object.prototype.hasOwnProperty.call(item, "styleId")) nextCell["100"] = Number(item.styleId);
      map[key] = nextCell;
      plan.cells.push({ ...item, rowId, colId, key, expected: nextCell });
    }
    if (sheet.cells && typeof sheet.cells === "object") {
      for (const [key, cell] of Object.entries(map)) pushSet(op, workbook, [...base, "cells", key], cell);
    } else {
      pushSet(op, workbook, [...base, "cells"], map);
    }
  }

  if (input.dryRun !== false) {
    return JSON.stringify({ ok: true, mode: "dryRun", version, opCount: op.length, plan });
  }

  let ack = null;
  if (op.length) {
    ack = await submitOp(version, op);
    if (ack.error) return JSON.stringify({ ok: false, mode: "opError", version, ack, opCount: op.length, plan });
  }

  const after = await fetchSnapshot();
  const afterSheet = after.fetch.data.data.sheets[sheetId];
  const verification = {
    rowHeights: plan.rowHeights.map((item) => ({
      rowId: item.rowId,
      visualRow: item.visualRow,
      expected: item.height,
      actual: afterSheet.rowHeights?.[item.rowId],
      ok: afterSheet.rowHeights?.[item.rowId] === item.height,
    })),
    colWidths: plan.colWidths.map((item) => ({
      colId: item.colId,
      visualCol: item.visualCol,
      expected: item.width,
      actual: afterSheet.colWidths?.[item.colId],
      ok: afterSheet.colWidths?.[item.colId] === item.width,
    })),
    spans: plan.spans.map((item) => ({
      key: item.key,
      expected: item.value,
      actual: afterSheet.spans?.[item.key],
      ok: sameValue(afterSheet.spans?.[item.key], item.value),
    })),
    cells: plan.cells.map((item) => {
      const actual = afterSheet.cells?.[item.key] || {};
      const checks = {};
      if (Object.prototype.hasOwnProperty.call(item.expected, "0")) checks.value = actual["0"] === item.expected["0"];
      if (Object.prototype.hasOwnProperty.call(item.expected, "1")) checks.link = actual["1"] === item.expected["1"];
      if (Object.prototype.hasOwnProperty.call(item.expected, "100")) checks.styleId = actual["100"] === item.expected["100"];
      return { key: item.key, expected: item.expected, actual, checks, ok: Object.values(checks).every(Boolean) };
    }),
  };
  const ok = [...verification.rowHeights, ...verification.colWidths, ...verification.spans, ...verification.cells]
    .every((item) => item.ok);

  return JSON.stringify({
    ok,
    mode: op.length ? "written" : "unchanged",
    versionBefore: version,
    versionAfter: after.fetch.data.v,
    ack,
    opCount: op.length,
    plan,
    verification,
    notes: ["Merged-cell visual rendering may require a page reload after ShareDB op writes."],
  });
})()
`;
}

async function evaluateScript(input, code) {
  await maybeNavigate(input);
  const iframe = input.waitForIframe === false ? null : await waitForOfficeIframe(input);
  const call = await callWebBridge("evaluate", { code }, input);
  const parsed = parseEvaluateString(call.data);
  parsed.artifacts = parsed.artifacts || {};
  if (iframe) parsed.artifacts.iframeWaitResponsePath = iframe.artifacts.iframeWaitResponsePath;
  parsed.artifacts.evaluateResponsePath = call.responsePath;
  return parsed;
}

const toolDefinitions = [
  {
    name: "popo_get_snapshot_summary",
    description: "Fetch a compact POPO ShareDB snapshot summary through Kimi WebBridge.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        waitForIframe: { type: "boolean", default: true },
        sheetId: { type: "string", default: "0" },
        nameColId: { type: "string", default: "3" },
        names: { type: "array", items: { type: "string" } },
        targetColIds: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "number" } },
        artifactDir: { type: "string" }
      }
    }
  },
  {
    name: "popo_resolve_by_name",
    description: "Resolve POPO row ids and target cells by in-sheet names.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        waitForIframe: { type: "boolean", default: true },
        sheetId: { type: "string", default: "0" },
        nameColId: { type: "string", default: "3" },
        targetColIds: { type: "array", items: { type: "string" } },
        names: { type: "array", items: { type: "string" } },
        artifactDir: { type: "string" }
      },
      required: ["names"]
    }
  },
  {
    name: "popo_probe_write_channel",
    description: "Probe the POPO ShareDB write channel with an empty op that does not change data.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        waitForIframe: { type: "boolean", default: true },
        artifactDir: { type: "string" }
      }
    }
  },
  {
    name: "popo_write_by_name",
    description: "Write simple text/link values to a target POPO column by matching in-sheet names.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        waitForIframe: { type: "boolean", default: true },
        sheetId: { type: "string", default: "0" },
        nameColId: { type: "string", default: "3" },
        targetColId: { type: "string" },
        fields: { type: "array", items: { type: "string" }, default: ["0", "1"] },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              value: { type: "string" }
            },
            required: ["name", "value"]
          }
        },
        dryRun: { type: "boolean", default: false },
        artifactDir: { type: "string" }
      },
      required: ["targetColId", "edits"]
    }
  },
  {
    name: "popo_write_from_source_file",
    description: "Read a local TSV/CSV/Markdown source file and bulk write simple POPO values by matching names.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        waitForIframe: { type: "boolean", default: true },
        sheetId: { type: "string", default: "0" },
        nameColId: { type: "string", default: "3" },
        targetColId: { type: "string" },
        fields: { type: "array", items: { type: "string" }, default: ["0", "1"] },
        sourcePath: { type: "string" },
        sourceNameColumn: { type: "string" },
        sourceValueColumn: { type: "string" },
        includeBlankValues: { type: "boolean", default: false },
        dryRun: { type: "boolean", default: true },
        artifactDir: { type: "string" }
      },
      required: ["targetColId", "sourcePath", "sourceNameColumn", "sourceValueColumn"]
    }
  },
  {
    name: "popo_apply_basic_format",
    description: "Apply verified POPO layout formatting: row heights, column widths, merged spans, cell text, and existing style ids.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        waitForIframe: { type: "boolean", default: true },
        sheetId: { type: "string", default: "0" },
        rowHeights: {
          type: "array",
          items: {
            type: "object",
            properties: {
              visualRow: { type: "number" },
              rowId: { type: "string" },
              height: { type: "number" }
            },
            required: ["height"]
          }
        },
        colWidths: {
          type: "array",
          items: {
            type: "object",
            properties: {
              visualCol: { type: "number" },
              colId: { type: "string" },
              width: { type: "number" }
            },
            required: ["width"]
          }
        },
        spans: {
          type: "array",
          items: {
            type: "object",
            properties: {
              visualRow: { type: "number" },
              visualCol: { type: "number" },
              rowId: { type: "string" },
              colId: { type: "string" },
              rowSpan: { type: "number", default: 1 },
              colSpan: { type: "number", default: 1 }
            }
          }
        },
        cells: {
          type: "array",
          items: {
            type: "object",
            properties: {
              visualRow: { type: "number" },
              visualCol: { type: "number" },
              rowId: { type: "string" },
              colId: { type: "string" },
              value: { type: "string" },
              link: { type: "string" },
              styleId: { type: "number" },
              cell: { type: "object" }
            }
          }
        },
        dryRun: { type: "boolean", default: true },
        artifactDir: { type: "string" }
      },
      required: ["sheetId"]
    }
  },
  {
    name: "popo_screenshot_checkpoint",
    description: "Capture a WebBridge screenshot and copy the returned temp image to a stable artifact path.",
    inputSchema: {
      type: "object",
      properties: {
        session: { type: "string" },
        url: { type: "string" },
        newTab: { type: "boolean" },
        groupTitle: { type: "string" },
        skipNavigate: { type: "boolean" },
        iframeTimeoutMs: { type: "number" },
        artifactDir: { type: "string" },
        fileName: { type: "string" }
      }
    }
  }
];

async function callTool(name, input) {
  if (name === "popo_get_snapshot_summary" || name === "popo_resolve_by_name") {
    return await evaluateScript(input, makeSnapshotScript(input));
  }
  if (name === "popo_probe_write_channel") {
    return await evaluateScript(input, makeProbeWriteScript(input));
  }
  if (name === "popo_write_by_name") {
    return await evaluateScript(input, makeWriteByNameScript(input));
  }
  if (name === "popo_write_from_source_file") {
    const source = buildEditsFromSourceFile(input);
    const merged = { ...input, edits: source.edits };
    const result = await evaluateScript(merged, makeWriteByNameScript(merged));
    result.source = {
      sourcePath: source.sourcePath,
      sourceRowCount: source.sourceRowCount,
      editCount: source.edits.length,
      sourceNameColumn: input.sourceNameColumn,
      sourceValueColumn: input.sourceValueColumn,
    };
    return result;
  }
  if (name === "popo_apply_basic_format") {
    return await evaluateScript(input, makeApplyBasicFormatScript(input));
  }
  if (name === "popo_screenshot_checkpoint") {
    await maybeNavigate(input);
    if (input.waitForIframe !== false) await waitForOfficeIframe(input);
    const screenshot = await callWebBridge("screenshot", { format: "png" }, input);
    if (!screenshot.data.ok || !screenshot.data.data || !screenshot.data.data.path) {
      throw new Error(`Screenshot failed: ${JSON.stringify(screenshot.data)}`);
    }
    const sourcePath = screenshot.data.data.path;
    if (!fs.existsSync(sourcePath)) throw new Error(`Screenshot path does not exist: ${sourcePath}`);
    const artifactDir = path.resolve(input.artifactDir || DEFAULT_ARTIFACT_DIR);
    ensureDir(artifactDir);
    const fileName = input.fileName || `${timestamp()}-screenshot.png`;
    const copiedPath = path.join(artifactDir, fileName);
    fs.copyFileSync(sourcePath, copiedPath);
    return {
      ok: true,
      returnedScreenshotPath: sourcePath,
      copiedScreenshotPath: copiedPath,
      responsePath: screenshot.responsePath,
      sizeBytes: screenshot.data.data.sizeBytes,
    };
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function runCli() {
  const args = process.argv.slice(2);
  if (args[0] === "--list-tools") {
    console.log(JSON.stringify(toolDefinitions.map((tool) => ({ name: tool.name, description: tool.description })), null, 2));
    return;
  }
  if (args[0] === "--call") {
    const toolName = args[1];
    const input = readJsonArg(args[2] || "{}");
    const result = await callTool(toolName, input);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (args[0] === "--stdio") {
    await runMcp();
    return;
  }
  console.error("Usage: node mcp/server.cjs --stdio | --list-tools | --call <tool> <json|@file.json>");
  process.exitCode = 2;
}

async function runMcp() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", async (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let request;
      try {
        request = JSON.parse(line);
        await handleMcpRequest(request);
      } catch (error) {
        sendJson({ jsonrpc: "2.0", id: request && request.id, error: { code: -32603, message: error.message } });
      }
    }
  });
}

async function handleMcpRequest(request) {
  const { id, method, params } = request;
  if (method === "initialize") {
    sendJson({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "popo-sheet-tool-copy", version: "0.1.0" },
      },
    });
    return;
  }
  if (method === "notifications/initialized") return;
  if (method === "tools/list") {
    sendJson({ jsonrpc: "2.0", id, result: { tools: toolDefinitions } });
    return;
  }
  if (method === "tools/call") {
    try {
      const result = await callTool(params.name, params.arguments || {});
      sendJson({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        },
      });
    } catch (error) {
      sendJson({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: error.stack || error.message }],
          isError: true,
        },
      });
    }
    return;
  }
  if (method === "shutdown") {
    sendJson({ jsonrpc: "2.0", id, result: null });
    return;
  }
  sendJson({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
}

function sendJson(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

runCli().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
