/* ===== UI helpers: progress, table render, totals ===== */
import { $, fmt } from "./utils.js";

/* Прогрес */
export function showProgress(show) {
  const wrap = $("#progress");
  if (!wrap) return;
  wrap.style.display = show ? "block" : "none";
  if (show) setProgress(0, "Готуємося…");
}
export function setProgress(percent, text) {
  const fill = $("#progressFill");
  const txt  = $("#progressText");
  if (!fill || !txt) return;
  const p = Math.max(0, Math.min(100, Math.round(percent)));
  fill.style.width = `${p}%`;
  txt.textContent = text || `${p}%`;
}

/* Рендер підсумків */
export function renderTotals(totals, meta = { missing: 0 }) {
  $("#totals .posts").textContent    = fmt(totals.posts);
  $("#totals .missing").textContent  = fmt(meta.missing || 0);
  $("#totals .reach").textContent    = fmt(totals.uniqueReach);
  $("#totals .views").textContent    = fmt(totals.views);
  $("#totals .comments").textContent = fmt(totals.comments);
  $("#totals .likes").textContent    = fmt(totals.likes);
  $("#totals .reposts").textContent  = fmt(totals.reposts);
  $("#totals").style.display = "block";
}

/* Рендер рядків таблиці */
export function renderTableBody(rows) {
  const tbody = document.querySelector("#table tbody");
  tbody.innerHTML = "";
  for (const r of rows) {
    const tr = document.createElement("tr");
    if (r.error) tr.classList.add("error-row");
    tr.innerHTML = `
      <td class="url"><a href="${r.url}" target="_blank" rel="noopener">${r.url}</a></td>
      <td class="right">${fmt(r.group_members || 0)}</td>
      <td class="right">${fmt(r.views)}</td>
      <td class="right">${fmt(r.comments)}</td>
      <td class="right">${fmt(r.likes)}</td>
      <td class="right">${fmt(r.reposts)}</td>
    `;
    tbody.appendChild(tr);
  }
  document.getElementById("tableWrap").style.display = rows.length ? "block" : "none";
}
