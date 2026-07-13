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
    minSaveSeconds: 0,
    saveIntervalSeconds: 1,
    trackingDefaultsVersion: 3
  };

  let activeVideo = null;
  let lastSavedAt = 0;
  let promptShownForKey = "";
  let welcomeShownForRecord = "";
  let saveTimer = null;
  let routeSignature = location.href;
  const pendingResumeKey = "wonulla:pendingResume";

  function storageGet(keys) {
    return chrome.storage.local.get(keys);
  }

  function storageSet(values) {
    return chrome.storage.local.set(values);
  }

  async function getSettings() {
    const result = await storageGet(STORAGE_KEYS.settings);
    const stored = result[STORAGE_KEYS.settings] || {};
    const settings = {
      ...DEFAULT_SETTINGS,
      ...stored
    };

    if (stored.trackingDefaultsVersion !== DEFAULT_SETTINGS.trackingDefaultsVersion) {
      if (!stored.trackingDefaultsVersion || stored.minSaveSeconds === 10 || stored.minSaveSeconds === 30) {
        settings.minSaveSeconds = DEFAULT_SETTINGS.minSaveSeconds;
      }
      if (!stored.trackingDefaultsVersion || stored.saveIntervalSeconds === 5 || stored.saveIntervalSeconds === 10) {
        settings.saveIntervalSeconds = DEFAULT_SETTINGS.saveIntervalSeconds;
      }
      settings.trackingDefaultsVersion = DEFAULT_SETTINGS.trackingDefaultsVersion;
      storageSet({ [STORAGE_KEYS.settings]: settings });
    }

    return settings;
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

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function isGenericTitle(value) {
    return /^(wonulla|home|movies|tv shows?|watch|search|seasons?|episodes?|untitled video)$/i.test(cleanText(value));
  }

  function isRejectedTitle(value) {
    const text = cleanText(value);
    return (
      !text ||
      isGenericTitle(text) ||
      /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text) ||
      /^(season\s+\d+|\d+|air date[:\s].*)$/i.test(text) ||
      /\b(add to favorites|watch later|download|logout|sign out|profile|account|my name)\b/i.test(text)
    );
  }

  function isVisibleElement(element) {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function metaContent(selector) {
    const node = document.querySelector(selector);
    return node ? cleanText(node.getAttribute("content")) : "";
  }

  function candidateTitleElements() {
    return Array.from(
      document.querySelectorAll(
        [
          "h1",
          "h2",
          "h3",
          "[class*='title' i]",
          "[class*='name' i]",
          "[class*='movie' i]",
          "[class*='show' i]",
          "[class*='series' i]"
        ].join(",")
      )
    )
      .filter(isVisibleElement)
      .map((element) => cleanText(element.textContent))
      .filter((text) => text.length >= 2 && text.length <= 140 && !isRejectedTitle(text));
  }

  function pageTitle() {
    const candidates = [
      ...candidateTitleElements(),
      metaContent("meta[property='og:title']"),
      metaContent("meta[name='twitter:title']"),
      document.title,
      titleFromUrl()
    ].filter((text) => text && !isRejectedTitle(text));

    return candidates[0] || "Untitled video";
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

  function visibleAppText() {
    const root = document.getElementById("root") || document.body;
    return cleanText((root && root.innerText) || "").slice(0, 6000);
  }

  function visibleAppLines() {
    const root = document.getElementById("root") || document.body;
    return String((root && root.innerText) || "")
      .split(/\r?\n/)
      .map(cleanText)
      .filter(Boolean)
      .slice(0, 300);
  }

  function routeText() {
    return cleanText(
      decodeURIComponent(`${location.pathname} ${location.search}`)
        .replace(/[/?#=&_.+-]+/g, " ")
        .replace(/\b\d{4,}\b/g, " ")
    );
  }

  function episodeSearchTexts() {
    const activeTexts = Array.from(
      document.querySelectorAll(
        [
          "[aria-current='true']",
          "[aria-selected='true']",
          "[class*='active' i]",
          "[class*='selected' i]",
          "[class*='current' i]",
          "video"
        ].join(",")
      )
    )
      .map((element) => cleanText(element.textContent || element.getAttribute("aria-label") || element.title))
      .filter(Boolean);

    return [
      pageTitle(),
      routeText(),
      ...activeTexts,
      visibleAppText()
    ].filter(Boolean);
  }

  function stripEpisodeMarker(value, marker) {
    return cleanText(value)
      .replace(marker, " ")
      .replace(/\bS(?:eason)?\s*\d{1,2}\b/gi, " ")
      .replace(/\bEpisode\s*\d{1,3}\b/gi, " ")
      .replace(/\bEp\.?\s*\d{1,3}\b/gi, " ")
      .replace(/\b\d{1,2}\s*x\s*\d{1,3}\b/gi, " ")
      .replace(/\s*[-:|]\s*$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function titleFromEpisodeText(text, marker) {
    const markerIndex = text.toLowerCase().indexOf(marker.toLowerCase());
    if (markerIndex <= 0) return "";

    return stripEpisodeMarker(text.slice(0, markerIndex), marker)
      .split(/\b(?:watch|stream|play|season)\b/i)
      .pop()
      .trim();
  }

  function seriesTitleFromEpisodeMatch(text, marker) {
    const candidates = [
      titleFromEpisodeText(text, marker),
      stripEpisodeMarker(pageTitle(), marker),
      stripEpisodeMarker(titleFromUrl(), marker),
      stripEpisodeMarker(routeText(), marker)
    ].filter((candidate) => candidate && !isRejectedTitle(candidate));

    const selected = candidates.find((candidate) => candidate.length >= 2 && candidate.length <= 100);
    return selected || pageTitle() || "Unknown series";
  }

  function episodeTitleFromCandidates(seriesTitle) {
    const seriesKey = normalizeSeriesText(seriesTitle);
    const candidates = candidateTitleElements()
      .filter((candidate) => normalizeSeriesText(candidate) !== seriesKey)
      .filter((candidate) => !/^season\s+\d+/i.test(candidate));

    return candidates[candidates.length - 1] || "";
  }

  function episodeTitleFromLines(season, episode, seriesTitle) {
    const lines = visibleAppLines();
    const seasonEpisodePattern = new RegExp(`^Season\\s*${season}\\s*,?\\s*Episode\\s*${episode}$`, "i");
    const numberedEpisodePattern = new RegExp(`^${episode}\\s+(.+)$`);
    const seriesKey = normalizeSeriesText(seriesTitle);

    for (let index = 0; index < lines.length; index += 1) {
      if (seasonEpisodePattern.test(lines[index])) {
        const previous = lines[index - 1] || "";
        if (!isRejectedTitle(previous) && normalizeSeriesText(previous) !== seriesKey) {
          return previous;
        }
      }

      const numberedMatch = lines[index].match(numberedEpisodePattern);
      if (numberedMatch && !isRejectedTitle(numberedMatch[1])) {
        return numberedMatch[1];
      }
    }

    return "";
  }

  function parseEpisodeInfo() {
    const patterns = [
      /\bS(?:eason)?\s*(\d{1,2})\s*E(?:p(?:isode)?)?\s*(\d{1,3})\b/i,
      /\b(\d{1,2})\s*x\s*(\d{1,3})\b/i,
      /\bSeason\s*(\d{1,2})\D{0,24}Episode\s*(\d{1,3})\b/i,
      /\bSeason\s*(\d{1,2})\b[\s\S]{0,160}?\b(?:Episode|Ep\.?)\s*(\d{1,3})\b/i,
      /\bEpisode\s*(\d{1,3})\b/i,
      /\bEp\.?\s*(\d{1,3})\b/i
    ];

    let match = null;
    let season = 1;
    let episode = 0;
    let matchedText = "";

    for (const text of episodeSearchTexts()) {
      for (const pattern of patterns) {
        match = text.match(pattern);
        if (!match) continue;

        if (match.length >= 3) {
          season = Number(match[1]) || 1;
          episode = Number(match[2]) || 0;
        } else {
          episode = Number(match[1]) || 0;
        }
        matchedText = text;
        break;
      }
      if (match) break;
    }

    if (!match || !episode) return null;

    const marker = match[0];
    const seriesTitle = seriesTitleFromEpisodeMatch(matchedText, marker);
    const episodeTitle = episodeTitleFromLines(season, episode, seriesTitle) || episodeTitleFromCandidates(seriesTitle);

    return {
      seriesKey: `series:${normalizeSeriesText(seriesTitle)}`,
      seriesTitle,
      episodeTitle,
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

  function recordDisplayLabel(record) {
    if (record && record.series) {
      return `${record.series.seriesTitle} ${record.series.episodeLabel}`;
    }
    return (record && record.sourceLabel) || "Page video";
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
    const currentTime = Number(video.currentTime) || 0;
    const duration = Number.isFinite(video.duration) ? Number(video.duration) : 0;
    const now = Date.now();

    if (!force) {
      if (currentTime < settings.minSaveSeconds) return;
      if (now - lastSavedAt < settings.saveIntervalSeconds * 1000) return;
    }

    const series = parseEpisodeInfo();
    const record = {
      key: mediaKey(video),
      url: canonicalUrl(),
      rawUrl: location.href,
      title: (series && series.episodeTitle) || pageTitle(),
      sourceUrl: sourceUrl(video),
      sourceLabel: sourceLabel(video),
      series,
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

  function sameSavedPage(record) {
    return record && record.url === canonicalUrl();
  }

  function savePendingResume(record) {
    try {
      sessionStorage.setItem(
        pendingResumeKey,
        JSON.stringify({
          key: record.key,
          url: record.url,
          currentTime: record.currentTime,
          createdAt: Date.now()
        })
      );
    } catch {
      // Session storage can be blocked; the normal continue prompt will still appear.
    }
  }

  function getPendingResume() {
    try {
      const value = JSON.parse(sessionStorage.getItem(pendingResumeKey) || "null");
      if (!value || Date.now() - value.createdAt > 5 * 60 * 1000) {
        sessionStorage.removeItem(pendingResumeKey);
        return null;
      }
      return value;
    } catch {
      sessionStorage.removeItem(pendingResumeKey);
      return null;
    }
  }

  function clearPendingResume() {
    try {
      sessionStorage.removeItem(pendingResumeKey);
    } catch {
      // Ignore unavailable session storage.
    }
  }

  function continueWatching(record) {
    if (!record) return;

    if (sameSavedPage(record)) {
      const video = currentVideo();
      if (video) {
        seekVideo(video, record.currentTime);
      } else {
        savePendingResume(record);
      }
      removeWelcomeBack();
      return;
    }

    savePendingResume(record);
    location.assign(record.rawUrl || record.url);
  }

  function applyPendingResume(video) {
    const pending = getPendingResume();
    if (!pending || !video) return false;
    if (pending.url !== canonicalUrl()) return false;

    seekVideo(video, pending.currentTime);
    clearPendingResume();
    removeWelcomeBack();
    return true;
  }

  function showWelcomeBack(record) {
    if (!record || welcomeShownForRecord === `${record.key}:${record.updatedAt}`) return;
    removeWelcomeBack();
    welcomeShownForRecord = `${record.key}:${record.updatedAt}`;

    const backdrop = document.createElement("div");
    backdrop.id = "wonulla-watch-tracker-welcome";
    backdrop.style.cssText = [
      "position:fixed",
      "inset:0",
      "z-index:2147483647",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:18px",
      "background:rgba(0,0,0,.45)",
      "font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
    ].join(";");

    const root = document.createElement("div");
    root.style.cssText = [
      "position:relative",
      "width:min(460px,calc(100vw - 36px))",
      "color:#f8fafc",
      "background:#111827",
      "border:1px solid rgba(255,255,255,.16)",
      "box-shadow:0 12px 40px rgba(0,0,0,.35)",
      "border-radius:8px",
      "padding:16px"
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
    message.textContent = `You were last watching ${record.title || "Untitled video"} at ${formatSeconds(record.currentTime)}.`;
    message.style.cssText = "font-size:16px;font-weight:700;margin-right:28px";

    const detail = document.createElement("div");
    detail.textContent = `${recordDisplayLabel(record)} saved ${relativeDate(record.updatedAt)}`;
    detail.style.cssText = "margin-top:6px;color:#cbd5e1;font-size:12px";

    const question = document.createElement("div");
    question.textContent = "Want to continue?";
    question.style.cssText = "margin-top:12px;color:#f8fafc";

    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:16px";

    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "No";
    no.style.cssText = "cursor:pointer;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:8px 12px;background:transparent;color:#f8fafc;font-weight:700";
    no.addEventListener("click", removeWelcomeBack);

    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "Yes";
    yes.style.cssText = "cursor:pointer;border:0;border-radius:6px;padding:8px 14px;background:#38bdf8;color:#082f49;font-weight:800";
    yes.addEventListener("click", () => continueWatching(record));

    actions.append(no, yes);
    root.append(close, title, message, detail, question, actions);
    backdrop.append(root);
    document.documentElement.append(backdrop);
  }

  async function maybeShowWelcomeBack() {
    const pending = getPendingResume();
    if (pending && pending.url === canonicalUrl()) return;

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
    if (applyPendingResume(video)) return;

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
