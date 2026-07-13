# Wonulla Watch Tracker

A small Chrome extension that saves videos watched on `wonulla.to`, including the playback time, then welcomes you back with the last watched item when you return.

## Install locally

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder:

   `C:\Users\saint\Documents\Codex\2026-07-13\i-want-to-make-a-chrome`

## How it works

- The content script runs only on `wonulla.to` and subdomains.
- It watches the main `<video>` element on the page.
- By default, it starts tracking after 30 seconds watched and saves progress every 10 seconds.
- It keeps separate saved entries for multiple pages/video sources when the player exposes a source URL.
- For TV series, it recognizes common episode labels like `S01E03`, `1x03`, `Season 1 Episode 3`, and `Episode 3`.
- When a newer episode from the same series is saved, it replaces the older episode entry in the recent list.
- Progress is stored in `chrome.storage.local`.
- The popup shows the last watched item and recent saved pages.
- The site shows a short "Welcome back" message with the last title and timestamp.
- The options page can switch between resume prompt and automatic resume.

## Files

- `manifest.json` - Chrome extension manifest.
- `content.js` - Detects videos, saves playback progress, and resumes saved time.
- `popup.html`, `popup.css`, `popup.js` - Extension popup.
- `options.html`, `options.css`, `options.js` - Extension settings.
