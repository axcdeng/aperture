// Content script for the Aperture site's album pages. Injects a "View full
// size" button on each photo tile that opens the 4000px original from the
// linked alltuu album. The filename→original map is harvested once from the
// alltuu album (in a background tab) and cached in chrome.storage (~25 days,
// bounded by the OSS signature lifetime), so every click after the first is
// instant.
//
// The album page is a client-rendered React component that mounts AFTER this
// script runs (document_idle), and it's an SPA (navigating between albums does
// not reload). So we don't read the DOM once — we observe it and (re)resolve
// the album context on every change.
(function () {
  // Let the site know the extension is present (it hides/hint its bulk-download
  // buttons accordingly).
  document.documentElement.setAttribute('data-aperture-ext', '1');

  let albumUrl = null;
  let albumId = null;
  let cacheKey = null;
  let harvestedThisView = false; // did we run a full harvest for this album already?

  // Minimal toast for bulk-download progress (downloads run in the background
  // worker, so there's no button label to update).
  let toastEl = null;
  const toast = (msg, ms) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      Object.assign(toastEl.style, {
        position: 'fixed', bottom: '16px', right: '16px', zIndex: '2147483647',
        font: '600 12px system-ui, sans-serif', padding: '8px 12px', borderRadius: '8px',
        background: 'rgba(0,0,0,.85)', color: '#fff', maxWidth: '320px',
        boxShadow: '0 4px 16px rgba(0,0,0,.4)',
      });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.style.opacity = '1';
    if (ms) setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, ms);
  };
  const safeName = (s) =>
    (s || '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'group';

  // (Re)resolve which album this page is currently showing. Returns false when
  // the album root / its alltuu URL isn't in the DOM yet (still rendering, or a
  // non-album page). Safe to call repeatedly.
  function refreshCtx() {
    const root = document.querySelector('[data-aperture-album]');
    const u = root && root.getAttribute('data-alltuu-album-url');
    if (!u) { albumUrl = null; return false; }
    if (u !== albumUrl) {
      albumUrl = u;
      albumId = (u.match(/[a-f0-9]{32}/i) || [u])[0];
      cacheKey = 'album:' + albumId;
      harvestedThisView = false; // new album (or SPA nav) → allow one harvest
    }
    return true;
  }

  const readFresh = () =>
    new Promise((res) => chrome.storage.local.get(cacheKey, (o) => {
      const c = o[cacheKey];
      res(c && c.expires > Date.now() ? c : null);
    }));

  const clearCache = () => new Promise((res) => chrome.storage.local.remove(cacheKey, res));

  // Trigger a fresh harvest and poll storage for the result — polling (not a
  // message response) so it survives the service worker being suspended.
  const runHarvest = async (onProgress) => {
    await clearCache();
    chrome.runtime.sendMessage({ type: 'openHarvestTab', url: albumUrl, albumId });
    const started = Date.now();
    while (Date.now() - started < 150000) {
      await new Promise((r) => setTimeout(r, 1200));
      const c = await readFresh();
      if (c) return c;
      if (onProgress) onProgress(Math.round((Date.now() - started) / 1000));
    }
    return null;
  };

  // Exact match, then case-insensitive (the site's stored filename and alltuu's
  // `n` can differ in case, e.g. .JPG vs .jpg).
  const lookup = (map, filename) => {
    if (!map) return null;
    if (map[filename]) return map[filename];
    const lc = filename.toLowerCase();
    for (const k in map) if (k.toLowerCase() === lc) return map[k];
    return null;
  };

  const openFull = async (filename, btn) => {
    const label = btn.textContent;
    let c = await readFresh();
    let url = c ? lookup(c.map, filename) : null;

    // Miss → run a full harvest once per album view (the cached map may be
    // absent, expired, or a partial capture from the old throttled-tab bug —
    // the page grid is virtualized so we can't judge completeness from the DOM).
    // The once-per-view guard stops a genuinely-absent photo from re-harvesting
    // on every click.
    if (!url && !harvestedThisView) {
      btn.textContent = 'Preparing…';
      harvestedThisView = true;
      c = await runHarvest((s) => { btn.textContent = 'Preparing… ' + s + 's'; });
      url = c ? lookup(c.map, filename) : null;
    }
    btn.textContent = label;

    if (!url) {
      btn.textContent = 'not found';
      setTimeout(() => { btn.textContent = label; }, 2200);
      return;
    }
    window.open(url, '_blank', 'noopener');
  };

  const addButton = (tile) => {
    if (tile.__vfs) return;
    const filename = tile.getAttribute('data-original-filename');
    if (!filename) return;
    tile.__vfs = true;
    if (getComputedStyle(tile).position === 'static') tile.style.position = 'relative';
    const btn = document.createElement('button');
    btn.textContent = 'View full size';
    btn.setAttribute('data-vfs-btn', '');
    Object.assign(btn.style, {
      position: 'absolute', top: '6px', right: '6px', zIndex: '30',
      font: '600 11px system-ui, sans-serif', padding: '3px 7px', borderRadius: '5px',
      border: 'none', background: 'rgba(0,0,0,.72)', color: '#fff', cursor: 'pointer',
      opacity: '0', transition: 'opacity .15s', pointerEvents: 'auto',
    });
    tile.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    tile.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openFull(filename, btn); });
    tile.appendChild(btn);
  };

  // Bulk download a group/selection the site hands us. Payload (JSON string in
  // event.detail, to survive the page↔content-script world boundary):
  //   { tier: 'full'|'site', label, items: [{ filename, imgUrl }] }
  // full → 4000px alltuu originals (via the harvested index); site → the 1080px
  // display URLs the site already has. Each group lands in its own
  // ~/Downloads/<albumSlug>_<label>/ folder.
  const onBulkDownload = async (e) => {
    let payload; try { payload = JSON.parse(e.detail); } catch { return; }
    const { tier, label } = payload;
    const items = payload.items || [];
    if (!items.length) return;

    refreshCtx();
    const slug = (document.querySelector('[data-aperture-album]') || {})
      .getAttribute?.('data-album-slug') || albumId || 'album';
    const folder = safeName(slug) + '_' + safeName(label);

    let list;
    if (tier === 'full') {
      toast('Preparing full-size…');
      let c = await readFresh();
      if (!c && !harvestedThisView) {
        harvestedThisView = true;
        c = await runHarvest((s) => toast('Harvesting album… ' + s + 's'));
      }
      const map = c ? c.map : null;
      list = items.map((it) => ({ name: it.filename, url: lookup(map, it.filename) })).filter((x) => x.url);
      if (!list.length) { toast('Couldn\'t resolve originals — try again after it harvests.', 4000); return; }
    } else {
      list = items.map((it) => ({ name: it.filename, url: it.imgUrl })).filter((x) => x.name && x.url);
      if (!list.length) { toast('Nothing to download.', 3000); return; }
    }

    toast('Downloading ' + list.length + ' → Downloads/' + folder + ' …');
    const res = await chrome.runtime.sendMessage({ type: 'bulkDownload', folder, items: list });
    const ok = res ? res.ok : list.length, fail = res ? res.fail : 0;
    toast('Done: ' + ok + ' → Downloads/' + folder + (fail ? '  (' + fail + ' failed)' : ''), 6000);
  };
  window.addEventListener('aperture:bulk-download', onBulkDownload);

  // The lightbox "High quality" toggle asks for a single photo's full-size URL.
  // Reply with the alltuu original from the index (harvesting once if needed).
  const onResolveHq = async (e) => {
    let d; try { d = JSON.parse(e.detail); } catch { return; }
    const filename = d && d.filename, reqId = d && d.reqId;
    if (!filename || !reqId) return;
    const reply = (url) =>
      window.dispatchEvent(new CustomEvent('aperture:hq-url', { detail: JSON.stringify({ reqId, url: url || null }) }));
    refreshCtx();
    let c = await readFresh();
    let url = c ? lookup(c.map, filename) : null;
    if (!url && !harvestedThisView) {
      harvestedThisView = true;
      c = await runHarvest();
      url = c ? lookup(c.map, filename) : null;
    }
    reply(url);
  };
  window.addEventListener('aperture:resolve-hq', onResolveHq);

  let scanQueued = false;
  const scan = () => {
    scanQueued = false;
    if (!refreshCtx()) return; // album/url not in DOM yet — wait for next change
    document.querySelectorAll('[data-original-filename]').forEach(addButton);
  };
  const queueScan = () => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan); // debounce bursts of React mutations
  };

  // Observe from the start; the album content mounts and re-renders later.
  queueScan();
  new MutationObserver(queueScan).observe(document.documentElement, { childList: true, subtree: true });
})();
