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
  let albumUrl = null;
  let albumId = null;
  let cacheKey = null;

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
    }
    return true;
  }

  const readFresh = () =>
    new Promise((res) => chrome.storage.local.get(cacheKey, (o) => {
      const c = o[cacheKey];
      res(c && c.expires > Date.now() ? c : null);
    }));

  const clearCache = () => new Promise((res) => chrome.storage.local.remove(cacheKey, res));

  // How many photos the page shows — a good harvest should cover ~all of them.
  // A cache with far fewer entries is a partial harvest (e.g. the old bug where
  // a throttled background tab captured only the first page) → re-harvest.
  const pageTileCount = () => document.querySelectorAll('[data-original-filename]').length;
  const isComplete = (c) => !!c && c.count >= Math.max(1, Math.floor(pageTileCount() * 0.8));

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

    // Re-harvest when there's no cache, the cache is a partial harvest, or the
    // photo is missing from an incomplete cache. A miss against a COMPLETE
    // cache is a genuine not-found (don't loop re-harvesting).
    if (!url && !isComplete(c)) {
      btn.textContent = 'Preparing…';
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
