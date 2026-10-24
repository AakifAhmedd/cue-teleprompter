/* CUE — app bootstrap. Version comes from the VERSION file (see VERSIONING.md). */
(function () {
  'use strict';

  async function showVersion() {
    const badge = document.getElementById('app-version');
    try {
      const res = await fetch('VERSION?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const v = (await res.text()).trim();
      if (/^\d+\.\d+\.\d+$/.test(v)) badge.textContent = 'v' + v;
    } catch (_) { /* offline: the service worker serves the cached copy, else stays blank */ }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* not fatal */ });
    });
  }

  showVersion();
  registerServiceWorker();
})();
