// Service worker: owns the bulk download. Fires all chrome.downloads.download
// calls (Chrome self-limits concurrency per host, ~6), so the download survives
// the service worker being suspended — Chrome's download manager keeps going.
// Progress is derived from chrome.downloads.search, so it is recomputable even
// after a worker restart. Skip-set = files already downloaded into this folder
// (from Chrome's download history, filtered to existing files).

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'download') {
    doDownload(msg.photos || [], msg.folder, msg.field).then(sendResponse);
    return true;
  }
  if (msg.type === 'progress') {
    progress(msg.folder, msg.total || 0).then(sendResponse);
    return true;
  }
});
