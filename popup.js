const STORAGE_KEY = 'musp_scripts';
const SETTINGS_KEY = 'musp_settings';

let currentScripts = [];
let currentScriptMeta = {};
let editingId = null;
let scriptSearchQuery = '';
let discoverResults = [];
let discoverLoading = false;

function sendToBackground(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, res => resolve(res || {}));
  });
}

function updateThemeInspector(settings) {
  const el = document.getElementById('themeInspectorLine');
  if (!el) return;
  const themeMode = (settings && settings.themeMode) || 'system';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const systemTheme = prefersDark ? 'Dark' : 'Light';
  const effectiveDark = themeMode === 'inverse' ? !prefersDark : prefersDark;
  const extTheme = effectiveDark ? 'Dark' : 'Light';
  const modeLabel = themeMode === 'inverse' ? 'Invert system' : 'Match system';
  el.textContent = `System: ${systemTheme} • Extension: ${extTheme} • Mode: ${modeLabel}`;
}

function applySettingsToUI(settings) {
  const body = document.body;
  const invertToggle = document.getElementById('themeInvertToggle');
  const safeModeToggle = document.getElementById('safeModeToggle');
  const themeMode = (settings && settings.themeMode) || 'system';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const dark = themeMode === 'inverse' ? !prefersDark : prefersDark;
  body.setAttribute('data-theme', dark ? 'dark' : 'light');
  if (invertToggle) invertToggle.checked = themeMode === 'inverse';
  if (safeModeToggle) safeModeToggle.checked = !!(settings && settings.safeMode);
  updateThemeInspector(settings);
}

function loadSettings() {
  return sendToBackground({ type: 'getSettings' }).then(res => res.settings || {
    themeMode: 'system',
    safeMode: false,
    scriptDisabledHosts: [],
  });
}

function saveSettings(settings) {
  return sendToBackground({ type: 'saveSettings', settings });
}

async function loadScriptsAndMeta() {
  const [scriptsRes, metaRes] = await Promise.all([
    sendToBackground({ type: 'getScripts' }),
    sendToBackground({ type: 'getScriptMeta' }),
  ]);
  currentScriptMeta = metaRes.meta || {};
  return scriptsRes.scripts || [];
}

function saveScriptsToBg() {
  return sendToBackground({ type: 'saveScripts', scripts: currentScripts });
}

function wildcardToRegExpLocal(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*') + '$';
  try {
    return new RegExp(regexStr);
  } catch (e) {
    console.warn('[MiniUSM] Bad pattern in tester', pattern, e);
    return null;
  }
}

function urlMatchesPatternLocal(url, pattern) {
  const re = wildcardToRegExpLocal(pattern.trim());
  if (!re) return false;
  return re.test(url);
}

function urlMatchesScriptLocal(url, script) {
  const matches = script.matches || [];
  const includes = script.includes || [];
  const excludes = script.excludes || [];
  let ok = false;
  if (!matches.length && !includes.length) {
    ok = true;
  } else {
    if (matches.length) {
      ok = matches.some(p => urlMatchesPatternLocal(url, p));
    }
    if (!ok && includes.length) {
      ok = includes.some(p => urlMatchesPatternLocal(url, p));
    }
  }
  if (!ok) return false;
  if (excludes.length && excludes.some(p => urlMatchesPatternLocal(url, p))) {
    return false;
  }
  return true;
}

function parseUserScriptMeta(codeText) {
  const metaMatch = codeText.match(/==UserScript==([\s\S]*?)==\/UserScript==/);
  const metaBlock = metaMatch ? metaMatch[1] : '';

  const nameMatch = metaBlock.match(/@name\s+(.+)/);
  const runAtMatch = metaBlock.match(/@run-at\s+(.+)/);
  const versionMatch = metaBlock.match(/@version\s+(.+)/);

  const matchLines = Array.from(metaBlock.matchAll(/@match\s+(.+)/g)).map(m => m[1].trim());
  const includeLines = Array.from(metaBlock.matchAll(/@include\s+(.+)/g)).map(m => m[1].trim());
  const excludeLines = Array.from(metaBlock.matchAll(/@exclude\s+(.+)/g)).map(m => m[1].trim());

  const name = nameMatch ? nameMatch[1].trim() : 'Imported userscript';
  const runAt = runAtMatch ? runAtMatch[1].trim() : 'document-end';
  const version = versionMatch ? versionMatch[1].trim() : null;

  return {
    name,
    runAt,
    version,
    matches: matchLines,
    includes: includeLines,
    excludes: excludeLines,
  };
}


