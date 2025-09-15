/* ===== VK Posts Analytics + Пошук постів ===== */
const $ = (sel) => document.querySelector(sel);

/* ===== VK API через Cloudflare Worker-проксі ===== */
const PROXY_API = "https://vk-analytics-worker.s49254177.workers.dev/vk";

async function vk(method, params, version) {
  const q = new URLSearchParams({ ...params });
  if (version) q.set("v", version);
  const res = await fetch(`${PROXY_API}/${method}?${q.toString()}`);
  const data = await res.json();
  if (data.error) throw new Error(`VK API error ${data.error.error_code}: ${data.error.error_msg}`);
  return data.response;
}

function setStatus(el, variant = null, text) {
  if (!el) return;
  el.classList.add("status");
  el.classList.remove("ok", "err", "muted");
  if (variant) el.classList.add(variant);
  if (typeof text === "string") el.textContent = text;
}

const SEARCH_FILTER = {
  minTokensForExact: 4,   // лишаємо як є (але це лише для додаткового "плюса")

  // Дуже м’які пороги
  jaccardLong: 0.35,      // було 0.60
  jaccardShort: 0.55,     // було 0.80

  // Майже не обмежуємо довжину поста
  minPostLenAbs: 5,       // було 20
  minPostLenRel: 0.10,    // було 0.40

  // ВИМКНЕНО: додаткові жорсткі фільтри
  communitiesOnly: false, // не відсікаємо користувачів
  excludeReposts: false,  // не відсікаємо репости
  minCyrillicRatio: 0     // не вимагаємо кирилиці
};

function postPassesFilters(item, qRaw) {
  // Базова санітарія
  const owner = item?.owner_id;
  const id    = item?.id;
  const text  = item?.text || "";
  if (typeof owner !== "number" || typeof id !== "number") return false;

  // Легкі вимоги до вмісту
  const normText = normalizeText(text);
  if (!normText) return false;

  const qNorm   = normalizeText(qRaw);
  const qTokens = tokenize(qRaw);
  const minLen  = Math.max(SEARCH_FILTER.minPostLenAbs, Math.floor(qNorm.length * SEARCH_FILTER.minPostLenRel));
  if (normText.length < minLen) return false;

  // Вимкнені “суворі” фільтри залишаємо як умови тільки якщо вмикатимеш знову
  if (SEARCH_FILTER.communitiesOnly && !(owner < 0)) return false;
  if (SEARCH_FILTER.excludeReposts && Array.isArray(item?.copy_history) && item.copy_history.length > 0) return false;
  if (SEARCH_FILTER.minCyrillicRatio > 0 && cyrillicRatio(text) < SEARCH_FILTER.minCyrillicRatio) return false;

  // --- ЛОЯЛЬНА МЕТРИКА СХОЖОСТІ ---
  // 1) точне входження (після нормалізації) — автоматичний пропуск
  if (qTokens.length >= SEARCH_FILTER.minTokensForExact && hasExactPhrase(text, qRaw)) return true;

  // 2) Jaccard за токенами — занижений поріг
  const postTokens = tokenize(text);
  const sim = jaccard(postTokens, qTokens);
  const thr = (qTokens.length >= SEARCH_FILTER.minTokensForExact) ? SEARCH_FILTER.jaccardLong : SEARCH_FILTER.jaccardShort;
  if (sim >= thr) return true;

  // 3) Страхувальна умова: є хоча б 2 спільних токени (після нормалізації)
  let overlap = 0;
  const setQ = new Set(qTokens);
  for (const t of postTokens) {
    if (setQ.has(t)) {
      overlap++;
      if (overlap >= 2) return true;
    }
  }

  // Якщо нічого з вище — відхиляємо
  return false;
}

/* ---------- Форматування чисел ---------- */
function fmt(num) {
  if (num == null || Number.isNaN(Number(num))) return "";
  return Number(num).toLocaleString("uk-UA");
}

