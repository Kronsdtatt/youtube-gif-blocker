# YouTube GIF Blocker 🚫🎞️

> A lightweight Chrome/Firefox extension (Manifest V3) that **silently removes animated GIFs, image stickers, and media attachments** from YouTube comments, chat, and community posts.

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-MIT-orange)
![Browsers](https://img.shields.io/badge/browsers-Chrome%20%7C%20Edge%20%7C%20Brave%20%7C%20Firefox-blueviolet)

---

## What It Blocks

| Content type | Status |
|---|---|
| Classic `.gif` images | ✅ Blocked |
| Giphy / Tenor embeds | ✅ Blocked |
| YouTube Image Comments (stickers) | ✅ Blocked |
| Community post media attachments | ✅ Blocked |
| Live chat GIFs (`#chat`) | ✅ Blocked |
| **User avatars** | 🟢 Untouched |
| **YouTube emoji (`yt-emoji`)** | 🟢 Untouched |
| **Video thumbnails** | 🟢 Untouched |

---

## How It Works — Two Layers of Defense

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 1 — styles.css (declarative CSS)                      │
│  run_at: document_start → applied BEFORE rendering           │
│  display: none !important → hides GIFs instantly             │
└───────────────────────┬──────────────────────────────────────┘
                        │
┌───────────────────────▼──────────────────────────────────────┐
│  Layer 2 — content.js (JS + MutationObserver)                │
│                                                              │
│  • isGifElement()    — detects by src, data-src, style      │
│  • findMediaContainer() — removes the smallest container    │
│  • scheduleCleanup() — 80ms debounce, batches mutations     │
│  • scanAndRemove()   — batch removal via requestAnimFrame   │
│  • MutationObserver  — watches SPA navigation & scroll      │
│                                                              │
│  el.remove() → full DOM removal → GC frees animation RAM   │
└──────────────────────────────────────────────────────────────┘
```

### Key design decisions

- **No background service worker** — zero idle memory usage
- **`run_at: document_start`** — CSS loads before any GIF starts downloading
- **80ms debounce** — YouTube fires hundreds of mutations on virtual scroll; we batch them
- **`requestAnimationFrame` + batches of 20** — DOM removals spread across frames, no jank
- **`el.remove()`** instead of `display:none` in JS — full DOM removal frees decoded animation frames from memory

---

## Installation

### Chrome / Edge / Brave / Opera

1. Download this repository: **Code → Download ZIP** and unzip it
2. Open `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right corner)
4. Click **«Load unpacked»**
5. Select the unzipped `youtube-gif-blocker` folder
6. Done — open YouTube and enjoy clean comments 🎉

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **«Load Temporary Add-on…»**
3. Select the `manifest.json` file inside the unzipped folder

> **Note:** Temporary Firefox add-ons are removed on browser restart. For permanent installation, the extension needs to be signed via [Firefox Add-on Hub](https://addons.mozilla.org/developers/).

---

## Testing

### Quick test (2 minutes)

1. Open any YouTube video with comments
2. Open DevTools (`F12`) → Console
3. Type `allow pasting` and press Enter (one-time Chrome security step)
4. Paste and run:

```javascript
const gifs = document.querySelectorAll(
  'img[src*=".gif"], img[src*="giphy"], img[src*="tenor"], ytw-comment-image-attachment-view-model'
);
console.log('GIF elements remaining in DOM:', gifs.length); // should be 0
```

### Verify safe elements are untouched

```javascript
// Avatars should still be present:
document.querySelectorAll('yt-img-shadow[is-avatar] img').length; // > 0

// Video thumbnails should still be present:
document.querySelectorAll('ytd-thumbnail img').length; // > 0
```

### Test SPA navigation

1. Open any video with comments
2. Navigate to another video **without reloading** (click a recommendation)
3. Run the test again — counter should remain 0

---

## Project Structure

```
youtube-gif-blocker/
├── manifest.json   — MV3 extension config (minimal permissions)
├── styles.css      — CSS blocking layer
├── content.js      — JS blocking layer + MutationObserver
└── README.md       — this file
```

---

## Permissions

This extension requests **only one** permission type:

| Permission | Why |
|---|---|
| `host_permissions: *://*.youtube.com/*` | Inject CSS and JS only on YouTube pages |

**Not requested:** `storage`, `tabs`, `activeTab`, `scripting`, no network requests, no access to other sites.

---

## Browser Compatibility

| Browser | Support |
|---|---|
| Chrome 88+ | ✅ Full |
| Edge (Chromium) | ✅ Full |
| Brave | ✅ Full |
| Opera | ✅ Full |
| Firefox 109+ | ✅ Full (MV3 supported) |
| Safari | ❌ Requires separate conversion |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| GIF still visible after install | Hard reload the YouTube page (`Ctrl+Shift+R`) |
| Extension not appearing | Make sure you selected the folder containing `manifest.json` |
| Console errors | Open `chrome://extensions` → Details → View errors |
| Avatars disappeared | Open an issue — YouTube likely updated its markup |

---

## Contributing

PRs and issues are welcome! If YouTube updates its comment structure and stickers break through, please open an issue with:
- A screenshot of the visible GIF
- The output of this console snippet:
```javascript
[...document.querySelectorAll('ytd-comment-renderer img')]
  .map(img => `${img.src.slice(0,80)} | PARENT: ${img.parentElement?.tagName}`)
  .join('\n');
```

---

## License

MIT — free to use, modify, and distribute.
