(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const NEW_MS = 4 * 24 * 60 * 60 * 1000;
  // En la versión estática (GitHub Pages) el catálogo es un archivo; con servidor, la API.
  const CATALOG_URL = document.documentElement.dataset.catalog || '/api/catalog';

  const state = {
    settings: {},
    items: [],
    byId: new Map(),
    category: 'all',
    status: 'all',
    sort: 'recent',
    query: '',
    list: recall('bazar-list', []),
    view: 'home',
    deck: [],
    deckPos: 0,
    deckHistory: [],
    gridReady: false,
    sheetId: null,
    sheetPushed: false,
  };

  // ------------------------------------------------------------ utilidades

  function recall(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo privado */ }
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const isNew = (it) => Date.now() - Date.parse(it.createdAt) < NEW_MS;
  const cover = (it) => (it.images && it.images[0]) || null;
  // Descuento contra el precio de mercado, en porcentaje entero.
  const off = (it) => (it.marketPrice > it.price ? Math.round((1 - it.price / it.marketPrice) * 100) : 0);
  const offTag = (it) => (off(it) >= 5 && it.status !== 'vendido' ? `<small class="off">-${off(it)}%</small>` : '');
  const imgTag = (src, cls = '', lazy = true) =>
    src ? `<img src="${esc(src)}" alt="" class="${cls}" ${lazy ? 'loading="lazy"' : ''} decoding="async" draggable="false">`
        : `<div class="noimg ${cls}"><svg><use href="#i-tag"/></svg></div>`;

  // Sin foto todavía: fondo de color estable por artículo con la categoría.
  const CAT_HUE = { Electrónica: 210, Muebles: 28, Decoración: 330, Cocina: 145 };
  function pic(it, lazy = true) {
    if (cover(it)) return imgTag(cover(it), '', lazy);
    let h = CAT_HUE[it.category];
    if (h === undefined) { h = 0; for (const c of it.id) h = (h * 31 + c.charCodeAt(0)) % 360; }
    return `<div class="noimg ph-art" style="--h:${h}"><svg><use href="#i-tag"/></svg><b>${esc(it.category || 'Bazar')}</b><span>Foto en camino</span></div>`;
  }

  let money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
  let moneyCents = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  const fmt = (n) => (Number.isInteger(n) ? money : moneyCents).format(n || 0);

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  let toastTimer;
  function toast(msg, icon = 'i-check') {
    const t = $('#toast');
    t.innerHTML = `<svg><use href="#${icon}"/></svg><span>${esc(msg)}</span>`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const itemUrl = (id) => `${location.origin}${location.pathname}#/item/${id}`;

  // Los nombres de transición se ponen solo mientras dura la animación:
  // dejarlos fijos convierte cada tarjeta en una capa y el scroll se arrastra.
  function withTransition(fn) {
    if (!document.startViewTransition || reduceMotion || !state.gridReady) return fn();
    const name = (on) => $$('#grid .card').slice(0, 60).forEach((c) => {
      c.style.viewTransitionName = on ? `c-${c.dataset.id}` : '';
    });
    name(true);
    const vt = document.startViewTransition(() => { fn(); name(true); });
    vt.finished.finally(() => name(false));
  }

  // ------------------------------------------------------------ tema

  function currentTheme() {
    return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function paintThemeIcon() {
    $('#theme-btn use').setAttribute('href', currentTheme() === 'dark' ? '#i-sun' : '#i-moon');
  }
  $('#theme-btn').addEventListener('click', () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    const apply = () => { document.documentElement.dataset.theme = next; paintThemeIcon(); };
    if (document.startViewTransition && !reduceMotion) document.startViewTransition(apply); else apply();
    try { localStorage.setItem('bazar-theme', next); } catch { /* sin almacenamiento */ }
  });
  paintThemeIcon();

  // ------------------------------------------------------------ carga

  async function load() {
    try {
      const res = await fetch(CATALOG_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      state.settings = data.settings;
      state.items = data.items;
      state.byId = new Map(data.items.map((it) => [it.id, it]));
      state.list = state.list.filter((id) => state.byId.has(id));
      store('bazar-list', state.list);
      try {
        money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: data.settings.currency, maximumFractionDigits: 0 });
        moneyCents = new Intl.NumberFormat('es-MX', { style: 'currency', currency: data.settings.currency });
      } catch { /* moneda no reconocida: se queda MXN */ }
      renderAll();
    } catch {
      $('#grid').innerHTML = '';
      const empty = $('#empty');
      empty.hidden = false;
      $('h3', empty).textContent = 'No se pudo cargar el catálogo';
      $('p', empty).textContent = 'Revisa tu conexión e inténtalo otra vez.';
      $('#clear-filters').textContent = 'Reintentar';
      $('#clear-filters').onclick = () => location.reload();
    }
  }

  function renderAll() {
    const s = state.settings;
    document.title = s.storeName;
    $$('[data-store-name]').forEach((el) => { el.textContent = s.storeName; });
    renderHero();
    renderMarquee();
    renderChips();
    renderGrid();
    renderListUI();
    state.gridReady = true;
    route();
  }

  // ------------------------------------------------------------ hero

  function renderHero() {
    const s = state.settings;
    const words = (s.tagline || s.storeName).split(' ');
    // Resalta la última palabra del lema.
    const last = words.pop();
    $('#hero-title').innerHTML = `${esc(words.join(' '))} <em>${esc(last)}</em>`;

    const avail = state.items.filter((i) => i.status === 'disponible');
    const apartables = avail.filter((i) => i.apartable).length;
    const min = avail.length ? Math.min(...avail.map((i) => i.price)) : 0;
    const stats = [];
    stats.push(`<li style="--i:0"><b>${avail.length}</b> disponibles</li>`);
    if (apartables) stats.push(`<li style="--i:1"><b>${apartables}</b> se pueden apartar</li>`);
    if (avail.length) stats.push(`<li style="--i:2">desde <b>${fmt(min)}</b></li>`);
    const best = Math.max(0, ...avail.map(off));
    if (best >= 10) stats.push(`<li style="--i:3">hasta <b>-${best}%</b> vs. tienda</li>`);
    $('#hero-stats').innerHTML = state.items.length ? stats.join('') : '<li style="--i:0">Muy pronto habrá artículos aquí</li>';

    const featured = state.items.filter((i) => i.featured && i.status !== 'vendido');
    const slides = (featured.length ? featured : avail).slice(0, 6);
    $('#hero-show').hidden = !slides.length;
    $('#carousel').innerHTML = slides.map((it, i) => `
      <a class="slide${i === 0 ? ' is-active' : ''}" href="#/item/${it.id}" data-open="${it.id}" aria-label="${esc(it.title)}, ${fmt(it.price)}">
        ${pic(it, i > 0)}
        <div class="slide-info">
          <span class="slide-kicker">${it.featured ? 'Destacado' : 'Recién llegado'}${it.category ? ` · ${esc(it.category)}` : ''}</span>
          <h3>${esc(it.title)}</h3>
          <div class="slide-row"><span class="price-tag">${fmt(it.price)}${offTag(it)}</span><span class="slide-go"><svg><use href="#i-right"/></svg></span></div>
        </div>
      </a>`).join('');
    $('#carousel-dots').innerHTML = slides.length > 1
      ? slides.map((_, i) => `<button class="${i === 0 ? 'is-on' : ''}" aria-label="Destacado ${i + 1}"></button>`).join('')
      : '';
    startCarousel(slides.length);
  }

  let carTimer = null;
  let carIndex = 0;
  let carPausedUntil = 0;
  const CAR_MS = 5200;

  function startCarousel(n) {
    clearInterval(carTimer);
    carIndex = 0;
    if (n < 2 || reduceMotion) return;
    carTimer = setInterval(() => {
      if (Date.now() < carPausedUntil || document.hidden || state.view !== 'home' || state.sheetId) return;
      goSlide((carIndex + 1) % n);
    }, CAR_MS);
  }

  function goSlide(i) {
    const car = $('#carousel');
    const slide = car.children[i];
    if (!slide) return;
    car.scrollTo({ left: slide.offsetLeft - (car.clientWidth - slide.clientWidth) / 2, behavior: 'smooth' });
  }

  function markSlide() {
    const car = $('#carousel');
    const mid = car.scrollLeft + car.clientWidth / 2;
    let best = 0; let bestD = Infinity;
    [...car.children].forEach((el, i) => {
      const d = Math.abs(el.offsetLeft + el.clientWidth / 2 - mid);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best === carIndex && car.children[best].classList.contains('is-active')) return;
    carIndex = best;
    [...car.children].forEach((el, i) => el.classList.toggle('is-active', i === best));
    const dots = $('#carousel-dots');
    [...dots.children].forEach((d, i) => {
      d.classList.remove('is-on');
      if (i === best) { void d.offsetWidth; d.classList.add('is-on'); }
    });
  }

  let carRaf = 0;
  $('#carousel').addEventListener('scroll', () => { cancelAnimationFrame(carRaf); carRaf = requestAnimationFrame(markSlide); }, { passive: true });
  const pauseCarousel = () => {
    carPausedUntil = Date.now() + 9000;
    $('#carousel-dots').classList.add('paused');
    setTimeout(() => { if (Date.now() >= carPausedUntil) $('#carousel-dots').classList.remove('paused'); }, 9100);
  };
  $('#carousel').addEventListener('pointerdown', pauseCarousel);
  $('#carousel').addEventListener('wheel', pauseCarousel, { passive: true });
  $('#carousel-dots').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    pauseCarousel();
    goSlide([...b.parentNode.children].indexOf(b));
  });

  $('#to-grid').addEventListener('click', () => $('#toolbar').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' }));

  // ------------------------------------------------------------ marquesina y chips

  function categories() {
    const counts = new Map();
    for (const it of state.items) if (it.category) counts.set(it.category, (counts.get(it.category) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }

  function renderMarquee() {
    const cats = categories().map(([c]) => c);
    const words = cats.length ? cats : ['Hogar', 'Electrónica', 'Ropa', 'Cocina', 'Deportes'];
    const extra = ['Buenos precios', 'Se aparta', 'Trato directo'];
    const seq = [...words, ...extra];
    const run = seq.map((w) => `${esc(w)} <i>✦</i>`).join(' ');
    // Dos copias idénticas para que el desplazamiento sea continuo.
    $('.marquee-track').innerHTML = `<span>${run}</span><span>${run}</span>`;
    $('#marquee').hidden = !state.items.length;
  }

  function renderChips() {
    const cats = categories();
    $('#toolbar').hidden = !state.items.length;
    const chip = (value, label, n) =>
      `<button class="chip${state.category === value ? ' is-on' : ''}" data-cat="${esc(value)}" role="tab" aria-selected="${state.category === value}">${esc(label)}<small>${n}</small></button>`;
    $('#chips').innerHTML = chip('all', 'Todo', state.items.length) + cats.map(([c, n]) => chip(c, c, n)).join('');
  }

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.category = b.dataset.cat;
    $$('.chip', $('#chips')).forEach((c) => { c.classList.toggle('is-on', c === b); c.setAttribute('aria-selected', c === b); });
    b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    withTransition(renderGrid);
  });

  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; withTransition(renderGrid); }, 180);
  });

  // filtros
  const filterBtn = $('#filter-btn');
  const filterPop = $('#filter-pop');
  function toggleFilters(open = filterPop.hidden) {
    filterPop.hidden = !open;
    filterBtn.setAttribute('aria-expanded', open);
  }
  filterBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleFilters(); });
  document.addEventListener('click', (e) => { if (!filterPop.hidden && !e.target.closest('.filter-wrap')) toggleFilters(false); });
  filterPop.addEventListener('click', (e) => {
    const b = e.target.closest('.seg button');
    if (!b) return;
    const group = b.parentNode.dataset.group;
    state[group] = b.dataset.value;
    $$('button', b.parentNode).forEach((x) => x.classList.toggle('is-on', x === b));
    $('.filter-dot').hidden = state.status === 'all' && state.sort === 'recent';
    withTransition(renderGrid);
  });

  $('#clear-filters').addEventListener('click', () => {
    state.category = 'all'; state.status = 'all'; state.sort = 'recent'; state.query = '';
    $('#search').value = '';
    $$('.seg').forEach((seg) => $$('button', seg).forEach((b, i) => b.classList.toggle('is-on', i === 0)));
    $('.filter-dot').hidden = true;
    renderChips();
    withTransition(renderGrid);
  });

  // ------------------------------------------------------------ cuadrícula

  function visibleItems() {
    const q = norm(state.query);
    const list = state.items.filter((it) => {
      if (state.category !== 'all' && it.category !== state.category) return false;
      if (state.status === 'disponible' && it.status !== 'disponible') return false;
      if (state.status === 'apartable' && !(it.apartable && it.status === 'disponible')) return false;
      if (q && !norm(`${it.title} ${it.category} ${it.description} ${it.condition}`).includes(q)) return false;
      return true;
    });
    const rank = { disponible: 0, apartado: 1, vendido: 2 };
    const by = {
      recent: (a, b) => b.createdAt.localeCompare(a.createdAt),
      'price-asc': (a, b) => a.price - b.price,
      'price-desc': (a, b) => b.price - a.price,
      discount: (a, b) => off(b) - off(a),
    }[state.sort];
    return list.sort((a, b) => (rank[a.status] - rank[b.status]) || by(a, b));
  }

  // Ritmo de tamaños: rompe la cuadrícula para que no se vea como una tabla.
  function shapeFor(it, i) {
    if (it.status === 'vendido') return '';
    const p = i % 10;
    if (p === 0 || (it.featured && p === 5)) return 'wide';
    if (p === 3 || p === 7) return 'tall';
    return '';
  }

  function cardHTML(it, i, entering) {
    const liked = state.list.includes(it.id);
    const sticker = it.status === 'apartado' ? '<span class="sticker s-apartado">Apartado</span>'
      : it.status === 'vendido' ? '<span class="sticker s-vendido">Vendido</span>'
      : isNew(it) ? '<span class="sticker s-nuevo">Nuevo</span>' : '';
    const apart = it.apartable && it.status === 'disponible' ? '<span class="pill-apart">✦ Se aparta</span>' : '';
    // Vendido: sin precio, sin corazón y sin abrir detalle.
    if (it.status === 'vendido') {
      return `
      <article class="card is-sold${entering ? '' : ' in'}" data-id="${it.id}" style="--d:${(i % 6) * 70}" aria-label="${esc(it.title)}, vendido">
        <div class="card-tilt">
          ${pic(it)}
          <span class="sold-stamp">Vendido</span>
          <div class="card-info">
            <div>
              <h3>${esc(it.title)}</h3>
              <p class="meta">${it.category ? `<span>${esc(it.category)}</span>` : ''}</p>
            </div>
          </div>
        </div>
      </article>`;
    }
    return `
      <article class="card ${shapeFor(it, i)}${it.status === 'vendido' ? ' is-sold' : ''}${entering ? '' : ' in'}" data-id="${it.id}" style="--d:${(i % 6) * 70}">
        <div class="card-tilt">
          ${pic(it)}
          <span class="shine"></span>
          <span class="price-tag">${fmt(it.price)}${offTag(it)}</span>
          ${sticker}
          <button class="card-open" data-open="${it.id}" aria-label="Ver ${esc(it.title)}, ${fmt(it.price)}"></button>
          <div class="card-info">
            <div>
              <h3>${esc(it.title)}</h3>
              <p class="meta">${it.category ? `<span>${esc(it.category)}</span>` : ''}${apart}</p>
            </div>
            <button class="heart${liked ? ' on' : ''}" data-like="${it.id}" aria-pressed="${liked}" aria-label="Guardar en mi lista"><svg><use href="#i-heart"/></svg></button>
          </div>
        </div>
      </article>`;
  }

  let revealer = null;
  function renderGrid() {
    const list = visibleItems();
    const grid = $('#grid');
    const entering = !state.gridReady;
    grid.innerHTML = list.map((it, i) => cardHTML(it, i, entering)).join('');
    $('#empty').hidden = list.length > 0 || !state.items.length;
    if (!state.items.length) {
      $('#empty').hidden = false;
      $('#empty h3').textContent = 'Todavía no hay artículos';
      $('#empty p').textContent = 'Vuelve pronto: estamos tomando fotos.';
      $('#clear-filters').hidden = true;
    }
    const total = state.items.length;
    $('#result-line').textContent = total
      ? (list.length === total ? `${total} artículos` : `${list.length} de ${total} artículos`)
      : '';

    if (entering) {
      revealer?.disconnect();
      revealer = new IntersectionObserver((entries) => {
        for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealer.unobserve(e.target); }
      }, { rootMargin: '0px 0px -8% 0px' });
      $$('.card', grid).forEach((c) => revealer.observe(c));
    }
  }

  // Inclinación 3D que sigue al cursor (solo con mouse).
  if (finePointer && !reduceMotion) {
    const grid = $('#grid');
    grid.addEventListener('pointermove', (e) => {
      const tilt = e.target.closest('.card-tilt');
      if (!tilt) return;
      const r = tilt.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      tilt.classList.add('moving');
      tilt.style.setProperty('--ry', `${(x - 0.5) * 8}deg`);
      tilt.style.setProperty('--rx', `${(0.5 - y) * 8}deg`);
      tilt.style.setProperty('--mx', `${x * 100}%`);
      tilt.style.setProperty('--my', `${y * 100}%`);
    });
    grid.addEventListener('pointerout', (e) => {
      const tilt = e.target.closest('.card-tilt');
      if (!tilt || tilt.contains(e.relatedTarget)) return;
      tilt.classList.remove('moving');
      tilt.style.setProperty('--rx', '0deg');
      tilt.style.setProperty('--ry', '0deg');
    });
  }

  // Clics delegados en todo el documento.
  document.addEventListener('click', (e) => {
    const like = e.target.closest('[data-like]');
    if (like) { e.preventDefault(); toggleLike(like.dataset.like, like); return; }
    const open = e.target.closest('[data-open]');
    if (open) { e.preventDefault(); openItem(open.dataset.open); return; }
    if (e.target.closest('[data-open-list]')) { openList(); return; }
    if (e.target.closest('[data-close-sheet]')) { closeItem(); return; }
    if (e.target.closest('[data-close-list]')) closeList();
    if (e.target.closest('[data-close-ap]')) closeApartar();
  });

  // ------------------------------------------------------------ lista de interés

  function toggleLike(id, btn) {
    const it = state.byId.get(id);
    if (!it) return;
    const has = state.list.includes(id);
    state.list = has ? state.list.filter((x) => x !== id) : [...state.list, id];
    store('bazar-list', state.list);
    if (!has) toast('Guardado en tu lista', 'i-heart');
    syncHearts(id, btn);
    renderListUI(true);
  }

  function syncHearts(id, source) {
    const on = state.list.includes(id);
    $$(`[data-like="${id}"]`).forEach((b) => {
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
      if (b === source && on) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
    });
    if (state.sheetId === id) paintSheetLike();
  }

  function renderListUI(bump = false) {
    const n = state.list.length;
    $$('[data-list-count]').forEach((c) => {
      c.hidden = !n;
      c.textContent = n;
      if (bump) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
    });
    if (!$('#drawer').hidden) renderListBody();
  }

  function renderListBody() {
    const items = state.list.map((id) => state.byId.get(id)).filter(Boolean);
    const body = $('#list-body');
    $('#list-foot').hidden = !items.length;
    $('#list-sub').textContent = items.length
      ? `${items.length} ${items.length === 1 ? 'artículo' : 'artículos'} · lo que te interesa, en un solo mensaje.`
      : 'Lo que te interesa, en un solo mensaje.';
    if (!items.length) {
      body.innerHTML = `
        <div class="list-empty">
          <div class="empty-art"><svg><use href="#i-heart"/></svg></div>
          <h3>Tu lista está vacía</h3>
          <p>Toca el corazón en lo que te guste o desliza en <b>Descubrir</b>.</p>
        </div>`;
      return;
    }
    body.innerHTML = items.map((it, i) => `
      <div class="li" style="--i:${i}" data-li="${it.id}">
        <button class="li-img" data-open="${it.id}" aria-label="Ver ${esc(it.title)}">${pic(it)}</button>
        <button class="li-main" data-open="${it.id}">
          <b>${esc(it.title)}</b>
          ${it.status === 'disponible' ? `<span>${esc(it.category || 'Disponible')}</span>`
            : `<span class="warn">${it.status === 'apartado' ? 'Ya está apartado' : 'Ya se vendió'}</span>`}
        </button>
        <span class="li-price">${it.status === 'vendido' ? '—' : fmt(it.price)}</span>
        <button class="li-x" data-unlist="${it.id}" aria-label="Quitar"><svg><use href="#i-x"/></svg></button>
      </div>`).join('');
    const avail = items.filter((it) => it.status === 'disponible');
    $('#list-total').textContent = fmt(avail.reduce((s, it) => s + it.price, 0));
  }

  $('#list-body').addEventListener('click', (e) => {
    const x = e.target.closest('[data-unlist]');
    if (!x) return;
    const id = x.dataset.unlist;
    const row = x.closest('.li');
    row.classList.add('out');
    setTimeout(() => {
      state.list = state.list.filter((v) => v !== id);
      store('bazar-list', state.list);
      syncHearts(id);
      renderListUI();
    }, 300);
  });

  $('#list-clear').addEventListener('click', () => {
    const ids = state.list;
    state.list = [];
    store('bazar-list', []);
    ids.forEach((id) => syncHearts(id));
    renderListUI();
    toast('Lista vacía', 'i-trash');
  });

  function openList() {
    const d = $('#drawer');
    renderListBody();
    d.hidden = false;
    document.body.classList.add('lock');
    void d.offsetWidth;
    d.classList.add('open');
  }
  function closeList() {
    const d = $('#drawer');
    if (d.hidden) return;
    d.classList.remove('open');
    setTimeout(() => { d.hidden = true; if (!state.sheetId) document.body.classList.remove('lock'); }, 450);
  }

  // ------------------------------------------------------------ detalle

  function openItem(id) {
    if (state.sheetId === id) return;
    if (state.sheetId) { history.replaceState(null, '', `#/item/${id}`); showSheet(id); return; }
    state.sheetPushed = true;
    location.hash = `#/item/${id}`;
  }

  function closeItem() {
    if (!state.sheetId) return;
    if (state.sheetPushed) history.back();
    else { history.replaceState(null, '', state.view === 'discover' ? '#/descubrir' : '#/'); hideSheet(); }
  }

  function showSheet(id) {
    const it = state.byId.get(id);
    if (!it || it.status === 'vendido') {
      toast(it ? 'Este artículo ya se vendió' : 'Ese artículo ya no está en el catálogo', 'i-info');
      history.replaceState(null, '', state.view === 'discover' ? '#/descubrir' : '#/');
      hideSheet();
      return;
    }
    if (!$('#drawer').hidden) closeList();
    state.sheetId = id;
    const s = state.settings;

    const imgs = it.images && it.images.length ? it.images : [null];
    $('#g-track').innerHTML = it.images && it.images.length ? imgs.map((src, i) => imgTag(src, '', i > 0)).join('') : pic(it, false);
    $('#g-track').scrollLeft = 0;
    $('#g-dots').innerHTML = imgs.length > 1 ? imgs.map((_, i) => `<span class="${i === 0 ? 'is-on' : ''}"></span>`).join('') : '';
    $('#g-prev').hidden = $('#g-next').hidden = imgs.length < 2;
    paintGalleryNav();

    const chips = [it.category, it.condition].filter(Boolean);
    if (isNew(it) && it.status === 'disponible') chips.push('Nuevo en el bazar');
    $('#d-chips').innerHTML = chips.map((c) => `<span>${esc(c)}</span>`).join('');
    $('#d-title').textContent = it.title;
    $('#d-price').textContent = fmt(it.price);
    const was = $('#d-was');
    const save = $('#d-save');
    was.hidden = save.hidden = !(it.marketPrice > it.price);
    if (it.marketPrice > it.price) {
      was.textContent = fmt(it.marketPrice);
      save.innerHTML = `Ahorras <b>${fmt(it.marketPrice - it.price)}</b> (${off(it)}%) frente al precio de tienda.`;
    }
    const st = $('#d-status');
    st.className = `status-pill st-${it.status}`;
    st.textContent = { disponible: 'Disponible', apartado: 'Apartado', vendido: 'Vendido' }[it.status];

    const note = $('#d-note');
    if (it.status === 'disponible' && it.apartable) {
      note.className = 'd-note apartable';
      note.innerHTML = `<svg><use href="#i-spark"/></svg><div><b>Se puede apartar</b>${esc(s.apartadoInfo || 'Pregunta por las condiciones del apartado.')}</div>`;
      note.hidden = false;
    } else if (it.status === 'apartado') {
      note.className = 'd-note taken';
      note.innerHTML = '<svg><use href="#i-info"/></svg><div><b>Alguien ya lo apartó</b>Si no se confirma el anticipo en 48 horas, vuelve a estar disponible aquí.</div>';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
    $('#d-desc').textContent = it.description || '';
    $('#d-desc').hidden = !it.description;

    const related = state.items
      .filter((x) => x.id !== it.id && x.status !== 'vendido' && (x.category === it.category || !it.category))
      .slice(0, 8);
    const fill = related.length < 3
      ? state.items.filter((x) => x.id !== it.id && x.status === 'disponible' && !related.includes(x)).slice(0, 6 - related.length)
      : [];
    const rel = [...related, ...fill];
    $('#related').hidden = !rel.length;
    $('#related-track').innerHTML = rel.map((x) => `
      <a class="mini" href="#/item/${x.id}" data-open="${x.id}">
        <div class="mini-img">${pic(x)}</div>
        <b>${fmt(x.price)}</b><span>${esc(x.title)}</span>
      </a>`).join('');

    // "Me interesa" abre el apartado por correo; solo para lo disponible y apartable.
    const want = $('#d-want');
    const canApartar = it.status === 'disponible' && it.apartable && s.apartadoOnline;
    want.hidden = it.status === 'disponible' && !canApartar;
    want.disabled = !canApartar;
    want.classList.toggle('accent', canApartar);
    $('span', want).textContent = canApartar ? 'Me interesa' : 'Ya está apartado';
    paintSheetLike();

    $('#sheet-body').scrollTop = 0;
    $('.d-info').scrollTop = 0;
    const sheet = $('#sheet');
    if (sheet.hidden) {
      sheet.hidden = false;
      document.body.classList.add('lock');
      void sheet.offsetWidth;
      sheet.classList.add('open');
      setTimeout(() => $('.sheet-close').focus({ preventScroll: true }), 60);
    }
  }

  function hideSheet() {
    const sheet = $('#sheet');
    state.sheetId = null;
    state.sheetPushed = false;
    if (sheet.hidden) return;
    sheet.classList.remove('open');
    sheet.style.removeProperty('--drag');
    setTimeout(() => {
      if (state.sheetId) return;
      sheet.hidden = true;
      if ($('#drawer').hidden) document.body.classList.remove('lock');
    }, 450);
  }

  function paintSheetLike() {
    const on = state.list.includes(state.sheetId);
    const b = $('#d-like');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
    b.setAttribute('aria-label', on ? 'Quitar de mi lista' : 'Guardar en mi lista');
  }
  $('#d-like').addEventListener('click', () => {
    if (!state.sheetId) return;
    toggleLike(state.sheetId);
  });

  // ------------------------------------------------------------ apartar por correo

  const apForm = $('#ap-form');
  let apItem = null;

  $('#d-want').addEventListener('click', () => {
    const it = state.byId.get(state.sheetId);
    if (it && it.status === 'disponible') openApartar(it);
  });

  function openApartar(it) {
    apItem = it;
    const pct = state.settings.anticipoPct || 30;
    $('#ap-item').textContent = `${it.title} · ${fmt(it.price)}`;
    $('#ap-anticipo').textContent = `${fmt(Math.round(it.price * pct / 100))} (${pct}%)`;
    $('#ap-error').hidden = true;
    apForm.hidden = false;
    $('#ap-done').hidden = true;
    const saved = recall('bazar-contacto', {});
    apForm.elements.nombre.value = saved.nombre || '';
    apForm.elements.email.value = saved.email || '';
    apForm.elements.telefono.value = saved.telefono || '';
    apForm.elements.acepto.checked = false;
    const d = $('#ap');
    d.hidden = false;
    void d.offsetWidth;
    d.classList.add('open');
    setTimeout(() => (apForm.elements.nombre.value ? apForm.elements.email : apForm.elements.nombre).focus({ preventScroll: true }), 120);
  }

  function closeApartar() {
    const d = $('#ap');
    if (d.hidden) return;
    d.classList.remove('open');
    setTimeout(() => { d.hidden = true; }, 450);
  }

  apForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = apForm.elements;
    const err = $('#ap-error');
    const fail = (msg, field) => { err.textContent = msg; err.hidden = false; field?.focus(); };
    err.hidden = true;
    if (!f.nombre.value.trim()) return fail('Escribe tu nombre.', f.nombre);
    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(f.email.value.trim())) return fail('Revisa tu correo: parece que no está bien escrito.', f.email);
    if (!f.acepto.checked) return fail('Confirma que entiendes el plazo de 48 horas.', f.acepto);

    const btn = $('#ap-send');
    btn.disabled = true;
    $('span', btn).textContent = 'Enviando…';
    try {
      const res = await fetch('/api/apartar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: apItem.id, nombre: f.nombre.value, email: f.email.value, telefono: f.telefono.value, website: f.website.value,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        fail(data.error || 'No se pudo enviar. Inténtalo otra vez.');
        if (res.status === 409 || res.status === 404) refreshCatalog();
        return;
      }
      store('bazar-contacto', { nombre: f.nombre.value.trim(), email: f.email.value.trim(), telefono: f.telefono.value.trim() });
      $('#ap-done-text').innerHTML = `Enviamos los datos para el anticipo a <b>${esc(f.email.value.trim())}</b>. `
        + `Tienes hasta el <b>${esc(data.vence || '')}</b> para transferirlo y mandar tu comprobante respondiendo ese correo.`;
      apForm.hidden = true;
      $('#ap-done').hidden = false;
      refreshCatalog();
    } catch {
      fail('Sin conexión. Revisa tu internet e inténtalo otra vez.');
    } finally {
      btn.disabled = false;
      $('span', btn).textContent = 'Enviarme los datos';
    }
  });

  // Vuelve a pedir el catálogo y repinta sin perder filtros ni la vista abierta.
  async function refreshCatalog() {
    try {
      const res = await fetch(CATALOG_URL, { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      state.settings = data.settings;
      state.items = data.items;
      state.byId = new Map(data.items.map((it) => [it.id, it]));
      renderHero();
      renderGrid();
      renderListUI();
      state.deckBuilt = false;
      if (state.sheetId && state.byId.has(state.sheetId)) showSheet(state.sheetId);
    } catch { /* se queda lo que hay */ }
  }

  $('#d-share').addEventListener('click', async () => {
    const it = state.byId.get(state.sheetId);
    if (!it) return;
    const url = itemUrl(it.id);
    if (navigator.share) {
      try { await navigator.share({ title: it.title, text: `${it.title} — ${fmt(it.price)}`, url }); } catch { /* cancelado */ }
      return;
    }
    try { await navigator.clipboard.writeText(url); toast('Enlace copiado'); } catch { prompt('Copia el enlace:', url); }
  });

  // galería
  const gTrack = $('#g-track');
  function paintGalleryNav() {
    const i = Math.round(gTrack.scrollLeft / (gTrack.clientWidth || 1));
    const n = gTrack.children.length;
    $$('#g-dots span').forEach((d, k) => d.classList.toggle('is-on', k === i));
    $('#g-prev').disabled = i <= 0;
    $('#g-next').disabled = i >= n - 1;
  }
  gTrack.addEventListener('scroll', () => requestAnimationFrame(paintGalleryNav), { passive: true });
  $('#g-prev').addEventListener('click', () => gTrack.scrollBy({ left: -gTrack.clientWidth, behavior: 'smooth' }));
  $('#g-next').addEventListener('click', () => gTrack.scrollBy({ left: gTrack.clientWidth, behavior: 'smooth' }));

  // Arrastrar la hoja hacia abajo para cerrarla (móvil).
  (() => {
    const grab = $('#sheet-grab');
    const sheet = $('#sheet');
    let startY = null; let dy = 0; let t0 = 0;
    grab.addEventListener('pointerdown', (e) => {
      startY = e.clientY; dy = 0; t0 = performance.now();
      grab.setPointerCapture(e.pointerId);
      sheet.classList.add('dragging');
    });
    grab.addEventListener('pointermove', (e) => {
      if (startY === null) return;
      dy = Math.max(0, e.clientY - startY);
      sheet.style.setProperty('--drag', `${dy}px`);
    });
    const end = () => {
      if (startY === null) return;
      startY = null;
      sheet.classList.remove('dragging');
      const fast = dy > 40 && dy / (performance.now() - t0) > 0.6;
      if (dy > 130 || fast) closeItem();
      else sheet.style.removeProperty('--drag');
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  })();

  // ------------------------------------------------------------ descubrir

  function buildDeck() {
    const avail = state.items.filter((i) => i.status === 'disponible');
    const feat = shuffle(avail.filter((i) => i.featured));
    const rest = shuffle(avail.filter((i) => !i.featured));
    state.deck = [...feat, ...rest];
    state.deckPos = 0;
    state.deckHistory = [];
    $('#deck').innerHTML = '';
    fillDeck();
  }

  function deckCard(it) {
    const el = document.createElement('div');
    el.className = 'dcard';
    el.dataset.id = it.id;
    el.innerHTML = `
      ${pic(it, false)}
      <span class="price-tag">${fmt(it.price)}${offTag(it)}</span>
      <span class="stamp like">ME INTERESA</span>
      <span class="stamp nope">PASO</span>
      <div class="dcard-info">
        <h3>${esc(it.title)}</h3>
        <p>${esc([it.category, it.condition].filter(Boolean).join(' · '))}</p>
        ${it.apartable ? '<span class="tagline-pill">✦ Se puede apartar</span>' : ''}
      </div>`;
    bindDrag(el);
    return el;
  }

  const liveCards = () => $$('.dcard:not(.fly)', $('#deck'));

  function fillDeck() {
    const deck = $('#deck');
    $('.deck-end', deck)?.remove();
    let cards = liveCards();
    for (let k = cards.length; k < 3; k++) {
      const it = state.deck[state.deckPos + k];
      if (!it) break;
      const el = deckCard(it);
      el.dataset.k = '3';
      deck.prepend(el);
    }
    cards = liveCards();
    // Las tarjetas nuevas nacen ocultas (k=3); el reflow permite que entren animadas.
    void deck.offsetWidth;
    cards.forEach((el, idx) => { el.dataset.k = String(cards.length - 1 - idx); });
    const left = state.deck.length - state.deckPos;
    $('#deck-count').textContent = state.deck.length ? `${Math.min(state.deckPos + 1, state.deck.length)} de ${state.deck.length}` : '';
    $('#deck-undo').disabled = !state.deckHistory.length;
    ['#deck-nope', '#deck-like', '#deck-info'].forEach((s) => { $(s).disabled = left <= 0; });
    if (left <= 0) {
      const liked = state.deckHistory.filter((h) => h.dir === 'like').length;
      const end = document.createElement('div');
      end.className = 'deck-end';
      end.innerHTML = state.deck.length ? `
        <div class="empty-art"><svg><use href="#i-check"/></svg></div>
        <h3>¡Lo viste todo!</h3>
        <p>${liked ? `Te interesaron ${liked} ${liked === 1 ? 'artículo' : 'artículos'}.` : 'Nada te convenció esta vez.'}</p>
        <div class="row">
          <button class="btn btn-primary" data-open-list><svg><use href="#i-heart"/></svg>Ver mi lista</button>
          <button class="btn btn-ghost" id="deck-restart"><svg><use href="#i-undo"/></svg>Otra vuelta</button>
        </div>` : `
        <div class="empty-art"><svg><use href="#i-tag"/></svg></div>
        <h3>No hay artículos disponibles</h3>
        <p>Vuelve pronto.</p>`;
      deck.append(end);
      $('#deck-restart', end)?.addEventListener('click', buildDeck);
    }
  }

  function topCard() { const c = liveCards(); return c[c.length - 1] || null; }

  function fling(el, dir, dy = 0) {
    if (!el) return;
    const id = el.dataset.id;
    const w = window.innerWidth;
    el.classList.remove('dragging');
    el.classList.add('fly');
    el.style.setProperty(dir === 'like' ? '--like' : '--nope', 1);
    el.style.transform = `translate(${dir === 'like' ? w : -w}px, ${dy + 40}px) rotate(${dir === 'like' ? 28 : -28}deg)`;
    setTimeout(() => el.remove(), 520);
    state.deckHistory.push({ id, dir, liked: state.list.includes(id) });
    state.deckPos += 1;
    if (dir === 'like' && !state.list.includes(id)) {
      state.list = [...state.list, id];
      store('bazar-list', state.list);
      syncHearts(id);
      renderListUI(true);
    }
    fillDeck();
  }

  function undo() {
    const last = state.deckHistory.pop();
    if (!last) return;
    state.deckPos -= 1;
    if (last.dir === 'like' && !last.liked) {
      state.list = state.list.filter((x) => x !== last.id);
      store('bazar-list', state.list);
      syncHearts(last.id);
      renderListUI();
    }
    const it = state.byId.get(last.id);
    const deck = $('#deck');
    $('.deck-end', deck)?.remove();
    const el = deckCard(it);
    el.classList.add('dragging');
    const side = last.dir === 'like' ? 1 : -1;
    el.style.transform = `translate(${side * window.innerWidth}px, 40px) rotate(${side * 28}deg)`;
    deck.append(el);
    void el.offsetWidth;
    el.classList.remove('dragging');
    el.style.transform = '';
    const cards = liveCards();
    if (cards.length > 3) cards[0].remove();
    fillDeck();
  }

  function bindDrag(el) {
    let sx = 0; let sy = 0; let dx = 0; let dy = 0; let pid = null; let t0 = 0;
    el.addEventListener('pointerdown', (e) => {
      if (el !== topCard() || (e.button && e.button !== 0)) return;
      pid = e.pointerId; sx = e.clientX; sy = e.clientY; dx = dy = 0; t0 = performance.now();
      el.setPointerCapture(pid);
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      dx = e.clientX - sx; dy = e.clientY - sy;
      el.style.transform = `translate(${dx}px, ${dy * 0.4}px) rotate(${dx / 16}deg)`;
      el.style.setProperty('--like', clamp(dx / 110, 0, 1));
      el.style.setProperty('--nope', clamp(-dx / 110, 0, 1));
    });
    const end = (e) => {
      if (e.pointerId !== pid) return;
      pid = null;
      const speed = Math.abs(dx) / (performance.now() - t0);
      if (Math.abs(dx) > 110 || (Math.abs(dx) > 40 && speed > 0.7)) { fling(el, dx > 0 ? 'like' : 'nope', dy * 0.4); return; }
      el.classList.remove('dragging');
      el.style.transform = '';
      el.style.setProperty('--like', 0);
      el.style.setProperty('--nope', 0);
      if (e.type === 'pointerup' && Math.abs(dx) < 6 && Math.abs(dy) < 6) openItem(el.dataset.id);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  $('#deck-like').addEventListener('click', () => fling(topCard(), 'like'));
  $('#deck-nope').addEventListener('click', () => fling(topCard(), 'nope'));
  $('#deck-info').addEventListener('click', () => { const c = topCard(); if (c) openItem(c.dataset.id); });
  $('#deck-undo').addEventListener('click', undo);

  // ------------------------------------------------------------ vistas y rutas

  function showView(name) {
    if (state.view === name && !$(`#view-${name}`).hidden) return;
    const prev = state.view;
    state.view = name;
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== name; v.classList.toggle('is-active', v.dataset.view === name); });
    $$('[data-nav]').forEach((a) => a.classList.toggle('is-active', a.dataset.nav === name));
    $('.dock').style.setProperty('--pos', name === 'discover' ? 1 : 0);
    if (name === 'discover' && !state.deckBuilt) { state.deckBuilt = true; buildDeck(); }
    if (prev !== name) window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function route() {
    const [view, id] = location.hash.replace(/^#\/?/, '').split('/');
    if (view === 'item' && id) {
      if (!$(`#view-${state.view}`) || $(`#view-${state.view}`).hidden) showView(state.view || 'home');
      showSheet(id);
      return;
    }
    hideSheet();
    showView(view === 'descubrir' ? 'discover' : 'home');
  }
  window.addEventListener('hashchange', () => { if (state.gridReady) route(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!filterPop.hidden) return toggleFilters(false);
      if (state.sheetId) return closeItem();
      if (!$('#ap').hidden) return closeApartar();
      if (!$('#drawer').hidden) return closeList();
    }
    if (state.view !== 'discover' || state.sheetId || !$('#drawer').hidden || e.target.matches('input')) return;
    if (e.key === 'ArrowRight') fling(topCard(), 'like');
    else if (e.key === 'ArrowLeft') fling(topCard(), 'nope');
    else if (e.key === 'ArrowUp' || e.key === 'Enter') { const c = topCard(); if (c) openItem(c.dataset.id); }
    else if (e.key === 'Backspace' || e.key.toLowerCase() === 'z') undo();
  });

  // Sombras de la barra superior y del filtro al desplazarse.
  const onScroll = () => {
    $('.topbar').classList.toggle('scrolled', window.scrollY > 8);
    const tb = $('#toolbar');
    if (!tb.hidden) tb.classList.toggle('stuck', tb.getBoundingClientRect().top <= parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) + 1);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  load();
})();
