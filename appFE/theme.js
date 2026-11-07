// Light / dark toggle. <html data-theme> is set before first paint by the inline
// script in index.html; this wires the button, persists the choice (a convenience
// only — guarded) and follows live OS changes until the user has chosen.
(function () {
  const root = document.documentElement;
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function saved() {
    try {
      const t = localStorage.getItem('theme');
      return t === 'light' || t === 'dark' ? t : null;
    } catch (e) { return null; }
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    const dark = theme === 'dark';
    const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
    btn.setAttribute('aria-pressed', String(dark));
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  apply(root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');

  btn.addEventListener('click', function () {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    apply(next);
    try { localStorage.setItem('theme', next); } catch (e) { /* storage unavailable */ }
  });

  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function (e) {
      if (!saved()) apply(e.matches ? 'dark' : 'light');
    });
  }
})();
