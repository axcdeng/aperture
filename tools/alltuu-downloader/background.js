// Service worker: owns the bulk download. Fires all chrome.downloads.download
// calls (Chrome self-limits concurrency per host, ~6), so the download survives
// the service worker being suspended — Chrome's download manager keeps going.
// Progress is derived from chrome.downloads.search, so it is recomputable even
// after a worker restart. Skip-set = files already downloaded into this folder
// (from Chrome's download history, filtered to existing files).

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Close (and forget) the harvest window for an album. Robust to the service
// worker having been suspended: the window id lives in chrome.storage, not just
// memory.
function closeHarvest(albumId) {
  const key = 'harvestWin:' + albumId;
  chrome.storage.local.get(key, (o) => {
    if (o[key] != null) {
      chrome.windows.remove(o[key], () => void chrome.runtime.lastError);
      chrome.storage.local.remove(key);
    }
  });
}

// Alltuu albums open on the "popular" tab (menu=hot, ~50 photos). Force the
// live feed (menu=live) so we harvest the whole album. Also drops any hash.
function normalizeLive(u) {
  try {
    const url = new URL(u);
    url.hash = '';
    url.searchParams.set('menu', 'live');
    return url.toString();
  } catch (e) {
    return u;
  }
}

function folderRegex(folder) {
  // Match ".../<folder>/<basename>" on both / and \ path separators.
  return new RegExp('[\\\\/]' + escapeRe(folder) + '[\\\\/]([^\\\\/]+)$');
}

async function existingSet(folder) {
  const set = new Set();
  try {
    const items = await chrome.downloads.search({ limit: 0 });
    const re = folderRegex(folder);
    for (const it of items) {
      if (it.exists === false) continue;
      if (it.state && it.state !== 'complete') continue;
      const m = (it.filename || '').match(re);
      if (m) set.add(m[1]);
    }
  } catch (e) { /* history unavailable — treat as empty skip-set */ }
  return set;
}

async function progress(folder, total) {
  let complete = 0, failed = 0, inprog = 0;
  try {
    const items = await chrome.downloads.search({ limit: 0 });
    const re = folderRegex(folder);
    for (const it of items) {
      if (!re.test(it.filename || '')) continue;
      if (it.state === 'complete' && it.exists !== false) complete++;
      else if (it.state === 'interrupted') failed++;
      else if (it.state === 'in_progress') inprog++;
    }
  } catch (e) { /* ignore */ }
  return { complete, failed, inprog, total, folder };
}

async function doDownload(photos, folder, field) {
  const have = await existingSet(folder);
  let queued = 0, skipped = 0, invalid = 0;
  const targets = [];
  for (const p of photos) {
    const name = p && p.n;
    const url = p && (p[field] || p.bl || p.url1920 || p.ol);
    // name becomes a filesystem path — allow only plain basenames.
    if (!name || !url || !/^[A-Za-z0-9._-]+$/.test(name)) { invalid++; continue; }
    if (have.has(name)) { skipped++; continue; }
    targets.push({ url, filename: folder + '/' + name });
  }
  for (const t of targets) {
    try {
      await new Promise((res) => {
        chrome.downloads.download(
          { url: t.url, filename: t.filename, conflictAction: 'overwrite' },
          () => res() // resolves once the download is *issued* (returns fast)
        );
      });
      queued++;
    } catch (e) { invalid++; }
  }
  return { queued, skipped, invalid, folder, total: photos.length };
}

async function bulkDownload(folder, items) {
  let ok = 0, fail = 0;
  for (const it of items) {
    if (!it || !it.url || !it.name || !/^[A-Za-z0-9._-]+$/.test(it.name)) { fail++; continue; }
    try {
      await new Promise((res) => {
        chrome.downloads.download(
          { url: it.url, filename: folder + '/' + it.name, conflictAction: 'overwrite' },
          (id) => { if (chrome.runtime.lastError || id === undefined) fail++; else ok++; res(); },
        );
      });
    } catch (e) { fail++; }
  }
  return { ok, fail, folder };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'download') {
    doDownload(msg.photos || [], msg.folder, msg.field).then(sendResponse);
    return true;
  }
  if (msg.type === 'progress') {
    progress(msg.folder, msg.total || 0).then(sendResponse);
    return true;
  }
  // Bulk download an explicit [{name, url}] list into <folder>/ (used by the
  // Aperture site's per-group / selection download buttons).
  if (msg.type === 'bulkDownload') {
    bulkDownload(msg.folder, msg.items || []).then(sendResponse);
    return true;
  }
  // --- View-full-size harvest window lifecycle -----------------------------
  // aperture.js asks us to open the linked alltuu album; its content script
  // (autoHarvest) scrolls the live feed, writes the filename→original map to
  // chrome.storage, then pings 'harvestDone' so we close the window. aperture.js
  // reads the cache by polling storage — this is just window management.
  //
  // IMPORTANT: a *focused popup window*, not a background tab. Chrome throttles
  // hidden/background tabs (paused rAF, deprioritized rendering), so the album's
  // scroll-driven lazy-load never fires and only the first page is captured. A
  // focused window's active tab is not throttled, so the whole album loads.
  if (msg.type === 'openHarvestTab') {
    const key = 'harvestWin:' + msg.albumId;
    const url = normalizeLive(msg.url) + '#__aph';
    chrome.storage.local.get(key, (o) => {
      const open = () => chrome.windows.create(
        { url, type: 'popup', focused: true, width: 520, height: 700 },
        (win) => {
          if (win) {
            chrome.storage.local.set({ [key]: win.id });
            // Safety net: close after 100s if harvestDone never arrives.
            setTimeout(() => closeHarvest(msg.albumId), 100000);
          }
        },
      );
      if (o[key] == null) { open(); return; }
      // A window id is on record — reuse it only if it still exists.
      chrome.windows.get(o[key], {}, (w) => {
        if (chrome.runtime.lastError || !w) open();
      });
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.type === 'harvestDone') {
    closeHarvest(msg.albumId);
    sendResponse({ ok: true });
    return true;
  }
});
