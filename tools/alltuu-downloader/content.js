// ISOLATED-world content script. Relays between the extension popup
// (chrome.runtime messaging) and the MAIN-world hook (window.postMessage).
(function () {
  const pending = new Map();
  let lastCount = 0;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__alltuu !== 1) return;
    const d = e.data;
    if (typeof d.count === 'number') lastCount = d.count;
    if (d.type === 'reply' && d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  });

  function sendCmd(cmd, extra = {}) {
    return new Promise((resolve) => {
      const id = 'c' + Date.now() + Math.floor(Math.random() * 1e6);
      pending.set(id, resolve);
      window.postMessage({ __alltuu_cmd: 1, cmd, id, ...extra }, '*');
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); resolve({ timeout: true, count: lastCount }); }
      }, 6000);
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      if (msg.type === 'enter') sendResponse(await sendCmd('enter'));
      else if (msg.type === 'scroll') sendResponse(await sendCmd('scroll'));
      else if (msg.type === 'dump') sendResponse(await sendCmd('dump'));
      else if (msg.type === 'status') sendResponse({ count: lastCount });
      else sendResponse({});
    })();
    return true; // async response
  });

  // --- Auto-harvest mode -------------------------------------------------
  // When the Aperture "View full size" flow opens this album in a background
  // tab (URL hash contains __aph), scroll the whole live feed, then write the
  // filename→original-URL map straight to chrome.storage. Done here (in the
  // page's own content script) rather than the service worker, so the harvest
  // completes even if the worker is suspended.
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function autoHarvest() {
    const albumId = (location.href.match(/[a-f0-9]{32}/i) || [location.href])[0];
    await sleep(2000);
    await sendCmd('enter');       // click past splash + into 图片直播
    await sleep(1500);
    let prev = -1, stable = 0;
    for (let i = 0; i < 120 && stable < 3; i++) {
      const r = await sendCmd('scroll');
      await sleep(700);
      const c = (r && r.count) || 0;
      if (c === prev) stable++; else stable = 0;
      prev = c;
    }
    const d = await sendCmd('dump');
    const map = {};
    for (const p of (d.photos || [])) {
      const full = p.ol || p.url1920 || p.bl; // prefer 4000px original
      if (p.n && full) map[p.n] = full;
    }
    if (Object.keys(map).length) {
      // 25 days: comfortably inside the ~1-month OSS signature lifetime.
      const expires = Date.now() + 25 * 24 * 60 * 60 * 1000;
      chrome.storage.local.set({ ['album:' + albumId]: { expires, map, count: Object.keys(map).length } });
    }
    try { chrome.runtime.sendMessage({ type: 'harvestDone', albumId }); } catch (e) {}
  }
  if (location.hash.includes('__aph')) autoHarvest();
})();
