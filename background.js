const SCRIPTS_KEY = 'musp_scripts';
const SCRIPTS_META_KEY = 'musp_scriptMeta';
const SETTINGS_KEY = 'musp_settings';

function getAllScripts() {
  return new Promise(resolve => {
    chrome.storage.local.get(SCRIPTS_KEY, data => {
      resolve(data[SCRIPTS_KEY] || []);
    });
  });
}

function saveAllScripts(scripts) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [SCRIPTS_KEY]: scripts || [] }, () => resolve());
  });
}

function getScriptMeta() {
  return new Promise(resolve => {
    chrome.storage.local.get(SCRIPTS_META_KEY, data => {
      resolve(data[SCRIPTS_META_KEY] || {});
    });
  });
}

function saveScriptMeta(meta) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [SCRIPTS_META_KEY]: meta || {} }, () => resolve());
  });
}

function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(SETTINGS_KEY, data => {
      const raw = data[SETTINGS_KEY] || {};
      const themeMode = raw.themeMode || 'system'; // 'system' | 'inverse'
      resolve({
        themeMode,
        safeMode: !!raw.safeMode,
        scriptDisabledHosts: Array.isArray(raw.scriptDisabledHosts) ? raw.scriptDisabledHosts : [],
      });
    });
  });
}

function saveSettings(settings) {
  const normalized = {
    themeMode: settings && settings.themeMode ? settings.themeMode : 'system',
    safeMode: !!(settings && settings.safeMode),
    scriptDisabledHosts: Array.isArray(settings && settings.scriptDisabledHosts)
      ? settings.scriptDisabledHosts
      : [],
  };
  return new Promise(resolve => {
    chrome.storage.local.set({ [SETTINGS_KEY]: normalized }, () => resolve());
  });
}

function wildcardToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  try {
    return new RegExp(regexStr);
  } catch (e) {
    console.warn('[MiniUSM] Bad pattern', pattern, e);
    return null;
  }
}

function urlMatchesPattern(url, pattern) {
  const re = wildcardToRegExp(pattern.trim());
  if (!re) return false;
  return re.test(url);
}

function urlMatchesScript(url, script) {
  const matches = script.matches || [];
  const includes = script.includes || [];
  const excludes = script.excludes || [];
  let ok = false;
  if (!matches.length && !includes.length) {
    ok = true;
  } else {
    if (matches.length) {
      ok = matches.some(p => urlMatchesPattern(url, p));
    }
    if (!ok && includes.length) {
      ok = includes.some(p => urlMatchesPattern(url, p));
    }
  }
  if (!ok) return false;
  if (excludes.length && excludes.some(p => urlMatchesPattern(url, p))) {
    return false;
  }
  return true;
}

function shouldRunAtPhase(runAt, phase) {
  const r = runAt || 'document-end';
  if (phase === 'document-start') return r === 'document-start';
  if (phase === 'document-end') return r === 'document-end';
  if (phase === 'document-idle') return r === 'document-idle' || r === 'document-end';
  return false;
}

// For content_script: get scripts for url + phase
async function getScriptsForUrlAndPhase(url, phase) {
  if (!url || !url.startsWith('http')) return [];
  const [scripts, settings] = await Promise.all([getAllScripts(), getSettings()]);
  if (settings.safeMode) return [];
  let host = '';
  try {
    const u = new URL(url);
    host = u.hostname.replace(/^www\./i, '');
  } catch (e) {}
  if (host && settings.scriptDisabledHosts.includes(host)) {
    return [];
  }
  return scripts.filter(s =>
    s.enabled !== false &&
    s.code &&
    urlMatchesScript(url, s) &&
    shouldRunAtPhase(s.runAt, phase)
  );
}

async function recordScriptRun(scriptId, ok, error) {
  const meta = await getScriptMeta();
  const now = Date.now();
  meta[scriptId] = meta[scriptId] || {};
  meta[scriptId].lastRunTime = now;
  meta[scriptId].lastError = ok ? null : String(error || 'Unknown error');
  await saveScriptMeta(meta);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || !msg.type) return;

    if (msg.type === 'getScripts') {
      const scripts = await getAllScripts();
      sendResponse({ scripts });
      return;
    }

    if (msg.type === 'saveScripts') {
      const scripts = msg.scripts || [];
      // normalize IDs
      let maxId = 0;
      scripts.forEach(s => {
        if (typeof s.id === 'number') {
          if (s.id > maxId) maxId = s.id;
        }
      });
      scripts.forEach(s => {
        if (s.id == null) {
          maxId += 1;
          s.id = maxId;
        }
      });
      await saveAllScripts(scripts);
      sendResponse({ ok: true, scripts });
      return;
    }

    if (msg.type === 'getScriptMeta') {
      const meta = await getScriptMeta();
      sendResponse({ meta });
      return;
    }

    if (msg.type === 'recordScriptRun') {
      const { scriptId, ok, error } = msg;
      await recordScriptRun(scriptId, ok, error);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'getSettings') {
      const settings = await getSettings();
      sendResponse({ settings });
      return;
    }

    if (msg.type === 'saveSettings') {
      await saveSettings(msg.settings || {});
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'getScriptsForUrlAndPhase') {
      const { url, phase } = msg;
      const scripts = await getScriptsForUrlAndPhase(url, phase);
      sendResponse({ scripts });
      return;
    }

  })();
  return true;
});