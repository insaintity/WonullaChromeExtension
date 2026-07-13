const STORAGE_KEYS = {
  lastWatch: "wonulla:lastWatch",
  history: "wonulla:history",
  seriesLatest: "wonulla:seriesLatest"
};

function formatSeconds(value) {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function relativeDate(timestamp) {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function openUrl(url) {
  chrome.tabs.create({ url });
}

function recordLabel(record) {
  if (record.series) {
    return `${record.series.seriesTitle} ${record.series.episodeLabel}`;
  }
  return record.sourceLabel || "Page video";
}

function renderHistory(records) {
  const wrapper = document.getElementById("history");
  const list = document.getElementById("history-list");
  list.textContent = "";

  records.slice(0, 6).forEach((record) => {
    const item = document.createElement("a");
    item.href = record.rawUrl || record.url;
    item.className = "history-item";
    item.addEventListener("click", (event) => {
      event.preventDefault();
      openUrl(record.rawUrl || record.url);
    });

    const title = document.createElement("div");
    title.className = "history-title";
    title.textContent = record.title || "Untitled video";

    const time = document.createElement("div");
    time.className = "history-time";
    time.textContent = `${recordLabel(record)} - ${formatSeconds(record.currentTime)} saved ${relativeDate(record.updatedAt)}`;

    item.append(title, time);
    list.append(item);
  });

  wrapper.hidden = records.length === 0;
}

async function init() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.lastWatch,
    STORAGE_KEYS.history,
    STORAGE_KEYS.seriesLatest
  ]);
  const last = result[STORAGE_KEYS.lastWatch];
  const seriesLatest = result[STORAGE_KEYS.seriesLatest] || {};
  const history = Object.values(result[STORAGE_KEYS.history] || {})
    .filter((record) => {
      if (!record.series) return true;
      const latest = seriesLatest[record.series.seriesKey];
      return !latest || latest.key === record.key;
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  document.getElementById("empty").hidden = Boolean(last);
  document.getElementById("last").hidden = !last;

  if (last) {
    document.getElementById("title").textContent = last.title || "Untitled video";
    document.getElementById("source").textContent = recordLabel(last);
    document.getElementById("time").textContent = last.duration
      ? `${formatSeconds(last.currentTime)} / ${formatSeconds(last.duration)}`
      : formatSeconds(last.currentTime);
    document.getElementById("updated").textContent = relativeDate(last.updatedAt);
    document.getElementById("progress").value = Math.max(0, Math.min(1, last.progress || 0));
    document.getElementById("open").addEventListener("click", () => openUrl(last.rawUrl || last.url));
  }

  renderHistory(history.filter((record) => !last || record.key !== last.key));
}

init();
