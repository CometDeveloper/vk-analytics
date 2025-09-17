/* ===== VK API calls (via Worker proxy) + normalization ===== */
import { PROXY_API } from "./constants.js";

/* Виклик VK API через проксі-воркер */
export async function vk(method, params, version) {
  const q = new URLSearchParams({ ...params });
  if (version) q.set("v", version);
  const res = await fetch(`${PROXY_API}/${method}?${q.toString()}`);
  const data = await res.json();
  if (data.error) throw new Error(`VK API error ${data.error.error_code}: ${data.error.error_msg}`);
  return data.response;
}

/* ✅ НОВЕ: приймаємо або масив, або {items: [...] } */
export function normalizeWallGetById(resp) {
  const list = Array.isArray(resp)
    ? resp
    : resp && Array.isArray(resp.items)
      ? resp.items
      : [];

  return list.map((p) => {
    const views    = Number(p?.views?.count    ?? 0);
    const likes    = Number(p?.likes?.count    ?? 0);
    const comments = Number(p?.comments?.count ?? 0);
    const reposts  = Number(p?.reposts?.count  ?? 0);

    return {
      key: `${p.owner_id}_${p.id}`,
      url: `https://vk.com/wall${p.owner_id}_${p.id}`,
      owner_id: Number(p.owner_id),
      post_id: Number(p.id),
      views,
      likes,
      comments,
      reposts,
      group_members: 0,  // додамо пізніше з groups.getById
      error: null,
    };
  });
}

/* map group_id → members_count */
export function normalizeGroupsGetById(response) {
  const resp = response.groups;
  
  const list = Array.isArray(resp)
    ? resp
    : resp && Array.isArray(resp.items)
      ? resp.items
      : [];
  const map = {};
  for (const g of list) map[g.id] = Number(g.members_count ?? 0);
  return map;
}

export async function fetchSinglePost(key, version) {
  try {
    const resp = await vk("wall.getById", { posts: key }, version);
    const arr = normalizeWallGetById(resp);
    if (arr.length) return { ok: true, post: arr[0] };
    return { ok: false, key, error: "Not found" };
  } catch (e) {
    return { ok: false, key, error: e.message || String(e) };
  }
}

export async function fetchPosts(keys, version, batchSize, onProgress) {
  const rows = [];
  const bad = [];
  for (let i = 0; i < keys.length; i += batchSize) {
    const part = keys.slice(i, i + batchSize);
    onProgress?.((i / keys.length) * 50, `Отримуємо пости ${i + 1}–${i + part.length}…`);
    try {
      const resp = await vk("wall.getById", { posts: part.join(",") }, version);
      rows.push(...normalizeWallGetById(resp));
    } catch (e) {
      for (const k of part) {
        const r = await fetchSinglePost(k, version);
        if (r.ok) rows.push(r.post);
        else bad.push({ key: k, error: r.error });
      }
    }
  }
  return { rows, bad };
}

export async function fetchGroupsMembersCounts(rows, version, onProgress) {
  const groupIds = Array.from(
    new Set(
      rows
        .map((r) => r.owner_id)
        .filter((id) => id < 0)
        .map((id) => Math.abs(id)),
    ),
  );
  const out = {};
  for (let i = 0; i < groupIds.length; i += 500) {
    const part = groupIds.slice(i, i + 500);
    onProgress?.(50 + (i / groupIds.length) * 30, `Отримуємо підписників груп ${i + 1}–${i + part.length}…`);
    try {
      const resp = await vk("groups.getById", { group_ids: part.join(","), fields: "members_count" }, version);
      Object.assign(out, normalizeGroupsGetById(resp));
    } catch (_) {}
  }
  return out;
}

export function sumTotals(rows, groupMembersMap) {
  const totals = { posts: rows.length, views: 0, likes: 0, comments: 0, reposts: 0, uniqueReach: 0 };
  for (const r of rows) {
    totals.views    += Number(r.views)    || 0;
    totals.likes    += Number(r.likes)    || 0;
    totals.comments += Number(r.comments) || 0;
    totals.reposts  += Number(r.reposts)  || 0;
  }
  const ids = new Set(rows.filter((r) => r.owner_id < 0).map((r) => Math.abs(r.owner_id)));
  ids.forEach((gid) => (totals.uniqueReach += Number(groupMembersMap[gid] || 0)));
  return totals;
}
