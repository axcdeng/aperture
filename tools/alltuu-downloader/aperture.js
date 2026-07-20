// Content script for the Aperture site's album pages. Injects a "View full
// size" button on each photo tile that opens the 4000px original from the
// linked alltuu album. The filename→original map is harvested once from the
// alltuu album (in a background tab) and cached in chrome.storage (~25 days,
// bounded by the OSS signature lifetime), so every click after the first is
// instant.
(function () {
  const root = document.querySelector('[data-aperture-album]');
  if (!root) return; // not an album page
  const albumUrl = root.getAttribute('data-alltuu-album-url') || '';
  if (!albumUrl) return; // this album has no linked alltuu source

  const albumId = (albumUrl.match(/[a-f0-9]{32}/i) || [albumUrl])[0];
  const CACHE_KEY = 'album:' + albumId;

  const readCache = () =>
    new Promise((res) => chrome.storage.local.get(CACHE_KEY, (o) => res(o[CACHE_KEY] || null)));

  const freshMap = async () => {
    const c = await readCache();
    return c && c.expires > Date.now() ? c.map : null;
  };

  // Ask the background worker to harvest, then poll storage for the result —
  // polling (not a message response) so it survives the service worker being
  // suspended mid-harvest.
  const ensureHarvest = async (onProgress) => {
    let map = await freshMap();
    if (map) return map;
    chrome.runtime.sendMessage({ type: 'openHarvestTab', url: albumUrl, albumId });
    const started = Date.now();
    while (Date.now() - started < 120000) {
      await new Promise((r) => setTimeout(r, 1200));
      map = await freshMap();
      if (map) return map;
      if (onProgress) onProgress(Math.round((Date.now() - started) / 1000));
    }
    return null;
  };

  const openFull = async (filename, btn) => {
    const label = btn.textContent;
    let map = await freshMap();
    if (!map) {
      btn.textContent = 'Preparing…';
      map = await ensureHarvest((s) => { btn.textContent = 'Preparing… ' + s + 's'; });
    }
    btn.textContent = label;
    const url = map && map[filename];
    if (!url) {
      btn.textContent = 'not found';
      setTimeout(() => { btn.textContent = label; }, 2000);
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
      position: 'absolute', top: '6px', right: '6px', zIndex: '20',
      font: '600 11px system-ui, sans-serif', padding: '3px 7px', borderRadius: '5px',
      border: 'none', background: 'rgba(0,0,0,.72)', color: '#fff', cursor: 'pointer',
      opacity: '0', transition: 'opacity .15s',
    });
    tile.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    tile.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
    btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openFull(filename, btn); });
    tile.appendChild(btn);
  };

  const scan = () => document.querySelectorAll('[data-original-filename]').forEach(addButton);

  // Tiles render lazily / on view changes — keep injecting as they appear.
  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