async function refreshPageInspector() {
  const statusEl = document.getElementById('pageInspectorStatus');
  const summaryEl = document.getElementById('pageInspectorSummary');
  const listEl = document.getElementById('pageInspectorList');
  const pauseBtn = document.getElementById('pauseForThisSiteBtn');
  if (!statusEl || !summaryEl || !listEl || !pauseBtn) return;

  statusEl.textContent = 'Loading…';
  summaryEl.textContent = '';
  listEl.innerHTML = '';

  chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.url) {
      statusEl.textContent = 'No active tab';
      summaryEl.textContent = 'No active tab';
      return;
    }
    const url = tab.url;
    let host = '';
    try {
      const u = new URL(url);
      host = u.hostname.replace(/^www\./i, '');
    } catch (e) {}

    const matching = currentScripts.filter(s => urlMatchesScriptLocal(url, s));
    statusEl.textContent = matching.length
      ? `${matching.length} script(s) match this page`
      : 'No scripts match this page';
    summaryEl.textContent = host ? `Host: ${host}` : url;

    listEl.innerHTML = '';
    matching.forEach(s => {
      const row = document.createElement('div');
      row.className = 'page-inspector-item';
      const left = document.createElement('span');
      left.className = 'name';
      left.textContent = s.name || '(untitled)';
      const right = document.createElement('span');
      right.className = 'runat';
      right.textContent = s.runAt || 'document-end';
      row.appendChild(left);
      row.appendChild(right);
      listEl.appendChild(row);
    });

    const settingsNow = await loadSettings();
    const disabledHosts = settingsNow.scriptDisabledHosts || [];
    const paused = host && disabledHosts.includes(host);
    pauseBtn.textContent = paused ? 'Resume scripts on this site' : 'Pause scripts on this site';
    pauseBtn.dataset.host = host || '';
    pauseBtn.dataset.paused = paused ? '1' : '0';
  });
}

// --- Scripts tab rendering ---

function renderScripts(list) {
  currentScripts = list;
  const container = document.getElementById('scriptsList');
  container.innerHTML = '';
  let enabledCount = 0;
  let disabledCount = 0;

  const q = (scriptSearchQuery || '').trim().toLowerCase();
  const displayList = q
    ? list.filter(s => (s.name || '').toLowerCase().includes(q))
    : list;

  displayList.forEach(script => {
    if (script.enabled !== false) enabledCount++;
    else disabledCount++;

    const row = document.createElement('div');
    row.className = 'script-row' + (script.enabled === false ? ' disabled' : '');

    const main = document.createElement('div');
    main.className = 'script-main';

    const titleLine = document.createElement('div');
    titleLine.className = 'script-title-line';

    const title = document.createElement('div');
    title.className = 'script-title';
    title.textContent = script.name || '(untitled)';

    const badgeRunAt = document.createElement('span');
    badgeRunAt.className = 'badge-runat';
    badgeRunAt.textContent = script.runAt || 'document-end';

    const metaInfo = (currentScriptMeta && currentScriptMeta[script.id]) || null;
    let statusText = 'never run';
    if (metaInfo) {
      if (metaInfo.lastError) statusText = 'error: ' + metaInfo.lastError;
      else if (metaInfo.lastRunTime) {
        const when = new Date(metaInfo.lastRunTime).toLocaleString();
        statusText = 'last run: ' + when;
      }
    }

    titleLine.appendChild(title);
    titleLine.appendChild(badgeRunAt);

    const metaDiv = document.createElement('div');
    metaDiv.className = 'script-meta';
    metaDiv.textContent = statusText;

    main.appendChild(titleLine);
    main.appendChild(metaDiv);

    const actions = document.createElement('div');
    actions.className = 'script-actions';

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = script.enabled === false ? 'Enable' : 'Disable';
    toggleBtn.addEventListener('click', () => {
      script.enabled = script.enabled === false ? true : false;
      saveScriptsToBg().then(async () => {
        const scripts = await loadScriptsAndMeta();
        renderScripts(scripts);
      });
    });

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openEditor(script.id));

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      if (!confirm('Delete script "' + (script.name || '(untitled)') + '"?')) return;
      const idx = currentScripts.findIndex(s => s.id === script.id);
      if (idx >= 0) currentScripts.splice(idx, 1);
      saveScriptsToBg().then(async () => {
        const scripts = await loadScriptsAndMeta();
        renderScripts(scripts);
      });
    });

    actions.appendChild(toggleBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    row.appendChild(main);
    row.appendChild(actions);
    container.appendChild(row);
  });

  document.getElementById('enabledCount').textContent = 'Enabled: ' + enabledCount;
  document.getElementById('disabledCount').textContent = 'Disabled: ' + disabledCount;
}

