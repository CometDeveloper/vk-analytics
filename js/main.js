/* ===== Entry point: tabs, analytics, search ===== */
import { DEFAULTS, INITIAL_SORT } from "./constants.js";
import {
  $, rowsToXLS, toBlobAndDownload, parsePostId,
  sortRows, initSorting, setSort, applySortIndicators
} from "./utils.js";
import { fetchPosts, fetchGroupsMembersCounts, sumTotals, vk } from "./vk.js";
import { renderTableBody, renderTotals, showProgress, setProgress } from "./ui.js";

/* Глобальний стан */
let STATE = { rows: [], totals: {}, sort: INITIAL_SORT, missing: 0 };

/* ===== Tabs ===== */
function switchTab(tab) {
  const anaBtn = $("#tabAnalytics");
  const seaBtn = $("#tabSearch");
  const anaSec = $("#analyticsSection");
  const seaSec = $("#searchSection");

  if (tab === "analytics") {
    anaBtn.classList.add("active"); seaBtn.classList.remove("active");
    anaSec.style.display = "";      seaSec.style.display = "none";
  } else {
    seaBtn.classList.add("active"); anaBtn.classList.remove("active");
    seaSec.style.display = "";      anaSec.style.display = "none";
  }
}

/* ===== Helpers ===== */
function setStatus(text, kind = "muted") {
  const el = $("#status");
  el.textContent = text || "";
  el.className = `status ${kind}`; // muted | ok | err
}

/* ===== Init ===== */
document.addEventListener("DOMContentLoaded", () => {
  /* дефолтні значення */
  $("#version").value = DEFAULTS.apiVersion;
  $("#batch").value   = DEFAULTS.batchSize;

  /* початково експортувати не можна */
  $("#export").disabled = true;

  /* таби */
  $("#tabAnalytics").addEventListener("click", () => switchTab("analytics"));
  $("#tabSearch").addEventListener("click",    () => switchTab("search"));

  /* сортування */
  initSorting("#table", (next) => {
    STATE.sort = next;
    setSort(next);
    const sorted = sortRows(STATE.rows);
    renderTableBody(sorted);
    applySortIndicators("#table");
  });
  setSort(STATE.sort);
  applySortIndicators("#table");

  /* аналітика */
  $("#analyze").addEventListener("click", onAnalyze);
  $("#export").addEventListener("click", onExportExcel);
  $("#analytics-clear").addEventListener("click", onClearAnalytics);

  /* пошук */
  $("#searchBtn").addEventListener("click", onSearch);
  $("#copyLinksBtn").addEventListener("click", copyAllLinks);
  $("#search-clear").addEventListener("click", onClearSearch);
});

/* ===== Analytics ===== */
async function onAnalyze() {
  try {
    setStatus("Обробка…", "muted");
    $("#export").disabled = true; // на час обчислень теж вимкнемо

    const version   = ($("#version").value || DEFAULTS.apiVersion).trim();
    const batchSize = Math.max(1, Math.min(100, parseInt($("#batch").value, 10) || DEFAULTS.batchSize));

    const rawLines = $("#urls").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const keys = []; const badLines = [];
    for (const line of rawLines) {
      const pid = parsePostId(line);
      if (pid) keys.push(`${pid.owner_id}_${pid.post_id}`); else badLines.push(line);
    }
    if (!keys.length) { setStatus("Немає валідних посилань.", "err"); return; }
    if (badLines.length) setStatus(`Пропущено невалідні рядки: ${badLines.length}`, "muted");

    showProgress(true); setProgress(1, "Старт…");

    const { rows, bad } = await fetchPosts(keys, version, batchSize, setProgress);

    const map = await fetchGroupsMembersCounts(rows, version, setProgress);
    rows.forEach((r) => { if (r.owner_id < 0) r.group_members = map[Math.abs(r.owner_id)] || 0; });

    const totals = sumTotals(rows, map);
    STATE.rows = sortRows(rows);
    STATE.totals = totals;
    STATE.missing = bad.length;

    renderTotals(totals, { missing: bad.length });
    renderTableBody(STATE.rows);
    applySortIndicators("#table");

    const msgs = [];
    if (badLines.length) msgs.push(`Пропущено невалідні рядки: ${badLines.length}`);
    if (bad.length)     msgs.push(`Недоступні або видалені пости: ${bad.length}`);
    setStatus(msgs.join(" ") || "Готово", msgs.length ? "muted" : "ok");

    /* ✅ тепер можна експортувати */
    $("#export").disabled = STATE.rows.length === 0;

    setProgress(100, "Готово"); showProgress(false);
  } catch (e) {
    console.error(e);
    setStatus(`Помилка: ${e?.message || e}`, "err");
    showProgress(false);
    $("#export").disabled = true;
  }
}

