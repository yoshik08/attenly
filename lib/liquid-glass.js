/* Liquid Glass runtime. Include once, site-wide (here: imported from components/liquid-glass.tsx).
   - Chromium (desktop + Android): real refraction via SVG displacement
   - Everything else (Safari, iOS, Firefox): frosted fallback from the CSS
   - Frosted only, by choice: .lg-frost or data-lg-refract="off", glass nested in other
     glass (or under any backdrop-filter: the ancestor is a backdrop root, so there is
     nothing behind to bend), and prefers-reduced-transparency
   - Auto-handles resized, added, removed and re-classed .lg / .lg-press elements
   - Manual re-run: LiquidGlass.refresh()
   - Cheap on the main thread: DOM changes are queued and handled once per frame, every
     style read in a pass happens before any write, and sizes come from ResizeObserver
     (after layout), so the runtime never forces a style recalc or layout of its own. */
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

  /**
   * Any ancestor that is glass or has a backdrop-filter makes refraction pointless (and nests
   * glass in glass). `memo` holds each ancestor's answer for one pass, so siblings share the walk.
   */
  function underBackdrop(el, memo) {
    const hit = [];
    let found = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      if (memo.has(a)) { found = memo.get(a); break; }
      hit.push(a);
      if (a.classList.contains('lg')) { found = true; break; }
      const cs = getComputedStyle(a);
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      if (bf && bf !== 'none') { found = true; break; }
    }
    // Everything between `el` and the answer shares it: below a backdrop root is below it.
    for (const a of hit) memo.set(a, found);
    return found;
  }

  /** The class-only half of the test: no style reads, so it can run anywhere. */
  function mayRefract(el) {
    return (
      refracts &&
      !lessGlass.matches &&
      el.isConnected &&
      el.classList.contains('lg') &&
      !el.classList.contains('lg-frost') &&
      el.dataset.lgRefract !== 'off'
    );
  }

  /** Builds (or rebuilds) one element's filter. Reads were done by the caller; this only writes. */
  function writeFilter(el, w, h, r, scale, tokens) {
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
    el.style.backdropFilter = `url(#${id}) blur(${tokens[0]}) saturate(${tokens[1]}) brightness(${tokens[2]})`;
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

  /**
   * iOS-style press. The highlight follows the pointer only while pressed, from the box
   * measured once at pointerdown: hovering never touches layout or style.
   */
  function press(el) {
    if (el.__lgPress) return;
    el.__lgPress = true;
    let box = null;
    const move = e => {
      if (!box) return;
      el.style.setProperty('--lg-x', e.clientX - box.left + 'px');
      el.style.setProperty('--lg-y', e.clientY - box.top + 'px');
    };
    el.addEventListener('pointerdown', e => {
      box = el.getBoundingClientRect();
      el.classList.add('is-pressed');
      move(e);
    }, { passive: true });
    el.addEventListener('pointermove', move, { passive: true });
    const up = () => { box = null; el.classList.remove('is-pressed'); };
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => el.addEventListener(t, up, { passive: true }));
  }

  // Runs after layout, before paint: sizes come with the entries and computed style is
  // already clean, so all reads are free. Reads first, then writes.
  const ro = new ResizeObserver(entries => {
    const work = [];
    for (const e of entries) {
      const el = e.target;
      const box = e.borderBoxSize && e.borderBoxSize[0];
      const w = Math.round(box ? box.inlineSize : el.offsetWidth);
      const h = Math.round(box ? box.blockSize : el.offsetHeight);
      if (w < 24 || h < 24) continue;
      const prev = sizes.get(el);
      if (prev && prev[0] === w && prev[1] === h) continue;
      const cs = getComputedStyle(el);
      const v = n => cs.getPropertyValue(n).trim();
      work.push([el, w, h, Math.min(parseFloat(cs.borderTopLeftRadius) || 0, h / 2), el.dataset.lgScale || 60, [v('--lg-blur'), v('--lg-sat'), v('--lg-bright')]]);
    }
    for (const [el, w, h, r, scale, tokens] of work) {
      sizes.set(el, [w, h]);
      writeFilter(el, w, h, r, scale, tokens);
    }
  });

  /** Brings a set of elements in line with their classes: one read pass, then one write pass. */
  function syncAll(els) {
    const memo = new Map();
    const want = [];
    const drop = [];
    for (const el of els) {
      if (el.matches('.lg-btn, .lg-press')) press(el); // listeners only
      if (mayRefract(el) && !underBackdrop(el, memo)) want.push(el);
      else if (observed.has(el)) drop.push(el);
    }
    for (const el of drop) dropRefraction(el);
    // Observing writes nothing; the observer's first callback (after layout) builds the filter.
    for (const el of want) if (!observed.has(el)) { observed.add(el); ro.observe(el); }
  }

  function collect(root, into) {
    if (root.nodeType !== 1 || !root.isConnected) return;
    if (root.matches(GLASS)) into.add(root);
    root.querySelectorAll(GLASS).forEach(el => into.add(el));
  }

  function init(root) {
    const els = new Set();
    collect(root, els);
    syncAll(els);
  }

  function forget(root) {
    if (root.nodeType !== 1 || root.isConnected) return; // moved, not removed
    observed.forEach(el => { if (el === root || root.contains(el)) dropRefraction(el); });
  }

  // DOM changes are queued and handled once, in the next frame, after React has finished
  // committing: a page change costs one pass instead of one per inserted node.
  const pendingRoots = new Set();
  const pendingEls = new Set();
  let queued = false;
  function flush() {
    queued = false;
    const els = new Set(pendingEls);
    pendingEls.clear();
    pendingRoots.forEach(r => collect(r, els));
    pendingRoots.clear();
    syncAll(els);
  }
  function queue() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(flush);
  }

  const bare = s => (s || '').replace(/\bis-pressed\b/g, '').replace(/\s+/g, ' ').trim();

  function start() {
    if (refracts) document.body.appendChild(svg);
    init(document.body);
    new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'attributes') {
          // A class change can add or remove glass, or nest it under new glass: re-check the subtree.
          // The press toggling its own `is-pressed` changes nothing else, so it is skipped.
          const el = m.target;
          if (bare(m.oldValue) === bare(el.getAttribute('class'))) continue;
          if (el.matches(GLASS) || observed.has(el)) pendingEls.add(el);
          el.querySelectorAll('.lg').forEach(x => pendingEls.add(x));
          queue();
          continue;
        }
        m.removedNodes.forEach(forget);
        m.addedNodes.forEach(n => { if (n.nodeType === 1) { pendingRoots.add(n); queue(); } });
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class'] });
    lessGlass.addEventListener('change', () => init(document.body));
  }

  window.LiquidGlass = { refresh: () => init(document.body), refracts };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
