# 🧩 Mini Userscript Pro

**Mini Userscript Pro** is a lightweight, MV3-based userscript manager extension for Chromium browsers (Chrome / Brave / Edge).  
It’s designed to be:

- Minimal but powerful
- Keyboard + mouse friendly
- Great for experimenting with automation, cosmetic tweaks, and site-specific tools

Think of it as a focused, developer-friendly playground for userscripts.

---

## ✨ Features

### 🔧 Core Userscript Engine

- Run custom JavaScript on matching pages
- Per-script:
  - Enable / disable toggle
  - @match / @include style URL targeting
  - Description + tags
- “This page” inspector:
  - Shows which scripts are active on the current tab
  - Quick toggles per script

### 🎛 Popup UI (Mini Control Center)

From the browser action (toolbar button) popup, you can:

- See all installed scripts
- Quickly:
  - Enable / disable scripts globally
  - Toggle individual scripts
  - Open script editor
  - See how many scripts are active on the current tab
- Per-domain pause list:
  - Temporarily disable all scripts on a site without uninstalling them

### 🧠 Script Engine Helpers

Mini Userscript Pro exposes a small, practical subset of Greasemonkey-style helpers (implemented in the extension):

- `GM_getValue(key, defaultValue)`
- `GM_setValue(key, value)`
- `GM_addStyle(cssText)`
- `GM_registerMenuCommand(label, callback)` (exposed via the popup’s menu)

> Note: This is intentionally **minimal** and focused. The goal is to keep the engine easy to reason about and extend.

### 🔍 Script Discovery (Search & Install)

- Internal search pane for discovering scripts
- Integrations (via fetch) with:
  - **Greasy Fork**
  - **OpenUserJS**
- Install flow:
  - Search → view script metadata → install into Mini Userscript Pro
  - Scripts can later be updated or removed from within the extension

*(Important: this is meant for **legit userscripts**, not anything that bypasses DRM, paywalls, or access controls.)*

### 🧷 In-Page Badge (Optional)

- Small floating badge overlay:  
  **“N scripts active”** on the current page
- Click to:
  - Open “This page” inspector
  - Quickly toggle scripts for that site

### 🎨 Theming

- Built-in theme system for the popup UI:
  - Light / Dark themes
  - Accent slider or preset theme options
- Theme state is persisted via `GM_getValue`/`GM_setValue`-style storage so your look is remembered.

---

## 🏗 Architecture

Mini Userscript Pro is built as a **Chrome MV3 extension**:

- `manifest.json` – MV3 config, action, permissions, content scripts
- `background` / service worker – script registry, storage, install/update
- `content_script.js` – injects and executes userscripts in page context
- `popup.html` / `popup.js` – main UI for managing scripts & settings
- `options.html` / `options.js` (optional) – advanced settings & debug view
- `storage` – script definitions, metadata, user preferences

Scripts are stored in extension-managed storage and injected based on URL pattern matching.

---

## 🔐 Permissions

Mini Userscript Pro uses the minimum set of permissions needed to function:

- `scripting` – to inject userscripts into pages
- `storage` – to store scripts, preferences, and state
- `activeTab` – to interact with the current tab on demand
- `tabs` (if used) – to read basic URL info for matching & “This page” inspector
- Optional `*://*/*` host permissions – if you want scripts to run on all sites

Exact permissions are defined in `manifest.json`.

---

## 🚀 Installation (Developer Mode)

1. Clone or download this repo:
   ```bash
   git clone https://github.com/your-username/mini-userscript-pro.git
2. Open Chrome / Brave / Edge → go to:

chrome://extensions


3. Enable Developer mode (top right).

4. Click “Load unpacked” and select the project folder (containing manifest.json).

5. You should now see the Mini Userscript Pro icon in your toolbar.

🧪 Usage
Add a New Script

Click the Mini Userscript Pro toolbar icon.

In the popup, click “New Script” (or similar button).

Fill in:

Name

Description

Match pattern(s) (e.g. *://example.com/*)

Code body

Save. The script will now appear in the list and run on matching pages.

Manage Scripts

From the popup:

Toggle script on/off globally

Toggle script for the current domain (if per-domain controls are implemented)

Open editor to modify code

Delete script when no longer needed

Use the “This Page” Inspector

Open the popup on any page

Go to “This Page” tab/section

See:

Which scripts are active

Quick toggles

The in-page badge count

🧱 Development Notes

Built for MV3 from the ground up

Designed to be framework-agnostic (plain JS/HTML/CSS)

Focus is on:

Simplicity

Predictable behavior

Easy extension

If you want to extend Mini Userscript Pro, good candidates are:

Additional GM_* APIs (e.g. GM_xmlhttpRequest, clipboard helpers)

Per-script sandboxing options

Backup / export & import of scripts

Sync across devices using chrome.storage.sync

⚖️ Legal & Ethical Use

Mini Userscript Pro is intended for:

Cosmetic tweaks

Quality-of-life improvements

Workflow automation on sites you’re allowed to interact with

You are responsible for how you use it.
Do not use this tool (or scripts built on top of it) to:

Bypass paywalls, DRM, or subscription access controls

Circumvent security mechanisms

Violate website terms of service