// --- Editor ---

function openEditor(id) {
  const editor = document.getElementById('editor');
  const title = document.getElementById('editorTitle');
  const nameInput = document.getElementById('editName');
  const matchesInput = document.getElementById('editMatches');
  const includesInput = document.getElementById('editIncludes');
  const excludesInput = document.getElementById('editExcludes');
  const runAtSelect = document.getElementById('editRunAt');
  const codeInput = document.getElementById('editCode');

  if (id == null) {
    editingId = null;
    title.textContent = 'New script';
    nameInput.value = '';
    matchesInput.value = '';
    includesInput.value = '';
    excludesInput.value = '';
    runAtSelect.value = 'document-end';
    codeInput.value = '';
  } else {
    const script = currentScripts.find(s => s.id === id);
    if (!script) return;
    editingId = id;
    title.textContent = 'Edit script';
    nameInput.value = script.name || '';
    matchesInput.value = (script.matches || []).join('\n');
    includesInput.value = (script.includes || []).join('\n');
    excludesInput.value = (script.excludes || []).join('\n');
    runAtSelect.value = script.runAt || 'document-end';
    codeInput.value = script.code || '';
  }

  editor.classList.remove('hidden');
}

function closeEditor() {
  const editor = document.getElementById('editor');
  editor.classList.add('hidden');
  editingId = null;
}

async function saveEditor() {
  const nameInput = document.getElementById('editName');
  const matchesInput = document.getElementById('editMatches');
  const includesInput = document.getElementById('editIncludes');
  const excludesInput = document.getElementById('editExcludes');
  const runAtSelect = document.getElementById('editRunAt');
  const codeInput = document.getElementById('editCode');

  const scriptData = {
    id: editingId,
    name: nameInput.value.trim() || '(untitled)',
    matches: matchesInput.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    includes: includesInput.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    excludes: excludesInput.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean),
    runAt: runAtSelect.value,
    code: codeInput.value,
    enabled: true,
  };

  if (editingId == null) {
    currentScripts.push(scriptData);
  } else {
    const idx = currentScripts.findIndex(s => s.id === editingId);
    if (idx >= 0) {
      currentScripts[idx] = Object.assign({}, currentScripts[idx], scriptData);
    } else {
      currentScripts.push(scriptData);
    }
  }

  await saveScriptsToBg();
  const scripts = await loadScriptsAndMeta();
  renderScripts(scripts);
  closeEditor();
}


const RECIPES = [
  {
    id: 'recipe-youtube-focus',
    name: 'YouTube Focus Mode',
    description: 'Hide homepage recommendations and shorts to reduce distraction.',
    matches: ['*://www.youtube.com/*'],
    includes: [],
    excludes: [],
    runAt: 'document-end',
    code: `
(function() {
  const hideSelectors = [
    '#contents ytd-rich-grid-row',
    'ytd-browse[page-subtype="home"] #contents',
    'ytd-mini-guide-renderer',
    'ytd-rich-section-renderer',
    'ytd-rich-shelf-renderer'
  ];
  function clean() {
    hideSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => el.style.display = 'none');
    });
  }
  clean();
  const obs = new MutationObserver(clean);
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();`.trim()
  },
  {
    id: 'recipe-reddit-compact',
    name: 'Reddit Compact View',
    description: 'Shrink posts and reduce padding on new Reddit.',
    matches: ['*://www.reddit.com/*'],
    includes: [],
    excludes: [],
    runAt: 'document-end',
    code: `
(function() {
  const css = \`
    .Post, shreddit-post {
      max-width: 640px !important;
      margin: 4px auto !important;
      padding: 6px !important;
    }
  \`;
  if (typeof GM_addStyle === 'function') {
    GM_addStyle(css);
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }
})();`.trim()
  },
  {
    id: 'recipe-auto-dark',
    name: 'Auto Dark Mode (simple)',
    description: 'Adds a dark background and light text to basic pages.',
    matches: ['*://*/*'],
    includes: [],
    excludes: [],
    runAt: 'document-end',
    code: `
(function() {
  const css = \`
    body {
      background: #020617 !important;
      color: #e5e7eb !important;
    }
  \`;
  if (typeof GM_addStyle === 'function') {
    GM_addStyle(css);
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    document.documentElement.appendChild(style);
  }
})();`.trim()
  }
];