/* Експорт у Excel (.xls) */
function onExportExcel() {
  if (!STATE.rows.length) { setStatus("Немає даних для експорту.", "muted"); return; }
  const xls = rowsToXLS(STATE.rows);
  toBlobAndDownload("vk_analytics.xls", xls, "application/vnd.ms-excel");
}

/* Очистити */
function onClearAnalytics() {
  $("#urls").value = "";
  $("#tableWrap").style.display = "none";
  $("#totals").style.display = "none";
  setStatus("Очищено.", "muted");
  showProgress(false);
  $("#export").disabled = true; // після очищення знову вимикаємо
  STATE = { rows: [], totals: {}, sort: STATE.sort, missing: 0 };
}

/* ===== Search (як було) ===== */
async function onSearch() {
  const q = $("#searchText").value.trim();
  const status = $("#searchStatus");
  const list   = $("#searchList");
  const wrap   = $("#searchResultsWrap");
  const count  = $("#searchCount");
  const copyBtn= $("#copyLinksBtn");

  status.textContent = ""; list.innerHTML = ""; wrap.style.display = "none"; copyBtn.disabled = true;

  if (!q) { status.textContent = "Введіть текст для пошуку."; status.className = "status err"; return; }

  status.textContent = "Шукаємо…"; status.className = "status muted";

  try {
    const resp = await vk("newsfeed.search", { q, count: 50 }, $("#version").value || DEFAULTS.apiVersion);
    const items = Array.isArray(resp?.items) ? resp.items : [];
    const links = items
      .filter((it) => it.owner_id && it.id)
      .map((it) => `https://vk.com/wall${it.owner_id}_${it.id}`);

    if (!links.length) {
      status.textContent = "Нічого не знайдено."; status.className = "status muted";
      return;
    }

    links.forEach((href) => {
      const li = document.createElement("li");
      li.innerHTML = `<a class="found-link" href="${href}" target="_blank" rel="noopener">${href}</a>`;
      list.appendChild(li);
    });

    count.textContent = String(links.length);
    wrap.style.display = "block";
    status.textContent = "Готово."; status.className = "status ok";
    copyBtn.disabled = false;
    copyBtn.dataset.links = links.join("\n");
  } catch (e) {
    console.error(e);
    status.textContent = `Помилка пошуку: ${e?.message || e}`; status.className = "status err";
  }
}

function copyAllLinks() {
  const btn = $("#copyLinksBtn");
  const text = btn.dataset.links || "";
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    $("#searchStatus").textContent = "Посилання скопійовано."; $("#searchStatus").className = "status ok";
  }).catch(() => {
    $("#searchStatus").textContent = "Не вдалося скопіювати."; $("#searchStatus").className = "status err";
  });
}

function onClearSearch() {
  $("#searchText").value = "";
  $("#searchList").innerHTML = "";
  $("#searchResultsWrap").style.display = "none";
  $("#searchStatus").textContent = "Очищено.";
  $("#searchStatus").className = "status muted";
  $("#copyLinksBtn").disabled = true;
}