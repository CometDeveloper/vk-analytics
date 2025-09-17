/* ===== Constants (URLs, defaults, columns) ===== */
export const PROXY_API = "https://vk-analytics-worker.s49254177.workers.dev/vk";

export const DEFAULTS = {
  apiVersion: "5.199",
  batchSize: 100,
};

export const INITIAL_SORT = { key: "views", dir: "desc" };

/* Ключі колонок повинні збігатися з data-sort у thead */
export const COLUMNS = [
  { key: "url",            label: "Пост",        sortable: false },
  { key: "group_members",  label: "Охоплення",   sortable: true  },
  { key: "views",          label: "Перегляди",   sortable: true  },
  { key: "comments",       label: "Коментарі",   sortable: true  },
  { key: "likes",          label: "Реакції",     sortable: true  },
  { key: "reposts",        label: "Поширення",   sortable: true  },
];
