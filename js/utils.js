/* ===== Small DOM / formatting / csv / sorting helpers ===== */
export const $ = (sel) => document.querySelector(sel);

export function fmt(num) {
  if (num == null || Number.isNaN(Number(num))) return "";
  return Number(num).toLocaleString("uk-UA");
}

export function toBlobAndDownload(filename, content, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); document.body.removeChild(a); }, 0);
}

/* CSV залишаю на випадок, якщо ще знадобиться */
export function rowsToCSV(rows) {
  const header = ["post_url","reach_members_count","views","comments","likes","reposts"];
  const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [header.join(",")];
  rows.forEach((r) => {
    lines.push([r.url, r.group_members ?? 0, r.views ?? 0, r.comments ?? 0, r.likes ?? 0, r.reposts ?? 0]
      .map(escape).join(","));
  });
  return lines.join("\n");
}

/* ===== NEW: Генерація Excel (XML Spreadsheet 2003, .xls) ===== */
function xmlEsc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Повертає текст XLS (SpreadsheetML), який чудово відкривається в Excel */
export function rowsToXLS(rows) {
  const headers = [
    "post_url",
    "reach_members_count",
    "views",
    "comments",
    "likes",
    "reposts",
  ];

  const xmlHeader =
    `<?xml version="1.0"?>` +
    `<?mso-application progid="Excel.Sheet"?>` +
    `<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"` +
    ` xmlns:o="urn:schemas-microsoft-com:office:office"` +
    ` xmlns:x="urn:schemas-microsoft-com:office:excel"` +
    ` xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">` +
    `<Worksheet ss:Name="Analytics"><Table>`;

  const xmlFooter = `</Table></Worksheet></Workbook>`;

  const row = (cells) =>
    `<Row>${cells.map((c) => {
      const isNumber = typeof c === "number" || /^[0-9]+(\.[0-9]+)?$/.test(String(c));
      const type = isNumber ? "Number" : "String";
      return `<Cell><Data ss:Type="${type}">${xmlEsc(c)}</Data></Cell>`;
    }).join("")}</Row>`;

  const rowsXml = [
    row(headers),
    ...rows.map(r => row([
      r.url,
      r.group_members ?? 0,
      r.views ?? 0,
      r.comments ?? 0,
      r.likes ?? 0,
      r.reposts ?? 0,
    ])),
  ].join("");

  return xmlHeader + rowsXml + xmlFooter;
}

/* ===== Сортування ===== */
export let currentSort = { key: "views", dir: "desc" };
export function setSort(next) { currentSort = next; }

export function sortRows(rows) {
  const { key, dir } = currentSort;
  const mul = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = a[key] ?? 0; const bv = b[key] ?? 0;
    if (typeof av === "string" || typeof bv === "string") {
      return String(av).localeCompare(String(bv)) * mul;
    }
    return (av - bv) * mul;
  });
}

export function applySortIndicators(tableSelector) {
  const ths = document.querySelectorAll(`${tableSelector} thead th[data-sort]`);
  ths.forEach((th) => {
    th.classList.remove("sorted-asc", "sorted-desc");
    const key = th.getAttribute("data-sort");
    if (key === currentSort.key) {
      th.classList.add(currentSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });
}

export function initSorting(tableSelector, onChange) {
  const thead = document.querySelector(`${tableSelector} thead`);
  if (!thead) return;
  thead.addEventListener("click", (e) => {
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    const key = th.getAttribute("data-sort");
    if (currentSort.key === key) currentSort.dir = currentSort.dir === "asc" ? "desc" : "asc";
    else currentSort = { key, dir: "desc" };
    applySortIndicators(tableSelector);
    onChange?.(currentSort);
  });
  applySortIndicators(tableSelector);
}

/* ===== Парсинг посилань ===== */
const WALL_RE = /wall(-?\d+)_([0-9]+)/;
export function parsePostId(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  try {
    const m = s.match(/^(-?\d+)_(\d+)$/);
    if (m) return { owner_id: parseInt(m[1], 10), post_id: parseInt(m[2], 10) };
    const u = new URL(s);
    const w = u.pathname.replace(/^\/+/, "");
    if (w) {
      const m2 = w.match(WALL_RE);
      if (m2) return { owner_id: parseInt(m2[1], 10), post_id: parseInt(m2[2], 10) };
    }
  } catch (_) {}
  return null;
}