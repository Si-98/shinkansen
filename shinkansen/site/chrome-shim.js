// chrome-shim.js — ChatGPT Site / ordinary web runtime adapter for translate-doc.
// Loaded by translate-doc pages before Shinkansen's existing scripts.
// In a real extension context this file is a strict no-op.
(() => {
  if (globalThis.chrome?.runtime?.id) return;

  const scriptUrl = document.currentScript?.src || location.href;
  const ROOT_URL = new URL('../', scriptUrl); // .../shinkansen/
  const DB_NAME = 'shinkansen-site-runtime';
  const DB_VERSION = 1;
  const STORE = 'kv';
  const listeners = new Set();

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
  }

  async function withStore(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        try { result = fn(store, resolve, reject); }
        catch (err) { reject(err); }
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
        if (result !== undefined) resolve(result);
      });
    } finally {
      db.close();
    }
  }

  const nsKey = (area, key) => `${area}:${key}`;

  async function getAllArea(area) {
    return withStore('readonly', (store, resolve, reject) => {
      const out = {};
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) { resolve(out); return; }
        const prefix = `${area}:`;
        if (typeof cur.key === 'string' && cur.key.startsWith(prefix)) {
          out[cur.key.slice(prefix.length)] = cur.value;
        }
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function areaGet(area, keys) {
    if (keys == null) return getAllArea(area);
    const defaults = (!Array.isArray(keys) && typeof keys === 'object') ? keys : null;
    const list = typeof keys === 'string' ? [keys]
      : Array.isArray(keys) ? keys
      : defaults ? Object.keys(defaults)
      : [];
    const out = defaults ? { ...defaults } : {};
    if (list.length === 0) return out;
    await withStore('readonly', (store, resolve, reject) => {
      let pending = list.length;
      for (const key of list) {
        const req = store.get(nsKey(area, key));
        req.onsuccess = () => {
          if (req.result !== undefined) out[key] = req.result;
          if (--pending === 0) resolve();
        };
        req.onerror = () => reject(req.error);
      }
    });
    return out;
  }

  function emitChanges(changes, area) {
    if (!changes || Object.keys(changes).length === 0) return;
    for (const fn of [...listeners]) {
      try { fn(changes, area); } catch (err) { console.warn('[Shinkansen Site] storage listener failed', err); }
    }
  }

  async function areaSet(area, items) {
    const patch = items && typeof items === 'object' ? items : {};
    const keys = Object.keys(patch);
    if (!keys.length) return;
    const before = await areaGet(area, keys);
    await withStore('readwrite', (store, resolve) => {
      for (const key of keys) store.put(patch[key], nsKey(area, key));
      store.transaction.oncomplete = () => resolve();
    });
    const changes = {};
    for (const key of keys) {
      if (!Object.is(before[key], patch[key])) {
        changes[key] = { oldValue: before[key], newValue: patch[key] };
      }
    }
    emitChanges(changes, area);
  }

  async function areaRemove(area, keys) {
    const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : [];
    if (!list.length) return;
    const before = await areaGet(area, list);
    await withStore('readwrite', (store, resolve) => {
      for (const key of list) store.delete(nsKey(area, key));
      store.transaction.oncomplete = () => resolve();
    });
    const changes = {};
    for (const key of list) {
      if (before[key] !== undefined) changes[key] = { oldValue: before[key] };
    }
    emitChanges(changes, area);
  }

  async function areaClear(area) {
    const before = await getAllArea(area);
    const keys = Object.keys(before);
    if (!keys.length) return;
    await withStore('readwrite', (store, resolve, reject) => {
      const prefix = `${area}:`;
      const req = store.openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return;
        if (typeof cur.key === 'string' && cur.key.startsWith(prefix)) cur.delete();
        cur.continue();
      };
      req.onerror = () => reject(req.error);
      store.transaction.oncomplete = () => resolve();
    });
    emitChanges(Object.fromEntries(keys.map((k) => [k, { oldValue: before[k] }])), area);
  }

  async function areaKeys(area) {
    return Object.keys(await getAllArea(area));
  }

  function makeArea(area) {
    return {
      get: (keys = null) => areaGet(area, keys),
      set: (items) => areaSet(area, items),
      remove: (keys) => areaRemove(area, keys),
      clear: () => areaClear(area),
      getKeys: () => areaKeys(area),
    };
  }

  const storage = {
    local: makeArea('local'),
    sync: makeArea('sync'),
    onChanged: {
      addListener(fn) { if (typeof fn === 'function') listeners.add(fn); },
      removeListener(fn) { listeners.delete(fn); },
      hasListener(fn) { return listeners.has(fn); },
    },
  };

  function siteError(err, fallbackCode = 'siteRuntime') {
    console.error('[Shinkansen Site]', err);
    return {
      error: err?.message || String(err),
      errorCode: err?.skCode || fallbackCode,
      errorParams: err?.skParams || null,
      usage: err?.usage || null,
    };
  }

  function mergeFixedGlossary(settings) {
    const entries = settings?.fixedGlossary?.global;
    if (!Array.isArray(entries)) return null;
    const filtered = entries.filter((e) => e && e.source && e.target)
      .map((e) => ({ source: e.source, target: e.target }));
    return filtered.length ? filtered : null;
  }

  function mergeForbiddenTerms(settings, payload) {
    const base = Array.isArray(settings?.forbiddenTerms) ? settings.forbiddenTerms : [];
    const extra = Array.isArray(payload?.extraForbiddenTerms) ? payload.extraForbiddenTerms : [];
    return [...new Set([...base, ...extra].filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()))];
  }

  async function loadCore() {
    const [storageMod, gemini, pricingMod, billing] = await Promise.all([
      import(new URL('lib/storage.js', ROOT_URL)),
      import(new URL('lib/gemini.js', ROOT_URL)),
      import(new URL('lib/model-pricing.js', ROOT_URL)),
      import(new URL('lib/billing.js', ROOT_URL)),
    ]);
    return { storageMod, gemini, pricingMod, billing };
  }

  async function billUsage(settings, model, usage, pricingMod, billing) {
    const pricing = pricingMod.getPricingForModel(model, settings) || settings.pricing || null;
    return billing.computeBilling(usage || {}, pricing, billing.geminiCachedRate(pricing));
  }

  async function handleTranslateDoc(payload = {}) {
    const { storageMod, gemini, pricingMod, billing } = await loadCore();
    const s = await storageMod.getSettingsCached();
    if (!s.apiKey) {
      const err = new Error('Gemini API key 尚未設定。請先開啟「翻譯設定」並在 Site 設定區輸入 API key。');
      err.skCode = 'apiKeyMissing';
      throw err;
    }
    const td = s.translateDoc || {};
    const extraPrompt = typeof payload.extraPrompt === 'string' ? payload.extraPrompt.trim() : '';
    const basePrompt = storageMod.getEffectiveDocSystemPrompt(s.targetLanguage, td.systemPrompt);
    const systemInstruction = basePrompt
      + (extraPrompt ? `\n\n${extraPrompt}` : '')
      + storageMod.DOC_INLINE_MARKER_INSTRUCTION;
    const model = payload.modelOverride || s.geminiConfig?.model;
    const requestedBatch = Number(payload.docBatchSize || td.batchSize || 50);
    const maxUnitsPerBatch = Math.max(1, Math.min(100, Number.isFinite(requestedBatch) ? Math.round(requestedBatch) : 50));
    const settings = {
      ...s,
      maxUnitsPerBatch,
      geminiConfig: {
        ...s.geminiConfig,
        model,
        systemInstruction,
        temperature: Number.isFinite(td.temperature) ? td.temperature : s.geminiConfig?.temperature,
        fetchTimeoutMs: 120_000,
        timeoutRetries: 1,
      },
    };
    const fixedGlossary = td.applyFixedGlossary === false ? null : mergeFixedGlossary(s);
    const forbiddenTerms = mergeForbiddenTerms(s, payload);
    const out = await gemini.translateBatch(
      Array.isArray(payload.texts) ? payload.texts : [],
      settings,
      Array.isArray(payload.glossary) ? payload.glossary : null,
      fixedGlossary,
      forbiddenTerms,
    );
    const billed = await billUsage(settings, model, out.usage, pricingMod, billing);
    return { result: out.translations, usage: { ...billed, cacheHits: 0 } };
  }

  async function handleExtractGlossary(payload = {}) {
    const { storageMod, gemini, pricingMod, billing } = await loadCore();
    const s = await storageMod.getSettingsCached();
    if (!s.apiKey) return { glossary: [], usage: {}, _diag: 'Gemini API key missing' };
    const model = payload.modelOverride || s.glossary?.model || s.geminiConfig?.model;
    const suffix = typeof payload.promptSuffix === 'string' ? payload.promptSuffix.trim() : '';
    const settings = {
      ...s,
      glossary: {
        ...s.glossary,
        model,
        prompt: (s.glossary?.prompt || '') + (suffix ? `\n\n${suffix}` : ''),
      },
    };
    const out = await gemini.extractGlossary(String(payload.compressedText || ''), settings);
    const billed = await billUsage(settings, model, out.usage, pricingMod, billing);
    return { ...out, usage: { ...billed, cacheHits: 0 }, fromCache: false };
  }

  async function handleScanRenderings(payload = {}) {
    const { storageMod, gemini, pricingMod, billing } = await loadCore();
    const s = await storageMod.getSettingsCached();
    if (!s.apiKey) return { renderings: [], usage: {}, _diag: 'Gemini API key missing' };
    const model = s.glossary?.model || s.geminiConfig?.model;
    const out = await gemini.extractTermRenderings(Array.isArray(payload.items) ? payload.items : [], s);
    const billed = await billUsage(s, model, out.usage, pricingMod, billing);
    return { ...out, usage: { ...billed, cacheHits: 0 }, billedCostUSD: billed.billedCostUSD };
  }

  async function handleMessage(message) {
    const type = message?.type;
    const payload = message?.payload || {};
    try {
      switch (type) {
        case 'TRANSLATE_DOC_BATCH': return await handleTranslateDoc(payload);
        case 'TRANSLATE_DOC_BATCH_CUSTOM':
          return { error: 'Site 版目前先支援 Gemini；請將翻譯 preset 改成 Gemini。', errorCode: 'siteCustomProviderUnsupported' };
        case 'EXTRACT_GLOSSARY': return await handleExtractGlossary(payload);
        case 'SCAN_TERM_RENDERINGS': return await handleScanRenderings(payload);
        case 'LOG_USAGE': {
          const { siteUsageLog = [] } = await storage.local.get('siteUsageLog');
          const next = Array.isArray(siteUsageLog) ? siteUsageLog.slice(-199) : [];
          next.push({ ...payload, timestamp: payload.timestamp || Date.now() });
          await storage.local.set({ siteUsageLog: next });
          return { ok: true };
        }
        case 'LOG': console.log('[Shinkansen Site]', payload); return { ok: true };
        case 'GET_LOGS': return { logs: [], latestSeq: 0 };
        case 'CLEAR_LOGS': return { ok: true };
        case 'CLEAR_PERSISTED_LOGS': await storage.local.remove(['yt_debug_log', 'anomaly_log']); return { ok: true };
        case 'GET_PERSISTED_LOGS': {
          const got = await storage.local.get(['yt_debug_log', 'anomaly_log']);
          return { logs: got.yt_debug_log || [], anomalies: got.anomaly_log || [], count: (got.yt_debug_log || []).length };
        }
        default:
          return { ok: true, siteRuntime: true };
      }
    } catch (err) {
      return siteError(err);
    }
  }

  const runtime = {
    id: 'shinkansen-site-runtime',
    getManifest() { return { name: 'Shinkansen Site', version: 'site-500mb', siteRuntime: true }; },
    getURL(path = '') { return new URL(String(path).replace(/^\/+/, ''), ROOT_URL).href; },
    sendMessage: handleMessage,
    onMessage: { addListener() {}, removeListener() {}, hasListener() { return false; } },
  };

  const chrome = {
    runtime,
    storage,
    tabs: {
      async create({ url }) {
        const win = window.open(url, '_blank', 'noopener');
        return { id: null, url, window: win || null };
      },
    },
  };

  globalThis.chrome = chrome;
  globalThis.browser = chrome;
  globalThis.__SHINKANSEN_SITE_RUNTIME__ = { rootUrl: ROOT_URL.href, version: 'site-500mb' };
})();