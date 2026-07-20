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

$('#harvest').onclick = async () => {
  $('#harvest').disabled = true;
  setBar(0);
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
  setStatus('Harvested ' + photos.length + ' photos. Set a folder name, then Download all.');
  $('#download').disabled = photos.length === 0;
  $('#harvest').disabled = false;
};

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
