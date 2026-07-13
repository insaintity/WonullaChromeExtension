# Wonulla Watch Tracker

Chrome extension for `wonulla.to` that remembers what you watched last and the playback time you stopped at.

It is built for local installation as an unpacked Chrome extension.

## Features

- Tracks videos on `wonulla.to` and subdomains.
- Starts saving after 30 seconds watched.
- Updates saved playback progress every 10 seconds.
- Shows a continue-watching prompt on the site with the last watched title and timestamp.
- Stores recent watch history in the extension popup.
- Detects common TV episode formats such as `S01E03`, `1x03`, `Season 1 Episode 3`, `Episode 3`, and `Ep 3`.
- Replaces older entries from the same TV series when a newer episode is watched.
- Stores data locally with `chrome.storage.local`.

## Install

### Option 1: Download ZIP

1. Open this repository on GitHub.
2. Click **Code**.
3. Click **Download ZIP**.
4. Extract the ZIP somewhere permanent, such as:

   ```text
   C:\Users\YourName\Documents\WonullaChromeExtension
   ```

5. Open Chrome and go to:

   ```text
   chrome://extensions
   ```

6. Turn on **Developer mode** in the top right.
7. Click **Load unpacked**.
8. Select the extracted extension folder.

### Option 2: Git clone

```bash
git clone https://github.com/insaintity/WonullaChromeExtension.git
```

Then load the cloned folder from `chrome://extensions` using **Load unpacked**.

## Update

If you installed with Git:

```bash
git pull
```

Then open `chrome://extensions` and click the reload icon on **Wonulla Watch Tracker**.

If you installed from ZIP, download the newest ZIP, replace the old folder, then reload the extension in `chrome://extensions`.

## Use

1. Open a video on `wonulla.to`.
2. Watch for at least 30 seconds.
3. The extension saves your current timestamp every 10 seconds.
4. Click the extension icon to see your last watched video and recent entries.
5. When you return to `wonulla.to`, the page asks whether you want to continue from your last saved title and time.
6. Click **Yes** to open the saved page and seek back to the saved timestamp.

## Options

Open the extension options page to change:

- Prompt before resuming saved progress.
- Resume automatically.
- Minimum watch time before saving.
- Save interval while watching.
- Clear watch history.

## Troubleshooting

If progress is not saving:

1. Reload the extension from `chrome://extensions`.
2. Refresh the `wonulla.to` tab.
3. Watch for at least 30 seconds.
4. Open the extension popup and check whether an entry appears.

If TV episodes are not grouped correctly, the page may not expose clear episode text. The extension checks the rendered app text, selected episode controls, metadata, and URL, but unusual page labels can still need a parser tweak.

## Project Files

- `manifest.json` - Chrome extension manifest.
- `content.js` - Detects videos, saves progress, detects episodes, and resumes saved time.
- `popup.html`, `popup.css`, `popup.js` - Extension popup.
- `options.html`, `options.css`, `options.js` - Extension settings.
