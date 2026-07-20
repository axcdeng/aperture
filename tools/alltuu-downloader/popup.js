const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let photos = [];

function setStatus(t) { $('#status').textContent = t; }
function setBar(frac) { $('#fill').style.width = Math.max(0, Math.min(1, frac)) * 100 + '%'; }

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function tabMsg(type, extra = {}) {
  const t = await activeTab();
  try {
    return await chrome.tabs.sendMessage(t.id, { type, ...extra });
  } catch (e) {
    return { error: 'no content script — is this an m.alltuu.com/album/ page? (reload it after installing)' };
  }
}

function suggestFolder(title) {
  if (!title) return '';
  // Chinese titles don't make good folder names; leave a safe ascii stub.
  const ascii = title.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return ascii.length >= 3 ? ascii.slice(0, 40) : '';
}

// Alltuu albums open on the "popular" tab (menu=hot, ~50 photos). Force the
// live feed so we harvest the whole album.
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

async function waitReady(tabId, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await chrome.tabs.sendMessage(tabId, { type: 'status' })) return true; } catch (e) {}
    await sleep(500);
  }
  return false;
}

$('#harvest').onclick = async () => {
  $('#harvest').disabled = true;
  setBar(0);

  // Make sure we're on the live feed (full album), not the ~50-photo popular
  // tab — navigate the tab to menu=live first if needed.
  const tab = await activeTab();
  const live = tab && tab.url ? normalizeLive(tab.url) : null;
  if (live && tab.url !== live) {
    setStatus('Switching to live feed…');
    await chrome.tabs.update(tab.id, { url: live });
    await waitReady(tab.id);
    await sleep(1500);
  }

  setStatus('Entering live feed…');
  const en = await tabMsg('enter');
  if (en.error) { setStatus(en.error); $('#harvest').disabled = false; return; }
  await sleep(1500);

  let prev = -1, stable = 0;
  for (let i = 0; i < 80 && stable < 3; i++) {
    const r = await tabMsg('scroll');
    await sleep(700);
    const c = (r && r.count) || 0;
    setStatus('Harvesting… ' + c + ' photos');
    if (c === prev) stable++; else stable = 0;
    prev = c;
  }

  const d = await tabMsg('dump');
  photos = (d && d.photos) || [];
  if (!$('#folder').value) $('#folder').value = suggestFolder(d && d.title);

  // Also save the "View full size" index for the Aperture site, so clicking a
  // photo there is instant (no on-demand background harvest). This reuses the
  // full harvest we just did — re-harvesting later (e.g. after the event adds
  // photos) refreshes the whole map, including fresh signatures.
  const indexed = await saveViewIndex(photos);

  setStatus('Harvested ' + photos.length + ' photos'
    + (indexed ? ' — indexed ' + indexed + ' for instant View full size' : '')
    + '. Set a folder name, then Download all.');
  $('#download').disabled = photos.length === 0;
  $('#harvest').disabled = false;
};

// Write filename→original-URL into chrome.storage under the current album's id,
// the same cache the Aperture "View full size" button reads.
async function saveViewIndex(list) {
  const tab = await activeTab();
  const id = (tab && tab.url && tab.url.match(/[a-f0-9]{32}/i) || [])[0];
  if (!id) return 0;
  const map = {};
  for (const p of list) {
    const full = p.ol || p.url1920 || p.bl; // prefer the 4000px original
    if (p.n && full) map[p.n] = full;
  }
  const count = Object.keys(map).length;
  if (count) {
    const expires = Date.now() + 25 * 24 * 60 * 60 * 1000; // ~OSS signature life
    await chrome.storage.local.set({ ['album:' + id]: { expires, map, count } });
  }
  return count;
}

$('#download').onclick = async () => {
  const folder = ($('#folder').value || 'album').trim().replace(/[^A-Za-z0-9._-]/g, '_');
  $('#folder').value = folder;
  const field = $('#tier').value;
  $('#download').disabled = true;
  setStatus('Checking what\'s already downloaded…');

  const res = await chrome.runtime.sendMessage({ type: 'download', photos, folder, field });
  const toGet = (res && res.queued) || 0;
  const skipped = (res && res.skipped) || 0;
  const invalid = (res && res.invalid) || 0;
  setStatus(`Queued ${toGet}, skipped ${skipped} already-have${invalid ? ', ' + invalid + ' invalid' : ''}. Downloading…`);

  // Poll progress until in-flight drains.
  let idle = 0;
  const iv = setInterval(async () => {
    const p = await chrome.runtime.sendMessage({ type: 'progress', folder, total: photos.length });
    if (!p) return;
    const got = Math.max(0, p.complete - skipped); // completes attributable to this run (approx)
    setBar(toGet ? (p.complete) / (skipped + toGet) : 1);
    setStatus(`Downloading: ${p.complete}/${skipped + toGet} in folder  (in-flight ${p.inprog}, failed ${p.failed})`);
    if (p.inprog === 0) { idle++; } else { idle = 0; }
    if (idle >= 2) {
      clearInterval(iv);
      setBar(1);
      setStatus(`Done → ~/Downloads/${folder}/\n${p.complete} present, ${p.failed} failed, ${skipped} skipped.\nMove into Albums/${folder}/ then run tagging.`);
      $('#download').disabled = false;
    }
  }, 900);
};
