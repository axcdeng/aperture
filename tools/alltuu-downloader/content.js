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
})();
