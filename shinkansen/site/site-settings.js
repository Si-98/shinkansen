// site-settings.js — small Site-only settings panel injected into translate-doc/settings.html.
const manifest = globalThis.chrome?.runtime?.getManifest?.() || {};
if (manifest.siteRuntime) {
  const container = document.querySelector('.container');
  if (container) {
    const section = document.createElement('section');
    section.id = 'site-runtime-settings';
    section.innerHTML = `
      <h2>Site 連線設定</h2>
      <p class="muted" style="margin-top:0">API key 只存於目前瀏覽器的 IndexedDB。EPUB 本體仍在瀏覽器本機解析，只有擷取出的文字會送到 Gemini API。</p>
      <label>
        <span>Gemini API key</span>
        <input id="site-gemini-api-key" type="password" autocomplete="off" placeholder="AIza…" style="width:min(100%,560px)">
      </label>
      <label style="display:block;margin-top:12px">
        <span>翻譯模型</span>
        <input id="site-gemini-model" type="text" style="width:min(100%,360px)" placeholder="gemini-3.1-flash-lite">
      </label>
      <label style="display:block;margin-top:12px">
        <span>目標語言</span>
        <select id="site-target-language">
          <option value="zh-TW">台灣繁體中文</option>
          <option value="zh-CN">簡體中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
        </select>
      </label>
      <div style="display:flex;align-items:center;gap:10px;margin-top:14px">
        <button type="button" id="site-save-runtime" class="primary">儲存 Site 設定</button>
        <span id="site-save-runtime-status" class="muted"></span>
      </div>
      <p class="muted" style="margin-bottom:0">Site MVP 先走 Gemini。Shinkansen 的 OpenAI-compatible provider 路徑暫不啟用。</p>`;
    container.insertBefore(section, container.children[1] || null);

    const keyEl = section.querySelector('#site-gemini-api-key');
    const modelEl = section.querySelector('#site-gemini-model');
    const langEl = section.querySelector('#site-target-language');
    const statusEl = section.querySelector('#site-save-runtime-status');

    const [{ apiKey = '' }, sync] = await Promise.all([
      chrome.storage.local.get('apiKey'),
      chrome.storage.sync.get(['geminiConfig', 'targetLanguage']),
    ]);
    keyEl.value = apiKey;
    modelEl.value = sync.geminiConfig?.model || 'gemini-3.1-flash-lite';
    langEl.value = sync.targetLanguage || 'zh-TW';

    section.querySelector('#site-save-runtime').addEventListener('click', async () => {
      const apiKey = keyEl.value.trim();
      const model = modelEl.value.trim() || 'gemini-3.1-flash-lite';
      const targetLanguage = langEl.value || 'zh-TW';
      const current = await chrome.storage.sync.get('geminiConfig');
      await Promise.all([
        chrome.storage.local.set({ apiKey }),
        chrome.storage.sync.set({
          targetLanguage,
          geminiConfig: { ...(current.geminiConfig || {}), model },
          translatePresets: [
            { slot: 1, engine: 'gemini', model, label: 'Gemini' },
            { slot: 2, engine: 'gemini', model, label: 'Gemini' },
            { slot: 3, engine: 'gemini', model, label: 'Gemini' },
          ],
        }),
      ]);
      statusEl.textContent = apiKey ? '已儲存' : '已儲存，但尚未填 API key';
      setTimeout(() => { statusEl.textContent = ''; }, 2500);
    });
  }
}