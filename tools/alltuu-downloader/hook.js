// MAIN-world content script, injected at document_start on alltuu album pages.
// Hooks the page's own fetch/XHR so it captures every signed photo-list page
// (`/rest/v4c/fplN/`) as the album SPA lazy-loads it — the same trick the
// import-alltuu-album skill uses, because the provider signs each result page
// server-side and plain pagination 403s. Talks to the isolated content script
// via window.postMessage (the two worlds can't share variables directly).
(function () {
  if (window.__ALLTUU_HOOKED) return;
  window.__ALLTUU_HOOKED = true;

  const store = new Map(); // n -> {n, bl, url1920, ol, os, w, h}

  // Field tiers, consistent across the hot + live-feed endpoints:
  //   bl = uib/ml/ 1600px medium (default), url1920 = 1620x1080, ol = 4000px.
  // (The live-feed `sl` field is only 720px — deliberately not the default.)
  const ingest = (text) => {
    let j; try { j = JSON.parse(text); } catch { return; }
    const d = j && j.d;
    if (!Array.isArray(d)) return;
    let added = 0;
    for (const p of d) {
      const url = p && (p.bl || p.url1920 || p.ol || p.sl);
      if (p && p.n && url && !store.has(p.n)) {
        store.set(p.n, { n: p.n, bl: p.bl, url1920: p.url1920, ol: p.ol, os: p.os, w: p.w, h: p.h });
        added++;
      }
    }
    if (added) window.postMessage({ __alltuu: 1, type: 'count', count: store.size }, '*');
  };

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

  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url, ...r) { this.__u = url; return oo.call(this, m, url, ...r); };
  XMLHttpRequest.prototype.send = function (...r) {
    this.addEventListener('load', () => {
      try {
        if (!/\/rest\/v4c\/fplN\//.test(this.__u || '')) return;
        // responseText throws if responseType isn't '' / 'text'; fall back to .response.
        const t = (this.responseType === '' || this.responseType === 'text')
          ? this.responseText
          : (typeof this.response === 'string' ? this.response : JSON.stringify(this.response));
        ingest(t);
      } catch {}
    });
    return os.apply(this, r);
  };

  // Commands from the isolated content script.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__alltuu_cmd !== 1) return;
    const { cmd, id } = e.data;

    if (cmd === 'dump') {
      const title = (document.querySelector('meta[property="og:title"]') || {}).content || document.title || '';
      window.postMessage({ __alltuu: 1, type: 'reply', id, photos: [...store.values()], title, count: store.size }, '*');

    } else if (cmd === 'scroll') {
      let best = document.scrollingElement || document.documentElement;
      let bestH = best ? best.scrollHeight : 0;
      document.querySelectorAll('*').forEach((el) => {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 200 && el.scrollHeight > bestH) {
          best = el; bestH = el.scrollHeight;
        }
      });
      if (best === document.scrollingElement || best === document.documentElement) {
        window.scrollTo(0, document.body.scrollHeight);
      } else {
        best.scrollTop = best.scrollHeight;
      }
      window.postMessage({ __alltuu: 1, type: 'reply', id, count: store.size }, '*');

    } else if (cmd === 'enter') {
      const clickText = (texts) => {
        const all = [...document.querySelectorAll('div,span,a,li,button')];
        const el = all.find((x) => texts.includes((x.textContent || '').trim()) && x.children.length <= 1);
        if (el) { el.click(); return true; }
        return false;
      };
      const enter = clickText(['进入喔图直播', '进入', '进入直播']);
      const tab = clickText(['图片直播', '直播']);
      window.postMessage({ __alltuu: 1, type: 'reply', id, enter, tab, count: store.size }, '*');
    }
  });
})();