/* ---------- Сортування для аналітики ---------- */
let currentSort = { key: "views", dir: "desc" };
function sortRows(rows) {
  const { key, dir } = currentSort;
  const mult = dir === "desc" ? 1 : -1;
  const val = (x) => (x == null ? -Infinity : Number(x));
  return [...rows].sort((a, b) => {
    const va = val(a[key]);
    const vb = val(b[key]);
    if (va === vb) return 0;
    return (vb - va) * mult;
  });
}
function applySortIndicators() {
  document.querySelectorAll("th.sortable").forEach(th => {
    th.classList.remove("sorted-asc","sorted-desc");
    if (th.dataset.sort === currentSort.key) {
      th.classList.add(currentSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    }
  });
}
function initSorting() {
  const thead = document.getElementById("tableHead");
  if (!thead) return;
  thead.addEventListener("click", (e) => {
    const th = e.target.closest("th.sortable");
    if (!th) return;
    const key = th.dataset.sort;
    if (!key) return;

    if (currentSort.key === key) {
      currentSort.dir = currentSort.dir === "desc" ? "asc" : "desc";
    } else {
      currentSort = { key, dir: "desc" };
    }
    applySortIndicators();

    if (window.__rows) {
      const sorted = sortRows(window.__rows);
      window.__rows = sorted;
      renderTable(sorted, window.__totals || {});
    }
  });
  applySortIndicators();
}

/* ---------- Прогрес ---------- */
function showProgress(show) {
  $("#progress").style.display = show ? "block" : "none";
}

function setProgress(pct, text = "") {
  const fill = $("#progressFill");
  const lbl = $("#progressText");
  if (!fill || !lbl) return;
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  fill.style.width = v + "%";
  lbl.textContent = text || (v + "%");
}

/* ---------- Нормалізатори ---------- */
function normalizeWallGetById(resp) {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.items)) return resp.items;
  if (resp.id && resp.owner_id) return [resp];
  return [];
}
function normalizeGroupsGetById(resp) {
  const arr = resp.groups;

  if (!arr) return [];
  if (Array.isArray(arr)) return arr;
  if (Array.isArray(arr.items)) return arr.items;
  if (arr.id) return [arr];
  return [];
}

/* ---------- Парсер URL постів ---------- */
const WALL_RE = /wall(-?\d+)_(\d+)/;
function parsePostId(url) {
  try {
    const u = new URL(url.trim());
    const m1 = u.pathname.match(WALL_RE);
    if (m1) return { owner_id: parseInt(m1[1], 10), post_id: parseInt(m1[2], 10), url };
    const w = u.searchParams.get("w");
    if (w) {
      const m2 = w.match(WALL_RE);
      if (m2) return { owner_id: parseInt(m2[1], 10), post_id: parseInt(m2[2], 10), url };
    }
  } catch (_) {}
  return null;
}

/* ---------- Отримання постів (batch + fallback) ---------- */
async function fetchSinglePost(key, version) {
  try {
    const resp = await vk("wall.getById", { posts: key }, version);
    const arr = normalizeWallGetById(resp);
    if (arr.length) return { ok: true, post: arr[0] };
    return { ok: false, key, error: "видалений" };
  } catch (e) {
    const msg = String(e.message || "");
    if (msg.includes("error 15") || msg.includes("Access denied")) {
      return { ok: false, key, error: "закрита спільнота" };
    }
    return { ok: false, key, error: "помилка" };
  }
}

async function fetchPosts(keys, version, onProgress) {
  const out = [];
  const batchSize = parseInt($("#batch").value, 10) || 80;
  let done = 0;

  for (let i = 0; i < keys.length; i += batchSize) {
    const chunk = keys.slice(i, i + batchSize);
    try {
      const resp = await vk("wall.getById", { posts: chunk.join(",") }, version);
      const arr = normalizeWallGetById(resp);
      out.push(...arr.map(p => ({ ok: true, post: p })));
      done += chunk.length;
      onProgress?.((done / keys.length) * 100, `Пости: ${done}/${keys.length}`);
    } catch {
      for (const key of chunk) {
        const r = await fetchSinglePost(key, version);
        out.push(r);
        done += 1;
        onProgress?.((done / keys.length) * 100, `Пости: ${done}/${keys.length}`);
      }
    }
  }
  return out;
}

/* ---------- Підписники пабліків ---------- */
async function fetchGroupsMembersCounts(groupIds, version, onProgress) {
  const unique = Array.from(new Set(groupIds)).filter(Boolean);
  const map = {};
  const size = 500;
  let done = 0;

  if (unique.length === 0) {
    onProgress?.(100, "Підписники: 0/0");
    return map;
  }

  for (let i = 0; i < unique.length; i += size) {
    const part = unique.slice(i, i + size);
    const resp = await vk("groups.getById", { group_ids: part.join(","), fields: "members_count" }, version);
    const arr = normalizeGroupsGetById(resp);
    for (const g of arr) {
      if (g && typeof g.id === "number") {
        map[g.id] = g.members_count || 0;
      }
    }
    done += part.length;
    onProgress?.((done / unique.length) * 100, `Підписники: ${done}/${unique.length}`);
  }
  return map;
}

