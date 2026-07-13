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

const fields = {
  autoResume: document.getElementById("autoResume"),
  promptResume: document.getElementById("promptResume"),
  minSaveSeconds: document.getElementById("minSaveSeconds"),
  saveIntervalSeconds: document.getElementById("saveIntervalSeconds")
};

function setStatus(message) {
  const status = document.getElementById("status");
  status.textContent = message;
  window.clearTimeout(setStatus.timeout);
  setStatus.timeout = window.setTimeout(() => {
    status.textContent = "";
  }, 2500);
}

async function loadSettings() {
  const result = await chrome.storage.local.get(STORAGE_KEYS.settings);
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
    await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  }

  fields.autoResume.checked = settings.autoResume;
  fields.promptResume.checked = settings.promptResume;
  fields.minSaveSeconds.value = settings.minSaveSeconds;
  fields.saveIntervalSeconds.value = settings.saveIntervalSeconds;
}

async function saveSettings() {
  const settings = {
    autoResume: fields.autoResume.checked,
    promptResume: fields.promptResume.checked,
    minSaveSeconds: Math.max(0, Number(fields.minSaveSeconds.value) || DEFAULT_SETTINGS.minSaveSeconds),
    saveIntervalSeconds: Math.max(1, Number(fields.saveIntervalSeconds.value) || DEFAULT_SETTINGS.saveIntervalSeconds),
    trackingDefaultsVersion: DEFAULT_SETTINGS.trackingDefaultsVersion
  };

  if (settings.autoResume) {
    settings.promptResume = false;
    fields.promptResume.checked = false;
  }

  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  setStatus("Options saved.");
}

async function clearHistory() {
  await chrome.storage.local.remove([STORAGE_KEYS.lastWatch, STORAGE_KEYS.history, STORAGE_KEYS.seriesLatest]);
  setStatus("Watch history cleared.");
}

fields.autoResume.addEventListener("change", () => {
  if (fields.autoResume.checked) fields.promptResume.checked = false;
});

fields.promptResume.addEventListener("change", () => {
  if (fields.promptResume.checked) fields.autoResume.checked = false;
});

document.getElementById("save").addEventListener("click", saveSettings);
document.getElementById("clear").addEventListener("click", clearHistory);

loadSettings();
