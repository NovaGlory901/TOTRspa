// Shared by the pages bundled in the app: colours from the listener app (it hands them to the app
// through TotrNative.saveTheme whenever the theme is applied), and a few helpers. Nothing here
// talks to a network.
(function () {
  const N = window.TotrNative;
  try {
    const t = N && N.theme && N.theme() ? JSON.parse(N.theme()) : null,
      c = t && t.colors,
      root = document.documentElement.style;
    if (c) {
      for (const k of ['bg', 'bg2', 'fg', 'dim', 'pink', 'cyan', 'lilac', 'border', 'bezel'])
        if (typeof c[k] === 'string' && /^#[0-9a-f]{6}$/i.test(c[k]))
          root.setProperty('--' + k, c[k]);
      for (const k of ['bg', 'pink', 'cyan', 'lilac'])
        if (/^#[0-9a-f]{6}$/i.test(c[k] || ''))
          root.setProperty(
            `--${k}-rgb`,
            [1, 3, 5].map(i => parseInt(c[k].slice(i, i + 2), 16)).join(', '),
          );
    }
  } catch (e) {
    /* the built-in colours stay */
  }
  // Drawn icons: typed symbols turn into coloured emoji on some phones.
  const PATHS = {
    play: 'M7 4.5v15l13-7.5z',
    pause: 'M6 4h4.5v16H6zM13.5 4H18v16h-4.5z',
    prev: 'M5.5 5h2.5v14H5.5zM19 5v14L9 12z',
    next: 'M16 5h2.5v14H16zM5 5v14l10-7z',
  };
  window.totrIcon = name =>
    `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${PATHS[name]}"/></svg>`;
})();
