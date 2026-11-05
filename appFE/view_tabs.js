// Top-level view switcher (Quick Tools / Group Draw). Pure show/hide — no view
// is re-rendered or reset by switching. The selected view lives in the URL hash
// (#group-draw) so it can be linked; no hash means the default first tab.
(function () {
  const tabs = Array.from(document.querySelectorAll('.view-tabs [role="tab"]'));
  if (!tabs.length) return;

  function panelOf(tab) {
    return document.getElementById(tab.getAttribute('aria-controls'));
  }

  function select(tab, opts) {
    const o = opts || {};
    tabs.forEach((t) => {
      const on = t === tab;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.classList.toggle('is-active', on);
      const panel = panelOf(t);
      if (panel) {
        panel.hidden = !on;
        if (on && o.animate) {
          panel.classList.remove('is-entering');
          void panel.offsetWidth; // restart the fade-in
          panel.classList.add('is-entering');
        }
      }
    });
    if (o.focus) tab.focus();
    if (o.updateUrl && window.history && history.pushState) {
      const hash = tab.dataset.hash;
      const url = hash ? '#' + hash : location.pathname + location.search;
      if ((location.hash || '') !== (hash ? '#' + hash : '')) history.pushState(null, '', url);
    }
  }

  function fromUrl() {
    const hash = (location.hash || '').slice(1);
    return tabs.find((t) => t.dataset.hash && t.dataset.hash === hash) || tabs[0];
  }

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab, { updateUrl: true, animate: true }));
    tab.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      select(next, { focus: true, updateUrl: true, animate: true });
    });
  });

  window.addEventListener('hashchange', () => select(fromUrl(), { animate: true }));
  window.addEventListener('popstate', () => select(fromUrl(), { animate: true }));
  select(fromUrl());
})();
