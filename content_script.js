(function() {
  if (!window.__miniUSM_injected) {
    window.__miniUSM_injected = true;
  } else {
    return;
  }

  let miniUSMRunCount = 0;
  let miniUSMBadgeEl = null;

  function ensureBadge() {
    if (miniUSMBadgeEl) return miniUSMBadgeEl;
    const el = document.createElement('div');
    el.id = 'miniUSM-badge';
    el.textContent = 'MiniUSM: 0';
    el.style.position = 'fixed';
    el.style.zIndex = '2147483647';
    el.style.bottom = '8px';
    el.style.right = '8px';
    el.style.padding = '2px 6px';
    el.style.borderRadius = '999px';
    el.style.fontSize = '10px';
    el.style.fontFamily = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    el.style.background = 'rgba(15,23,42,0.85)';
    el.style.color = '#e5e7eb';
    el.style.boxShadow = '0 2px 6px rgba(0,0,0,0.35)';
    el.style.cursor = 'pointer';
    el.style.opacity = '0.7';
    el.style.pointerEvents = 'auto';
    el.title = 'Mini Userscript Pro – click to hide this badge';

    el.addEventListener('click', () => {
      el.style.display = 'none';
    });

    document.documentElement.appendChild(el);
    miniUSMBadgeEl = el;
    return el;
  }

  function updateBadge() {
    if (miniUSMRunCount <= 0) return;
    const el = ensureBadge();
    el.textContent = 'MiniUSM: ' + miniUSMRunCount;
  }

  function createGMApi(scriptId) {
    function GM_addStyle(css) {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      return style;
    }
    function storageKey(key) {
      return 'musp_' + scriptId + '_' + key;
    }
    function GM_getValue(key, defaultValue) {
      try {
        const raw = localStorage.getItem(storageKey(key));
        if (raw == null) return defaultValue;
        return JSON.parse(raw);
      } catch (e) {
        return defaultValue;
      }
    }
    function GM_setValue(key, value) {
      try {
        localStorage.setItem(storageKey(key), JSON.stringify(value));
      } catch (e) {
        console.warn('[MiniUSM] GM_setValue error', e);
      }
    }
    function GM_xmlhttpRequest(details) {
      const url = details.url;
      const method = (details.method || 'GET').toUpperCase();
      const headers = details.headers || {};
      const body = details.data;
      fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : body,
        credentials: details.anonymous ? 'omit' : 'include',
      }).then(async res => {
        const text = await res.text();
        if (details.onload) details.onload({
          finalUrl: res.url,
          status: res.status,
          statusText: res.statusText,
          responseText: text,
          responseHeaders: Array.from(res.headers.entries())
            .map(([k, v]) => k + ': ' + v).join('\n'),
        });
      }).catch(err => {
        if (details.onerror) details.onerror(err);
      });
    }
    return { GM_addStyle, GM_getValue, GM_setValue, GM_xmlhttpRequest };
  }

  function runUserScript(script) {
    const api = createGMApi(script.id);
    try {
      const fn = new Function('GM_addStyle', 'GM_getValue', 'GM_setValue', 'GM_xmlhttpRequest', script.code);
      fn(api.GM_addStyle, api.GM_getValue, api.GM_setValue, api.GM_xmlhttpRequest);
      miniUSMRunCount += 1;
      updateBadge();
      chrome.runtime.sendMessage({ type: 'recordScriptRun', scriptId: script.id, ok: true });
    } catch (e) {
      console.error('[MiniUSM] Script error in', script.name, e);
      chrome.runtime.sendMessage({ type: 'recordScriptRun', scriptId: script.id, ok: false, error: String(e) });
    }
  }

  function requestAndRun(phase) {
    try {
      chrome.runtime.sendMessage(
        { type: 'getScriptsForUrlAndPhase', url: location.href, phase },
        res => {
          if (!res || !Array.isArray(res.scripts)) return;
          res.scripts.forEach(runUserScript);
        }
      );
    } catch (e) {
      console.error('[MiniUSM] requestAndRun error', e);
    }
  }

  // document-start
  requestAndRun('document-start');

  // document-end
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => requestAndRun('document-end'));
  } else {
    requestAndRun('document-end');
  }

  // document-idle
  window.addEventListener('load', () => {
    setTimeout(() => requestAndRun('document-idle'), 0);
  });
})();