/* ---------- Підсумки ---------- */
function uniqueReachFromRows(rows) {
  const seen = new Set();
  let sum = 0;
  for (const r of rows) {
    if (!r.error && r.owner_id < 0 && typeof r.group_members === "number") {
      const gid = Math.abs(r.owner_id);
      if (!seen.has(gid)) { seen.add(gid); sum += r.group_members; }
    }
  }
  return sum;
}
function sumTotals(rows) {
  const totals = {
    posts: rows.length, deleted: 0, closed: 0,
    views: 0, comments: 0, likes: 0, reposts: 0,
    group_members_sum_unique: 0
  };
  for (const r of rows) {
    if (r.error === "видалений") { totals.deleted++; continue; }
    if (r.error === "закрита спільнота") { totals.closed++; continue; }
    if (r.error) continue;
    totals.views += r.views || 0;
    totals.comments += r.comments || 0;
    totals.likes += r.likes || 0;
    totals.reposts += r.reposts || 0;
  }
  totals.group_members_sum_unique = uniqueReachFromRows(rows);
  return totals;
}

/* ---------- Рендер аналітики ---------- */
function renderTable(rows, totals) {
  const tbody = $("#table tbody");
  tbody.innerHTML = "";

  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.error) tr.classList.add("error-row");
    tr.innerHTML = `
      <td class="small"><div class="mono">${r.url}</div></td>
      <td>${fmt(r.group_members)}</td>
      <td>${fmt(r.views)}</td>
      <td>${fmt(r.comments)}</td>
      <td>${fmt(r.likes)}</td>
      <td>${fmt(r.reposts)}</td>
    `;
    tbody.appendChild(tr);
  }

  $("#tableWrap").style.display = rows.length ? "block" : "none";

  const box = $("#totals");
  if (!rows.length) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.innerHTML = `
    <div><strong>Аналітика</strong></div>
    <br>
    <div>Кількість постів: <strong>${totals.posts}</strong> (Видалені — <strong>${totals.deleted}</strong>, Закриті спільноти — <strong>${totals.closed}</strong>)</div>
    <br>
    <div>Охоплення: <strong>${fmt(totals.group_members_sum_unique)}</strong></div>
    <div>Перегляди: <strong>${fmt(totals.views)}</strong></div>
    <div>Коментарі: <strong>${fmt(totals.comments)}</strong></div>
    <div>Реакції: <strong>${fmt(totals.likes)}</strong></div>
    <div>Поширення: <strong>${fmt(totals.reposts)}</strong></div>
  `;
}

/* ---------- CSV ---------- */
function toCSV(rows) {
  const headers = ["url","owner_id","post_id","group_members","views","comments","likes","reposts","status"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const status = r.error ? r.error : "";
    lines.push([
      r.url, r.owner_id, r.post_id,
      r.group_members ?? "", r.views ?? "", r.comments ?? "", r.likes ?? "", r.reposts ?? "", status
    ].join(","));
  }
  return lines.join("\n");
}
function toBlobAndDownload(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* ---------- Основна логіка АНАЛІТИКИ ---------- */
async function analyze() {
  $("#status").textContent = "";
  showProgress(true);
  setProgress(0, "Обробка…");

  const version = $("#version").value.trim() || "5.199";

  const lines = $("#urls").value
    .split("\n")
    .map(s => s.trim().replace(/\s+/g, "_"))
    .filter(Boolean);

  const parsed = []; const bad = [];
  for (const line of lines) {
    const p = parsePostId(line);
    if (p) parsed.push({ ...p, url: line });
    else bad.push(line);
  }
  if (!parsed.length) {
    showProgress(false);
    $("#status").textContent = "Не знайшов жодного валідного посилання на пост.";
    setStatus($("#status"), "err");
    $("#tableWrap").style.display = "none";
    $("#totals").style.display = "none";
    return;
  }

  const keys = parsed.map(p => `${p.owner_id}_${p.post_id}`);

  const fetched = await fetchPosts(keys, version, (pct, label) => setProgress(pct, label));

  const groupIds = [];
  for (const p of parsed) if (p.owner_id < 0) groupIds.push(Math.abs(p.owner_id));
  const groupsMap = await fetchGroupsMembersCounts(groupIds, version, (pct, label) => setProgress(pct, label));

  const rowsRaw = parsed.map(p => {
    const key = `${p.owner_id}_${p.post_id}`;
    const f = fetched.find(x => (x.ok && x.post.id === p.post_id && x.post.owner_id === p.owner_id) || (x.key === key));
    if (!f) {
      return { ...p, error: "видалений", group_members: p.owner_id < 0 ? (groupsMap[Math.abs(p.owner_id)] ?? null) : null };
    }
    if (!f.ok) {
      return { ...p, error: f.error, group_members: p.owner_id < 0 ? (groupsMap[Math.abs(p.owner_id)] ?? null) : null };
    }
    const item = f.post;
    return {
      ...p,
      views: item.views?.count ?? null,
      comments: item.comments?.count ?? null,
      likes: item.likes?.count ?? null,
      reposts: item.reposts?.count ?? null,
      group_members: p.owner_id < 0 ? (groupsMap[Math.abs(p.owner_id)] ?? null) : null
    };
  });

  const rows = sortRows(rowsRaw);
  const totals = sumTotals(rows);

  window.__rows = rows;
  window.__totals = totals;

  renderTable(rows, totals);
  showProgress(false);

  const msg = [];
  if (bad.length) msg.push(`Пропущено невалідні рядки: ${bad.length}`);
  
  $("#status").textContent = msg.join(" ");
  setStatus($("#status"), msg.length ? "muted" : "");
}

/* ---------- Логіка ПОШУКУ ПОСТІВ ---------- */

async function searchPosts() {
  const qRaw = ($("#searchText").value || "").trim();
  const status = $("#searchStatus");
  const list = $("#searchList");
  const wrap = $("#searchResultsWrap");
  const countEl = $("#searchCount");
  const btnCopy = $("#copyLinksBtn");

  setStatus(status, "muted", "");
  list.innerHTML = "";
  wrap.style.display = "none";
  btnCopy.disabled = true;
  countEl.textContent = "0";

  if (!qRaw) {
    setStatus(status, "err", "Введи текст для пошуку.");
    return;
  }

  setStatus(status, "muted", "Пошук...");

  try {
    const resp = await vk("newsfeed.search", { q: qRaw, count: 200 });
    const items = Array.isArray(resp?.items) ? resp.items : [];

    const links = [];
    const seen = new Set();

    for (const it of items) {
      // відсіювання поганих результатів
      if (!postPassesFilters(it, qRaw)) continue;

      const owner = it?.owner_id;
      const id = it?.id;
      if (typeof owner !== "number" || typeof id !== "number") continue;

      const href = `https://vk.com/wall${owner}_${id}`;
      if (seen.has(href)) continue;
      seen.add(href);
      links.push(href);
    }

    if (!links.length) {
      setStatus(status, "muted", "Нічого не знайдено (після фільтрації).");
      return;
    }

    // показ результатів
    for (const href of links) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      li.classList.add('found-link');
      a.href = href; a.target = "_blank"; a.rel = "noopener";
      a.textContent = href;
      li.appendChild(a);
      list.appendChild(li);
    }

    wrap.style.display = "block";
    countEl.textContent = String(links.length);
    setStatus(status, "ok", "Готово.");
    btnCopy.disabled = false;
    window.__searchLinks = links;

  } catch (e) {
    setStatus(status, "err", "Помилка пошуку: " + (e.message || e));
  }
}