function renderRecipes() {
  const container = document.getElementById('recipesList');
  if (!container) return;
  container.innerHTML = '';
  RECIPES.forEach(recipe => {
    const row = document.createElement('div');
    row.className = 'discover-row';

    const titleLine = document.createElement('div');
    titleLine.className = 'title-line';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = recipe.name;

    titleLine.appendChild(title);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = recipe.description || '';

    const actions = document.createElement('div');
    actions.className = 'actions';

    const existing = currentScripts.find(s => s.name === recipe.name);

    const installBtn = document.createElement('button');
    installBtn.textContent = existing ? 'Update recipe' : 'Install recipe';
    installBtn.addEventListener('click', async () => {
      if (existing) {
        existing.matches = recipe.matches;
        existing.includes = recipe.includes;
        existing.excludes = recipe.excludes;
        existing.runAt = recipe.runAt;
        existing.code = recipe.code;
        existing.enabled = existing.enabled !== false;
      } else {
        currentScripts.push({
          id: null,
          name: recipe.name,
          matches: recipe.matches,
          includes: recipe.includes,
          excludes: recipe.excludes,
          runAt: recipe.runAt,
          code: recipe.code,
          enabled: true,
          source: 'recipe',
          sourceId: recipe.id
        });
      }
      await saveScriptsToBg();
      const scripts = await loadScriptsAndMeta();
      renderScripts(scripts);
      renderRecipes();
    });

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remove';
    removeBtn.disabled = !existing;
    if (existing) {
      removeBtn.addEventListener('click', async () => {
        const idx = currentScripts.findIndex(s => s.name === recipe.name);
        if (idx >= 0) {
          currentScripts.splice(idx, 1);
          await saveScriptsToBg();
          const scripts = await loadScriptsAndMeta();
          renderScripts(scripts);
          renderRecipes();
        }
      });
    }

    actions.appendChild(installBtn);
    actions.appendChild(removeBtn);

    row.appendChild(titleLine);
    row.appendChild(desc);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

// --- Discover (online search) ---

async function searchOnlineScripts(query, source) {
  const q = (query || '').trim();
  if (!q) return [];
  const results = [];

  if (source === 'all' || source === 'greasyfork') {
    try {
      const res = await fetch(`https://greasyfork.org/en/scripts.json?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      (data || []).forEach(item => {
        results.push({
          source: 'greasyfork',
          id: String(item.id),
          name: item.name,
          description: item.description || '',
          pageUrl: `https://greasyfork.org${item.url}`,
          installUrl: item.code_url ||
            `https://greasyfork.org/scripts/${item.id}/code/${encodeURIComponent(item.name)}.user.js`,
        });
      });
    } catch (e) {
      console.error('[MiniUSM] Greasy Fork search failed', e);
    }
  }

  if (source === 'all' || source === 'openuserjs') {
    try {
      const res = await fetch(`https://openuserjs.org/?q=${encodeURIComponent(q)}`);
      const text = await res.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/html');
      const articles = Array.from(doc.querySelectorAll('article'));
      articles.forEach(article => {
        const link = article.querySelector('a[href^="/scripts/"]');
        if (!link) return;
        const name = (link.textContent || '').trim();
        const href = link.getAttribute('href') || '';
        if (!name || !href) return;
        const pageUrl = `https://openuserjs.org${href}`;
        const installUrl = pageUrl.endsWith('/source') ? pageUrl : `${pageUrl}/source`;
        let desc = '';
        const p = article.querySelector('p');
        if (p) desc = (p.textContent || '').trim();
        results.push({
          source: 'openuserjs',
          id: href,
          name,
          description: desc,
          pageUrl,
          installUrl,
        });
      });
    } catch (e) {
      console.error('[MiniUSM] OpenUserJS search failed', e);
    }
  }

  return results;
}

