// Paste into the Claude Browser (javascript_tool) on an alltuu album page.
// Installs a fetch/XHR hook that captures every photo-list page as the SPA
// lazy-loads it, so we never fight the server-side page signing.
(function () {
  if (window.__HARVEST) return 'already installed; count=' + window.__HARVEST.size;
  window.__HARVEST = new Map();          // n -> {n, sl, os, w, h}
  window.__harvestPrev = -1;
  window.__harvestRounds = 0;

  const ingest = (text) => {
    let j; try { j = JSON.parse(text); } catch { return; }
    const d = j && j.d;
    if (!Array.isArray(d)) return;
    for (const p of d) {
      if (p && p.n && p.sl) window.__HARVEST.set(p.n, { n: p.n, sl: p.sl, os: p.os, w: p.w, h: p.h });
    }
  };

  // Hook fetch.
  const of = window.fetch;
  window.fetch = function (...a) {
    return of.apply(this, a).then((res) => {
      try {
        const u = (res && res.url) || (typeof a[0] === 'string' ? a[0] : a[0] && a[0].url) || '';
        if (/\/rest\/v4c\/fplN\//.test(u)) res.clone().text().then(ingest).catch(() => {});
      } catch {}
      return res;
    });
  };
  // Hook XHR (some SPA builds use it).
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...r) { this.__u = url; return oo.call(this, m, url, ...r); };
  XMLHttpRequest.prototype.send = function (...r) {
    this.addEventListener('load', () => { try { if (/\/rest\/v4c\/fplN\//.test(this.__u || '')) ingest(this.responseText); } catch {} });
    return os.apply(this, r);
  };

  // Scroll the tallest scrollable container (or the window) toward the bottom.
  window.__harvestScroll = () => {
    let best = document.scrollingElement || document.documentElement, bestH = best ? best.scrollHeight : 0;
    document.querySelectorAll('*').forEach((el) => {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 200 && el.scrollHeight > bestH) { best = el; bestH = el.scrollHeight; }
    });
    if (best === window || best === document.scrollingElement || best === document.documentElement) window.scrollTo(0, document.body.scrollHeight);
    else best.scrollTop = best.scrollHeight;
    return best && (best.id || best.className || best.tagName) || 'window';
  };

  // One "round": report whether the map grew since last check.
  window.__harvestStatus = () => {
    const c = window.__HARVEST.size;
    if (c === window.__harvestPrev) window.__harvestRounds++; else window.__harvestRounds = 0;
    window.__harvestPrev = c;
    return { count: c, growingRounds: window.__harvestRounds };
  };

  window.__harvestDump = () => {
    const photos = [...window.__HARVEST.values()];
    const q = (sel) => (document.querySelector(sel) && document.querySelector(sel).textContent || '').trim();
    const meta = {
      title: (document.querySelector('meta[property="og:title"]') || {}).content || document.title || '',
      dateText: q('[class*="date"]') || '',
      location: q('[class*="location"], [class*="addr"]') || '',
    };
    return JSON.stringify({ photos, meta });
  };
  return 'installed';
})();
