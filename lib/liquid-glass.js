/* Liquid Glass runtime. Include once, site-wide (here: imported from components/liquid-glass.tsx).
   - Chromium (desktop + Android): real refraction via SVG displacement
   - Everything else (Safari, iOS, Firefox): frosted fallback from the CSS
   - Frosted only, by choice: .lg-frost or data-lg-refract="off", glass nested in other
     glass (or under any backdrop-filter: the ancestor is a backdrop root, so there is
     nothing behind to bend), and prefers-reduced-transparency
   - Auto-handles resized, added, removed and re-classed .lg / .lg-press elements
   - Manual re-run: LiquidGlass.refresh() */
(function () {
  if (typeof window === 'undefined' || window.LiquidGlass) return; // once, even if evaluated twice

  const ua = navigator.userAgent;
  const refracts = /Chrome\//.test(ua) && !/CriOS|FxiOS/.test(ua);
  const NS = 'http://www.w3.org/2000/svg';
  const GLASS = '.lg, .lg-press, .lg-btn';
  const lessGlass = window.matchMedia('(prefers-reduced-transparency: reduce)');

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);

  let uid = 0;
  const ids = new WeakMap();
  const sizes = new WeakMap();
  const observed = new Set();

  function displacementMap(w, h, r) {
    return `<svg xmlns="${NS}" width="${w}" height="${h}">
      <defs>
        <linearGradient id="r" x1="100%" y1="0" x2="0" y2="0"><stop offset="0" stop-color="#0000"/><stop offset="1" stop-color="red"/></linearGradient>
        <linearGradient id="b" x1="0" y1="0" x2="0" y2="100%"><stop offset="0" stop-color="#0000"/><stop offset="1" stop-color="blue"/></linearGradient>
      </defs>
      <rect width="${w}" height="${h}" fill="#808080"/>
      <g style="mix-blend-mode:difference">
        <rect width="${w}" height="${h}" fill="#000"/>
        <rect width="${w}" height="${h}" fill="url(#r)"/>
        <rect width="${w}" height="${h}" fill="url(#b)"/>
      </g>
      <rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="${r}" fill="#808080" fill-opacity=".93" style="filter:blur(11px)"/>
    </svg>`;
  }

  /** Any ancestor that is glass or has a backdrop-filter makes refraction pointless (and nests glass in glass). */
  function underBackdrop(el) {
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (a.classList.contains('lg')) return true;
      const cs = getComputedStyle(a);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== 'none') return true;
    }
    return false;
  }

  function wantsRefraction(el) {
    return (
      refracts &&
      !lessGlass.matches &&
      el.isConnected &&
      el.classList.contains('lg') &&
      !el.classList.contains('lg-frost') &&
      el.dataset.lgRefract !== 'off' &&
      !underBackdrop(el)
    );
  }

  /** Layout size, ignoring transforms and `scale` (mid-entrance or mid-press). */
  function applyFilter(el, w = el.offsetWidth, h = el.offsetHeight) {
    w = Math.round(w);
    h = Math.round(h);
    if (w < 24 || h < 24) return;
    const prev = sizes.get(el);
    if (prev && prev[0] === w && prev[1] === h) return;
    sizes.set(el, [w, h]);

    const cs = getComputedStyle(el);
    const r = Math.min(parseFloat(cs.borderTopLeftRadius) || 0, h / 2);
    const scale = el.dataset.lgScale || 60;
    let id = ids.get(el);
    if (!id) { id = 'lg-f' + uid++; ids.set(el, id); }

    const old = defs.querySelector('#' + id);
    if (old) old.remove();
    const f = document.createElementNS(NS, 'filter');
    f.id = id;
    f.setAttribute('x', '0'); f.setAttribute('y', '0');
    f.setAttribute('width', '100%'); f.setAttribute('height', '100%');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.innerHTML = `
      <feImage href="data:image/svg+xml;utf8,${encodeURIComponent(displacementMap(w, h, r))}" x="0" y="0" width="${w}" height="${h}" result="map"/>
      <feDisplacementMap in="SourceGraphic" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="B"/>`;
    defs.appendChild(f);

    // The element's own tokens, so one surface can run softer or stronger than the root's.
    const v = n => cs.getPropertyValue(n).trim();
    el.style.backdropFilter =
      `url(#${id}) blur(${v('--lg-blur')}) saturate(${v('--lg-sat')}) brightness(${v('--lg-bright')})`;
  }

  /** Back to the CSS frosted fallback: no observer, no inline filter, no <filter>. */
  function dropRefraction(el) {
    if (!observed.has(el)) return;
    observed.delete(el);
    ro.unobserve(el);
    el.style.backdropFilter = '';
    sizes.delete(el);
    const id = ids.get(el);
    if (id) defs.querySelector('#' + id)?.remove();
  }

  function press(el) {
    if (el.__lgPress) return;
    el.__lgPress = true;
    const move = e => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--lg-x', e.clientX - r.left + 'px');
      el.style.setProperty('--lg-y', e.clientY - r.top + 'px');
    };
    el.addEventListener('pointerdown', e => { el.classList.add('is-pressed'); move(e); });
    el.addEventListener('pointermove', move);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t =>
      el.addEventListener(t, () => el.classList.remove('is-pressed')));
  }

  const ro = new ResizeObserver(entries =>
    entries.forEach(e => {
      const box = e.borderBoxSize && e.borderBoxSize[0];
      if (box) applyFilter(e.target, box.inlineSize, box.blockSize);
      else applyFilter(e.target);
    }));

  /** Bring one element in line with its classes; safe to call any number of times. */
  function sync(el) {
    if (el.matches('.lg-btn, .lg-press')) press(el);
    if (wantsRefraction(el)) {
      if (!observed.has(el)) { observed.add(el); ro.observe(el); applyFilter(el); }
    } else {
      dropRefraction(el);
    }
  }

  function init(root) {
    if (root.nodeType !== 1) return;
    if (root.matches(GLASS)) sync(root);
    root.querySelectorAll(GLASS).forEach(sync);
  }

  function forget(root) {
    if (root.nodeType !== 1 || root.isConnected) return; // moved, not removed
    observed.forEach(el => { if (el === root || root.contains(el)) dropRefraction(el); });
  }

  function start() {
    if (refracts) document.body.appendChild(svg);
    init(document.body);
    new MutationObserver(muts => muts.forEach(m => {
      if (m.type === 'attributes') {
        // A class change can add or remove glass, or nest it under new glass: re-check the subtree.
        // The press toggling its own `is-pressed` changes nothing else, so it is skipped.
        const el = m.target;
        const bare = s => (s || '').replace(/\bis-pressed\b/g, '').replace(/\s+/g, ' ').trim();
        if (bare(m.oldValue) === bare(el.getAttribute('class'))) return;
        if (el.matches(GLASS) || observed.has(el)) sync(el);
        el.querySelectorAll('.lg').forEach(sync);
        return;
      }
      m.removedNodes.forEach(forget);
      m.addedNodes.forEach(init);
    })).observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    lessGlass.addEventListener('change', () => init(document.body));
  }

  window.LiquidGlass = { refresh: () => init(document.body), refracts };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