async function installOnlineScript(item) {
  try {
    const resp = await fetch(item.installUrl);
    const text = await resp.text();
    const meta = parseUserScriptMeta(text);

    let existing = currentScripts.find(s =>
      (s.source === item.source && s.sourceId === item.id) ||
      (s.name && s.name === meta.name)
    );

    if (existing) {
      existing.name = meta.name;
      existing.matches = meta.matches;
      existing.includes = meta.includes;
      existing.excludes = meta.excludes;
      existing.runAt = meta.runAt;
      existing.code = text;
      existing.enabled = existing.enabled !== false;
      existing.version = meta.version;
      existing.source = item.source;
      existing.sourceId = item.id;
      existing.sourcePage = item.pageUrl;
      existing.updateUrl = item.installUrl;
    } else {
      const newScript = {
        id: null,
        name: meta.name,
        matches: meta.matches,
        includes: meta.includes,
        excludes: meta.excludes,
        runAt: meta.runAt,
        code: text,
        enabled: true,
        version: meta.version,
        source: item.source,
        sourceId: item.id,
        sourcePage: item.pageUrl,
        updateUrl: item.installUrl,
      };
      currentScripts.push(newScript);
    }

    await saveScriptsToBg();
    const scripts = await loadScriptsAndMeta();
    renderScripts(scripts);
    alert((existing ? 'Updated' : 'Installed') + ` "${meta.name}".`);
  } catch (err) {
    console.error('[MiniUSM] installOnlineScript failed', err);
    alert('Failed to install/update: ' + err);
  }
}

function renderDiscoverResults() {
  const container = document.getElementById('discoverResults');
  if (!container) return;
  container.innerHTML = '';

  if (discoverLoading) {
    const div = document.createElement('div');
    div.className = 'small';
    div.textContent = 'Searching…';
    container.appendChild(div);
    return;
  }

  if (!discoverResults.length) {
    const div = document.createElement('div');
    div.className = 'small';
    div.textContent = 'No results yet. Try a search above.';
    container.appendChild(div);
    return;
  }

  discoverResults.forEach(item => {
    const row = document.createElement('div');
    row.className = 'discover-row';

    const titleLine = document.createElement('div');
    titleLine.className = 'title-line';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = item.name;

    const sourceBadge = document.createElement('span');
    sourceBadge.className = 'source-badge ' + (item.source === 'greasyfork' ? 'source-greasyfork' : 'source-openuserjs');
    sourceBadge.textContent = item.source === 'greasyfork' ? 'Greasy Fork' : 'OpenUserJS';

    titleLine.appendChild(title);
    titleLine.appendChild(sourceBadge);

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = item.description || '';

    const actions = document.createElement('div');
    actions.className = 'actions';

    const existing = currentScripts.find(s =>
      (s.source === item.source && s.sourceId === item.id) ||
      (s.name && s.name === item.name)
    );

    const installBtn = document.createElement('button');
    installBtn.textContent = existing ? 'Update' : 'Install';
    installBtn.addEventListener('click', () => installOnlineScript(item));

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.disabled = !existing;
    if (existing) {
      editBtn.addEventListener('click', () => openEditor(existing.id));
    }

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'View';
    viewBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: item.pageUrl });
    });

    actions.appendChild(installBtn);
    actions.appendChild(editBtn);
    actions.appendChild(viewBtn);

    row.appendChild(titleLine);
    if (desc.textContent) row.appendChild(desc);
    row.appendChild(actions);

    container.appendChild(row);
  });
}

// Install from URL
async function installFromUrlFlow() {
  const url = prompt('Enter .user.js URL:');
  if (!url) return;
  let finalUrl = url.trim();
  if (!/^https?:\/\//i.test(finalUrl)) {
    finalUrl = 'https://' + finalUrl;
  }
  try {
    const resp = await fetch(finalUrl);
    const text = await resp.text();
    const meta = parseUserScriptMeta(text);
    const newScript = {
      id: null,
      name: meta.name,
      matches: meta.matches,
      includes: meta.includes,
      excludes: meta.excludes,
      runAt: meta.runAt,
      code: text,
      enabled: true,
      version: meta.version,
      source: 'url',
      sourceId: finalUrl,
      sourcePage: finalUrl,
      updateUrl: finalUrl,
    };
    currentScripts.push(newScript);
    await saveScriptsToBg();
    const scripts = await loadScriptsAndMeta();
    renderScripts(scripts);
    alert('Installed "' + meta.name + '" from URL.');
  } catch (err) {
    console.error('Failed to install from URL', err);
    alert('Failed to install from URL: ' + err);
  }
}

