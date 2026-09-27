# Shinkansen Site adapter

This folder lets the existing `translate-doc` UI run in a normal browser / ChatGPT Site context while preserving the extension build.

## Entry point

Serve `../translate-doc/index.html` with the repository directory structure intact.

`translate-doc/index.html` loads `site/chrome-shim.js` first. In a real Chrome/Safari/Firefox extension, the shim sees the real `chrome.runtime.id` and exits immediately. In a normal web page it provides only the APIs used by the document translator:

- `chrome.storage.local` / `sync` backed by IndexedDB
- `chrome.storage.onChanged`
- `chrome.runtime.getManifest()` / `getURL()` / `sendMessage()`
- `chrome.tabs.create()` mapped to `window.open()`

The Site message bridge currently implements the Gemini document path:

- `TRANSLATE_DOC_BATCH`
- `EXTRACT_GLOSSARY`
- `SCAN_TERM_RENDERINGS`
- `LOG_USAGE`

The OpenAI-compatible provider path is intentionally disabled in the Site MVP.

## Local-first behavior

EPUB parsing and rebuilding stay in the browser. The Gemini API key is stored in the browser's IndexedDB via the storage shim. Only extracted text batches are sent to Gemini.

Open `translate-doc/settings.html` or click **Gemini / Site 設定** on the upload screen to save the API key, model and target language.

## 500 MB scope

The hard preflight limit is 500 MB. This does not guarantee that every 500 MB EPUB will complete on every device.

The current EPUB engine still uses `file.arrayBuffer()` + `fflate.unzipSync()`, and the writer uses `fflate.zipSync()`. A highly compressed 500 MB EPUB can require substantially more than 500 MB of peak RAM while unpacking/repacking. The Site UI therefore labels 500 MB as the accepted hard limit while warning that practical success depends on device memory.

For a true device-independent 500 MB guarantee, the next engine change is streaming ZIP read/write or chapter-by-chapter archive reconstruction rather than another limit increase.
