(function () {
  const STORAGE_KEYS = {
    lastWatch: "wonulla:lastWatch",
    history: "wonulla:history",
    seriesLatest: "wonulla:seriesLatest",
    settings: "wonulla:settings"
  };

  const DEFAULT_SETTINGS = {
    autoResume: false,
    promptResume: true,
    minSaveSeconds: 10,
    saveIntervalSeconds: 5
  };

  let activeVideo = null;
  let lastSavedAt = 0;
  let promptShownForKey = "";
  let welcomeShownForRecord = "";
  let saveTimer = null;
  let routeSignature = location.href;

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(values) {
    return chrome.storage.local.set(values);
  }

  function getSettings() {
    return storageGet(STORAGE_KEYS.settings).then((result) => ({
      ...DEFAULT_SETTINGS,
      ...(result[STORAGE_KEYS.settings] || {})
    }));
  }

  function canonicalUrl() {
    const url = new URL(location.href);
    url.hash = "";
    const noisyParams = ["t", "time", "utm_source", "utm_medium", "utm_campaign"];
    noisyParams.forEach((param) => url.searchParams.delete(param));
    return url.toString();
  }

  function sourceUrl(video) {
    if (!video) return "";

    const source =
      video.currentSrc ||
      video.src ||
      (video.querySelector("source") && video.querySelector("source").src) ||
      "";

    if (!source || source.startsWith("blob:")) return "";

    try {
      return new URL(source, location.href).toString();
    } catch {
      return source;
    }
  }

  function mediaKey(video) {
    const source = sourceUrl(video);
    return source ? `${canonicalUrl()}::${source}` : canonicalUrl();
  }

  function sourceLabel(video) {
    const source = sourceUrl(video);
    if (!source) return "Page video";

    try {
      const url = new URL(source);
      const fileName = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      return fileName || url.hostname || "Video source";
    } catch {
      return source.split("/").filter(Boolean).pop() || "Video source";
    }
  }

  function pageTitle() {
    const heading = document.querySelector("h1, h2, [class*='title' i]");
    const text = heading && heading.textContent ? heading.textContent.trim() : "";
    return text || document.title || "Untitled video";
  }

  function normalizeSeriesText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[_+.]+/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[^a-z0-9 ]+/g, "")
      .trim();
  }

  function titleFromUrl() {
    const parts = location.pathname
      .split("/")
      .map((part) => decodeURIComponent(part).replace(/[-_+.]+/g, " ").trim())
      .filter(Boolean);

    return parts.length > 0 ? parts[parts.length - 1] : "";
  }

  function parseEpisodeInfo() {
    const title = pageTitle();
    const urlText = titleFromUrl();
    const combined = `${title} ${urlText}`;
    const patterns = [
      /\bS(?:eason)?\s*(\d{1,2})\s*E(?:p(?:isode)?)?\s*(\d{1,3})\b/i,
      /\b(\d{1,2})\s*x\s*(\d{1,3})\b/i,
      /\bSeason\s*(\d{1,2})\D{0,24}Episode\s*(\d{1,3})\b/i,
      /\bEpisode\s*(\d{1,3})\b/i,
      /\bEp\.?\s*(\d{1,3})\b/i
    ];

    let match = null;
    let season = 1;
    let episode = 0;

    for (const pattern of patterns) {
      match = combined.match(pattern);
      if (!match) continue;

      if (match.length >= 3) {
        season = Number(match[1]) || 1;
        episode = Number(match[2]) || 0;
      } else {
        episode = Number(match[1]) || 0;
      }
      break;
    }

    if (!match || !episode) return null;

    const marker = match[0];
    const markerIndex = title.toLowerCase().indexOf(marker.toLowerCase());
    const rawSeriesTitle = markerIndex > 0 ? title.slice(0, markerIndex) : title;
    const seriesTitle =
      rawSeriesTitle
        .replace(/\s*[-:|]\s*$/g, "")
        .replace(/\bS(?:eason)?\s*\d{1,2}\s*$/i, "")
        .trim() ||
      document.title.replace(marker, "").replace(/\s*[-:|]\s*$/g, "").trim() ||
      "Unknown series";

    return {
      seriesKey: `series:${normalizeSeriesText(seriesTitle)}`,
      seriesTitle,
      season,
      episode,
      episodeSort: season * 1000 + episode,
      episodeLabel: `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`
    };
  }

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

  function bestVideo() {
    const videos = Array.from(document.querySelectorAll("video"));
    if (videos.length === 0) return null;

    return videos
      .map((video) => ({
        video,
        score:
          (video.duration && Number.isFinite(video.duration) ? video.duration : 0) +
          (video.clientWidth * video.clientHeight) / 1000 +
          (!video.paused ? 100000 : 0)
      }))
      .sort((a, b) => b.score - a.score)[0].video;
  }

  function currentVideo() {
    if (activeVideo && activeVideo.isConnected) return activeVideo;
    return bestVideo();
  }

  async function saveProgress(force = false) {
    const video = currentVideo();
    if (!video || Number.isNaN(video.currentTime)) return;

    const settings = await getSettings();
    const currentTime = Math.floor(video.currentTime || 0);
    const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
    const now = Date.now();

    if (!force) {
      if (currentTime < settings.minSaveSeconds) return;
      if (now - lastSavedAt < settings.saveIntervalSeconds * 1000) return;
    }

    const record = {
      key: mediaKey(video),
      url: canonicalUrl(),
      rawUrl: location.href,
      title: pageTitle(),
      sourceUrl: sourceUrl(video),
      sourceLabel: sourceLabel(video),
      series: parseEpisodeInfo(),
      currentTime,
      duration,
      progress: duration > 0 ? currentTime / duration : 0,
      updatedAt: now
    };

    const result = await storageGet([STORAGE_KEYS.history, STORAGE_KEYS.seriesLatest]);
    const history = result[STORAGE_KEYS.history] || {};
    const seriesLatest = result[STORAGE_KEYS.seriesLatest] || {};

    if (record.series) {
      const previous = seriesLatest[record.series.seriesKey];
      const canReplace =
        !previous ||
        record.series.episodeSort >= ((previous.series && previous.series.episodeSort) || 0) ||
        previous.key === record.key;

      if (canReplace) {
        Object.values(history).forEach((existing) => {
          if (
            existing &&
            existing.series &&
            existing.series.seriesKey === record.series.seriesKey &&
            existing.key !== record.key
          ) {
            delete history[existing.key];
          }
        });
        seriesLatest[record.series.seriesKey] = record;
      }
    }

    history[record.key] = record;
    await storageSet({
      [STORAGE_KEYS.lastWatch]: record,
      [STORAGE_KEYS.history]: history,
      [STORAGE_KEYS.seriesLatest]: seriesLatest
    });
    lastSavedAt = now;
  }

  function removeWelcomeBack() {
    const existing = document.getElementById("wonulla-watch-tracker-welcome");
    if (existing) existing.remove();
  }

  function showWelcomeBack(record) {
    if (!record || welcomeShownForRecord === `${record.key}:${record.updatedAt}`) return;
    removeWelcomeBack();
    welcomeShownForRecord = `${record.key}:${record.updatedAt}`;

    const root = document.createElement("div");
    root.id = "wonulla-watch-tracker-welcome";
    root.style.cssText = [
      "position:fixed",
      "left:50%",
      "top:16px",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "width:min(520px,calc(100vw - 32px))",
      "font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "color:#f8fafc",
      "background:#111827",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 12px 40px rgba(0,0,0,.35)",
      "border-radius:8px",
      "padding:12px 42px 12px 14px"
    ].join(";");

    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss welcome back message");
    close.textContent = "x";
    close.style.cssText = [
      "position:absolute",
      "right:10px",
      "top:8px",
      "width:26px",
      "height:26px",
      "cursor:pointer",
      "border:1px solid rgba(255,255,255,.2)",
      "border-radius:6px",
      "background:transparent",
      "color:#f8fafc",
      "font-weight:700"
    ].join(";");
    close.addEventListener("click", removeWelcomeBack);

    const title = document.createElement("div");
    title.textContent = "Welcome back";
    title.style.cssText = "font-size:12px;font-weight:800;text-transform:uppercase;color:#93c5fd;margin-bottom:3px";

    const message = document.createElement("div");
    message.textContent = `You last watched ${record.title || "Untitled video"} at ${formatSeconds(record.currentTime)}.`;
    message.style.cssText = "font-weight:700";

    const detail = document.createElement("div");
    const sourceDetail = record.series
      ? `${record.series.seriesTitle} ${record.series.episodeLabel}`
      : record.sourceLabel || "Page video";
    detail.textContent = `${sourceDetail} saved ${relativeDate(record.updatedAt)}`;
    detail.style.cssText = "margin-top:3px;color:#cbd5e1;font-size:12px";

    root.append(close, title, message, detail);
    document.documentElement.append(root);

    window.setTimeout(() => {
      if (root.isConnected) root.remove();
    }, 9000);
  }

  async function maybeShowWelcomeBack() {
    const result = await storageGet(STORAGE_KEYS.lastWatch);
    const record = result[STORAGE_KEYS.lastWatch];
    if (!record || !record.currentTime) return;
    showWelcomeBack(record);
  }

  function removePrompt() {
    const existing = document.getElementById("wonulla-watch-tracker-prompt");
    if (existing) existing.remove();
  }

  function showPrompt(record, video) {
    removePrompt();

    const root = document.createElement("div");
    root.id = "wonulla-watch-tracker-prompt";
    root.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "z-index:2147483647",
      "max-width:320px",
      "font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "color:#f8fafc",
      "background:#111827",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 12px 40px rgba(0,0,0,.35)",
      "border-radius:8px",
      "padding:12px"
    ].join(";");

    const message = document.createElement("div");
    message.textContent = `Resume from ${formatSeconds(record.currentTime)}?`;
    message.style.cssText = "margin-bottom:10px;font-weight:600";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";

    const resume = document.createElement("button");
    resume.type = "button";
    resume.textContent = "Resume";
    resume.style.cssText = "cursor:pointer;border:0;border-radius:6px;padding:7px 10px;background:#38bdf8;color:#082f49;font-weight:700";
    resume.addEventListener("click", () => {
      seekVideo(video, record.currentTime);
      removePrompt();
    });

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.style.cssText = "cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:7px 10px;background:transparent;color:#f8fafc";
    dismiss.addEventListener("click", removePrompt);

    actions.append(dismiss, resume);
    root.append(message, actions);
    document.documentElement.append(root);
  }

  function matchingRecord(video, history) {
    const exact = history[mediaKey(video)];
    if (exact) return exact;

    const pageUrl = canonicalUrl();
    return Object.values(history)
      .filter((record) => !record.series && (record.url === pageUrl || record.key === pageUrl))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
  }

  function seekVideo(video, seconds) {
    const target = Math.max(0, Number(seconds) || 0);
    const applySeek = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : target;
      video.currentTime = Math.min(target, Math.max(0, duration - 2));
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      applySeek();
    } else {
      video.addEventListener("loadedmetadata", applySeek, { once: true });
    }
  }

  async function maybeResume(video) {
    const key = mediaKey(video);
    if (promptShownForKey === key) return;

    const result = await storageGet([STORAGE_KEYS.history, STORAGE_KEYS.settings]);
    const history = result[STORAGE_KEYS.history] || {};
    const settings = {
      ...DEFAULT_SETTINGS,
      ...(result[STORAGE_KEYS.settings] || {})
    };
    const record = matchingRecord(video, history);

    if (!record || record.currentTime < settings.minSaveSeconds) return;
    if (record.duration > 0 && record.currentTime >= record.duration - 10) return;

    promptShownForKey = key;
    if (settings.autoResume) {
      seekVideo(video, record.currentTime);
    } else if (settings.promptResume) {
      showPrompt(record, video);
    }
  }

  function attachVideo(video) {
    if (!video || video === activeVideo) return;

    if (activeVideo) {
      activeVideo.removeEventListener("timeupdate", onTimeUpdate);
      activeVideo.removeEventListener("pause", onForceSave);
      activeVideo.removeEventListener("ended", onForceSave);
    }

    activeVideo = video;
    activeVideo.addEventListener("timeupdate", onTimeUpdate);
    activeVideo.addEventListener("pause", onForceSave);
    activeVideo.addEventListener("ended", onForceSave);
    maybeResume(activeVideo);
  }

  function onTimeUpdate() {
    saveProgress(false);
  }

  function onForceSave() {
    saveProgress(true);
  }

  function scan() {
    attachVideo(bestVideo());
  }

  function startInterval() {
    if (saveTimer) clearInterval(saveTimer);
    saveTimer = setInterval(() => {
      if (location.href !== routeSignature) {
        routeSignature = location.href;
        promptShownForKey = "";
        welcomeShownForRecord = "";
        removePrompt();
        maybeShowWelcomeBack();
        scan();
      }
      saveProgress(false);
    }, 2500);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener("beforeunload", () => {
    saveProgress(true);
  });

  scan();
  maybeShowWelcomeBack();
  startInterval();
})();