/* ---------- Копіювати всі посилання ---------- */
async function copyAllLinks() {
  const links = window.__searchLinks || [];
  if (!links.length) return;
  const text = links.join("\n");
  try {
    await navigator.clipboard.writeText(text);
    $("#searchStatus").textContent = "Посилання скопійовано у буфер.";
    setStatus($("#searchStatus"), "ok");
  } catch {
    // Фолбек
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    $("#searchStatus").textContent = "Посилання скопійовано (fallback).";
    setStatus($("#searchStatus"), "ok");
  }
}

/* ---------- Tabs ---------- */
function switchTab(tab) {
  const A = $("#analyticsSection");
  const S = $("#searchSection");
  const bA = $("#tabAnalytics");
  const bS = $("#tabSearch");

  if (tab === "analytics") {
    A.style.display = "block"; S.style.display = "none";
    bA.classList.add("active"); bS.classList.remove("active");
  } else {
    A.style.display = "none"; S.style.display = "block";
    bA.classList.remove("active"); bS.classList.add("active");
  }
}

/* ---------- Події ---------- */
document.addEventListener("DOMContentLoaded", () => {
  // Аналітика
  initSorting();
  $("#analyze")?.addEventListener("click", analyze);
  $("#export")?.addEventListener("click", () => {
    const rows = window.__rows || [];
    if (!rows.length) {
      $("#status").textContent = "Немає даних для експорту.";
      setStatus($("#status"), "muted");
      return;
    }
    const csv = toCSV(rows);
    toBlobAndDownload("vk_analytics.csv", csv, "text/csv;charset=utf-8");
  });
  $("#clear")?.addEventListener("click", () => {
    $("#urls").value = "";
    $("#tableWrap").style.display = "none";
    $("#totals").style.display = "none";
    $("#status").textContent = "Очищено.";
    setStatus($("#status"), "muted");
    showProgress(false);
    window.__rows = [];
    window.__totals = {};
  });

  // Пошук
  $("#searchBtn")?.addEventListener("click", searchPosts);
  $("#copyLinksBtn")?.addEventListener("click", copyAllLinks);

  // Tabs
  $("#tabAnalytics")?.addEventListener("click", () => switchTab("analytics"));
  $("#tabSearch")?.addEventListener("click", () => switchTab("search"));
});