// --- Profile backup ---

async function exportFullProfile() {
  const [scriptsRes, settingsRes] = await Promise.all([
    sendToBackground({ type: 'getScripts' }),
    sendToBackground({ type: 'getSettings' })
  ]);
  const payload = {
    type: 'mini-userscript-profile',
    version: 1,
    timestamp: Date.now(),
    scripts: scriptsRes.scripts || [],
    settings: settingsRes.settings || settingsRes || {},
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'mini-userscript-profile.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function importFullProfileFromFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || data.type !== 'mini-userscript-profile') {
    throw new Error('Not a Mini Userscript Pro profile backup.');
  }
  const scripts = Array.isArray(data.scripts) ? data.scripts : [];
  const settings = data.settings || {};
  await Promise.all([
    sendToBackground({ type: 'saveScripts', scripts }),
    sendToBackground({ type: 'saveSettings', settings }),
  ]);
  currentScripts = scripts;
  applySettingsToUI(settings);
  renderScripts(scripts);
}

// --- DOMContentLoaded wiring ---

document.addEventListener('DOMContentLoaded', async () => {
  // Settings
  let settings = await loadSettings();
  applySettingsToUI(settings);

  const invertToggle = document.getElementById('themeInvertToggle');
  const safeModeToggle = document.getElementById('safeModeToggle');

  if (invertToggle) {
    invertToggle.addEventListener('change', async () => {
      const newSettings = Object.assign({}, settings, {
        themeMode: invertToggle.checked ? 'inverse' : 'system',
      });
      settings = newSettings;
      applySettingsToUI(newSettings);
      await saveSettings(newSettings);
    });
  }

  if (safeModeToggle) {
    safeModeToggle.addEventListener('change', async () => {
      const newSettings = Object.assign({}, settings, {
        safeMode: safeModeToggle.checked,
      });
      settings = newSettings;
      applySettingsToUI(newSettings);
      await saveSettings(newSettings);
    });
  }

  // Tabs
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));
  function activateTab(tabName) {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === tabName));
    panels.forEach(p => p.classList.toggle('active', p.dataset.panel === tabName));
  }
  tabs.forEach(t => {
    t.addEventListener('click', () => activateTab(t.dataset.tab));
  });

  // Page inspector

  // Page inspector initial refresh
  try {
    refreshPageInspector();
  } catch (e) {}

  // Scripts tab
  const scriptSearchInput = document.getElementById('scriptSearch');
  const newForThisSiteBtn = document.getElementById('newForThisSiteBtn');
  const pauseForThisSiteBtn = document.getElementById('pauseForThisSiteBtn');

  if (scriptSearchInput) {
    scriptSearchInput.addEventListener('input', () => {
      scriptSearchQuery = scriptSearchInput.value || '';
      renderScripts(currentScripts);
    });
  }

  if (newForThisSiteBtn) {
    newForThisSiteBtn.addEventListener('click', () => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        const tab = tabs && tabs[0];
        let originPattern = '';
        if (tab && tab.url) {
          try {
            const u = new URL(tab.url);
            const host = u.hostname.replace(/^www\./i, '');
            originPattern = '*://' + host + '/*';
          } catch (e) {}
        }
        openEditor(null);
        const matchesInput = document.getElementById('editMatches');
        if (matchesInput && originPattern) {
          matchesInput.value = originPattern;
        }
      });
    });
  }

  if (pauseForThisSiteBtn) {
    pauseForThisSiteBtn.addEventListener('click', async () => {
      chrome.tabs.query({ active: true, currentWindow: true }, async tabs => {
        const tab = tabs && tabs[0];
        if (!tab || !tab.url) return;
        let host = '';
        try {
          const u = new URL(tab.url);
          host = u.hostname.replace(/^www\./i, '');
        } catch (e) {}
        if (!host) return;
        const settingsNow = await loadSettings();
        const disabled = settingsNow.scriptDisabledHosts || [];
        const idx = disabled.indexOf(host);
        if (idx >= 0) disabled.splice(idx, 1);
        else disabled.push(host);
        const newSettings = Object.assign({}, settingsNow, { scriptDisabledHosts: disabled });
        await saveSettings(newSettings);
        applySettingsToUI(newSettings);
        refreshPageInspector();
      });
    });
  }

  if (scriptSearchInput) {
    scriptSearchInput.addEventListener('input', () => {
      scriptSearchQuery = scriptSearchInput.value || '';
      renderScripts(currentScripts);
    });
  }

  const newScriptBtn = document.getElementById('newScriptBtn');
  const exportScriptsBtn = document.getElementById('exportScriptsBtn');
  const importScriptsBtn = document.getElementById('importScriptsBtn');
  const importScriptsFile = document.getElementById('importScriptsFile');
  const saveScriptBtn = document.getElementById('saveScriptBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');

  if (newScriptBtn) newScriptBtn.addEventListener('click', () => openEditor(null));
  if (saveScriptBtn) saveScriptBtn.addEventListener('click', saveEditor);
  if (cancelEditBtn) cancelEditBtn.addEventListener('click', closeEditor);

  if (exportScriptsBtn) {
    exportScriptsBtn.addEventListener('click', async () => {
      const res = await sendToBackground({ type: 'getScripts' });
      const scripts = res.scripts || [];
      const blob = new Blob([JSON.stringify({ scripts }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mini-userscripts.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }

  if (importScriptsBtn && importScriptsFile) {
    importScriptsBtn.addEventListener('click', () => importScriptsFile.click());
    importScriptsFile.addEventListener('change', () => {
      const file = importScriptsFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const text = e.target.result;
          const data = JSON.parse(text);
          const scripts = data.scripts || data || [];
          await sendToBackground({ type: 'saveScripts', scripts });
          const newScripts = await loadScriptsAndMeta();
          renderScripts(newScripts);
          alert('Imported scripts.');
        } catch (err) {
          console.error('Import scripts failed', err);
          alert('Failed to import scripts: ' + err);
        } finally {
          importScriptsFile.value = '';
        }
      };
      reader.readAsText(file);
    });
  }

  // Discover tab
  const discoverQueryInput = document.getElementById('discoverQuery');
  const discoverSourceSelect = document.getElementById('discoverSource');
  const discoverSearchBtn = document.getElementById('discoverSearchBtn');
  const installFromUrlBtn = document.getElementById('installFromUrlBtn');

  async function runDiscoverSearch() {
    const q = discoverQueryInput ? discoverQueryInput.value : '';
    const src = discoverSourceSelect ? discoverSourceSelect.value : 'all';
    if (!q.trim()) return;
    discoverLoading = true;
    discoverResults = [];
    renderDiscoverResults();
    const res = await searchOnlineScripts(q, src);
    discoverLoading = false;
    discoverResults = res;
    renderDiscoverResults();
  }

  if (discoverSearchBtn && discoverQueryInput && discoverSourceSelect) {
    discoverSearchBtn.addEventListener('click', runDiscoverSearch);
    discoverQueryInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') runDiscoverSearch();
    });
  }

  if (installFromUrlBtn) {
    installFromUrlBtn.addEventListener('click', () => {
      installFromUrlFlow();
    });
  }

  // Settings tab: profile backup
  const exportProfileBtn = document.getElementById('exportProfileBtn');
  const importProfileBtn = document.getElementById('importProfileBtn');
  const importProfileFile = document.getElementById('importProfileFile');

  if (exportProfileBtn) {
    exportProfileBtn.addEventListener('click', () => {
      exportFullProfile().catch(err => {
        console.error('Export profile failed', err);
        alert('Export failed: ' + err);
      });
    });
  }

  if (importProfileBtn && importProfileFile) {
    importProfileBtn.addEventListener('click', () => importProfileFile.click());
    importProfileFile.addEventListener('change', () => {
      const file = importProfileFile.files[0];
      if (!file) return;
      importFullProfileFromFile(file)
        .then(() => {
          alert('Profile imported.');
        })
        .catch(err => {
          console.error('Import profile failed', err);
          alert('Import failed: ' + err);
        })
        .finally(() => {
          importProfileFile.value = '';
        });
    });
  }

  // Initial load of scripts
  const scripts = await loadScriptsAndMeta();
  renderScripts(scripts);
});