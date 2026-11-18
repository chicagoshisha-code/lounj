/* Lounj app — vanilla JS, no build step. */
(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const store = {
    get(k, d) { try { const v = localStorage.getItem('lounj:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('lounj:' + k, JSON.stringify(v)); } catch {} },
  };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lang = (navigator.language || 'en').slice(0, 2);
  const MILES_LOCALES = /^(en-US|en-GB|en-LR|my|en-MM)$/i;

  const S = {
    loc: store.get('loc', null),             // {lat,lng,label}
    unit: store.get('unit', MILES_LOCALES.test(navigator.language || '') ? 'mi' : 'km'),
    radiusIdx: store.get('radiusIdx', 2),
    places: [], source: 'osm', loading: false,
    openOnly: false, q: '',
    saved: store.get('saved', []),
    view: 'explore', watchId: null, lastFetch: null,
  };
  const RADII = { mi: [2, 5, 10, 25], km: [3, 8, 15, 40] };
  const toMeters = (v, u) => Math.round(u === 'mi' ? v * 1609.34 : v * 1000);

  /* ---------- toast ---------- */
  let tT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(tT); tT = setTimeout(() => t.classList.remove('show'), 2800); }

  /* ---------- geometry ---------- */
  function dist(a, b) {
    const R = 6371e3, r = x => x * Math.PI / 180;
    const dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function fmtDist(m) {
    if (S.unit === 'mi') { const mi = m / 1609.34; return (mi < 0.1 ? '<0.1' : mi < 10 ? mi.toFixed(1) : Math.round(mi)) + ' mi'; }
    const km = m / 1000; return (km < 0.1 ? '<0.1' : km < 10 ? km.toFixed(1) : Math.round(km)) + ' km';
  }

  /* ---------- opening hours (OSM, common formats) ---------- */
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const DAYNAME = { Mo: 'Mon', Tu: 'Tue', We: 'Wed', Th: 'Thu', Fr: 'Fri', Sa: 'Sat', Su: 'Sun' };
  function parseHours(str) {
    // returns array[7] of [[startMin,endMin],...] (end may exceed 1440) or null if unparseable
    if (!str) return null;
    str = str.trim();
    if (str === '24/7') return DAYS.map(() => [[0, 1440]]);
    const week = DAYS.map(() => []);
    const rules = str.split(/\s*;\s*/).filter(Boolean);
    for (const rule of rules) {
      const m = rule.match(/^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:\s*,\s*(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)?\s*(.*)$/);
      if (!m) return null;
      let days = [];
      if (m[1]) {
        for (const part of m[1].split(/\s*,\s*/)) {
          const [a, b] = part.split(/\s*-\s*/);
          const ia = DAYS.indexOf(a), ib = b ? DAYS.indexOf(b) : ia;
          if (ia < 0 || ib < 0) return null;
          for (let i = ia; ; i = (i + 1) % 7) { days.push(i); if (i === ib) break; }
        }
      } else days = [0, 1, 2, 3, 4, 5, 6];
      const times = m[2].trim();
      if (/^off|closed$/i.test(times)) { days.forEach(d => week[d] = []); continue; }
      const spans = [];
      for (const t of times.split(/\s*,\s*/)) {
        const tm = t.match(/^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\+?$/);
        if (!tm) return null;
        let s = +tm[1] * 60 + +tm[2], e = +tm[3] * 60 + +tm[4];
        if (e <= s) e += 1440;
        spans.push([s, e]);
      }
      days.forEach(d => week[d] = spans);
    }
    return week;
  }
  function openState(p) {
    if (p.openNow === true) return 'open';
    if (p.openNow === false) return 'closed';
    const w = parseHours(p.hours);
    if (!w) return 'unknown';
    const now = new Date(), d = (now.getDay() + 6) % 7, min = now.getHours() * 60 + now.getMinutes();
    const prev = (d + 6) % 7;
    if (w[d].some(([s, e]) => min >= s && min < e)) return 'open';
    if (w[prev].some(([s, e]) => e > 1440 && min < e - 1440)) return 'open';
    return 'closed';
  }
  function fmtMin(m) {
    m %= 1440; const h = Math.floor(m / 60), mm = m % 60;
    if (S.unit === 'mi') { const ap = h < 12 ? 'AM' : 'PM'; const hh = h % 12 || 12; return mm ? `${hh}:${String(mm).padStart(2, '0')} ${ap}` : `${hh} ${ap}`; }
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  function hoursRows(p) {
    if (p.hoursList && p.hoursList.length) {
      const today = (new Date().getDay() + 6) % 7;
      return p.hoursList.map((line, i) => { const [d, ...rest] = line.split(': '); return [d.slice(0, 3), rest.join(': '), i === today]; });
    }
    const w = parseHours(p.hours);
    if (!w) return p.hours ? [['', p.hours.replace(/;\s*/g, '\n'), false]] : null;
    const today = (new Date().getDay() + 6) % 7;
    return DAYS.map((d, i) => [DAYNAME[d], w[i].length ? w[i].map(([s, e]) => `${fmtMin(s)} – ${fmtMin(e)}`).join(', ') : 'Closed', i === today]);
  }

  /* ---------- look ---------- */
  const PAL = ['#B5532B', '#8A5A2B', '#2F6F5E', '#7A4E8A', '#A23F4F', '#3D6A9A', '#9A7B2F', '#5B6B3A'];
  function color(name) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return PAL[h % PAL.length]; }
  function initials(name) { return (name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('') || '•').toUpperCase(); }
  function thumb(p, cls = 'thumb') {
    const bg = `background:linear-gradient(140deg,${color(p.name)},${color(p.name + 'x')})`;
    return `<div class="${cls}" style="${bg}">${p.photo ? `<img src="${esc(p.photo)}" alt="" loading="lazy">` : esc(initials(p.name))}</div>`;
  }

  /* ---------- views ---------- */
  function show(v) {
    S.view = v;
    ['welcome', 'explore', 'map', 'saved', 'about'].forEach(x => $('#v-' + x).hidden = x !== v);
    $$('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
    if (v === 'map') initMap();
    if (v === 'saved') renderSaved();
    window.scrollTo(0, 0);
  }
  $$('.tabs button').forEach(b => b.onclick = () => {
    if (!S.loc && (b.dataset.v === 'explore' || b.dataset.v === 'map')) return show('welcome');
    show(b.dataset.v);
  });
  $('#logo').onclick = e => { e.preventDefault(); show(S.loc ? 'explore' : 'welcome'); };

  /* ---------- location ---------- */
  function setLoc(loc, { silent } = {}) {
    S.loc = loc; store.set('loc', loc);
    $('#whereTxt').textContent = loc.label || 'Near you';
    if (!loc.label) labelFor(loc);
    if (S.view === 'welcome') show('explore');
    load({ silent });
  }
  async function labelFor(loc) {
    try {
      const r = await fetch(`/api/where?lat=${loc.lat}&lng=${loc.lng}&lang=${lang}`).then(r => r.json());
      if (r.name && S.loc === loc) { loc.label = r.name; store.set('loc', loc); $('#whereTxt').textContent = r.name; }
    } catch {}
  }
  function locate() {
    if (!('geolocation' in navigator)) { toast('Location not available on this device'); return openLocSheet(); }
    toast('Finding your location…');
    navigator.geolocation.getCurrentPosition(pos => {
      $('#toast').classList.remove('show');
      closeSheets();
      setLoc({ lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4), label: '', gps: true });
      watch();
    }, err => {
      toast(err.code === 1 ? 'Location permission is off. Search a city instead.' : 'Could not get your location. Try searching a city.');
      openLocSheet();
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }
  // Keep results fresh as the person moves (e.g. travelling to another city).
  function watch() {
    if (S.watchId != null || !('geolocation' in navigator)) return;
    S.watchId = navigator.geolocation.watchPosition(pos => {
      if (!S.loc || !S.loc.gps) return;
      const here = { lat: +pos.coords.latitude.toFixed(4), lng: +pos.coords.longitude.toFixed(4) };
      if (dist(here, S.loc) > 3000) { setLoc({ ...here, label: '', gps: true }, { silent: true }); toast('Updated for your new location'); }
    }, () => {}, { enableHighAccuracy: false, maximumAge: 120000, timeout: 30000 });
  }
  $('#useLoc').onclick = locate;
  $('#locHere').onclick = locate;
  $('#searchCity').onclick = openLocSheet;
  $('#whereBtn').onclick = openLocSheet;

  function openLocSheet() { openSheet('#locSheet'); setTimeout(() => $('#cityQ').focus(), 150); }
  let gT;
  $('#cityQ').addEventListener('input', e => {
    clearTimeout(gT);
    const q = e.target.value.trim();
    if (q.length < 2) { $('#cityResults').innerHTML = ''; return; }
    gT = setTimeout(async () => {
      $('#cityResults').innerHTML = '<li class="muted" style="padding:12px 4px">Searching…</li>';
      try {
        const { results } = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&lang=${lang}`).then(r => r.json());
        $('#cityResults').innerHTML = results.length ? results.map((r, i) => `<li><button data-i="${i}"><b>${esc(r.name)}</b><small>${esc(r.detail)}</small></button></li>`).join('')
          : '<li class="muted" style="padding:12px 4px">No places found. Try a city name.</li>';
        $$('#cityResults button').forEach(b => b.onclick = () => { const r = results[+b.dataset.i]; closeSheets(); setLoc({ lat: r.lat, lng: r.lng, label: r.name, gps: false }); });
      } catch { $('#cityResults').innerHTML = '<li class="err" style="padding:12px 4px">Search is unavailable right now.</li>'; }
    }, 350);
  });

  /* ---------- loading lounges ---------- */
  async function load({ silent } = {}) {
    if (!S.loc) return;
    const r = toMeters(RADII[S.unit][S.radiusIdx], S.unit);
    S.loading = true;
    if (!silent) { $('#list').innerHTML = '<li class="skel"></li>'.repeat(4); $('#status').textContent = 'Looking for lounges…'; }
    try {
      const res = await fetch(`/api/nearby?lat=${S.loc.lat}&lng=${S.loc.lng}&r=${r}`);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      S.source = data.source;
      S.places = data.places.map(p => ({ ...p, d: dist(S.loc, p) })).filter(p => p.d <= r * 1.15).sort((a, b) => a.d - b.d);
      S.lastFetch = { ...S.loc };
    } catch (e) {
      S.places = [];
      $('#status').innerHTML = '<span class="err">Couldn\'t load lounges. Check your connection and try again.</span>';
      $('#list').innerHTML = `<li class="empty"><button class="btn ghost" id="retry">Try again</button></li>`;
      $('#retry').onclick = () => load();
      S.loading = false; return;
    }
    S.loading = false;
    render();
    if (mapReady) drawMap();
  }

  function filtered() {
    const q = S.q.toLowerCase();
    return S.places.filter(p => (!q || p.name.toLowerCase().includes(q)) && (!S.openOnly || openState(p) === 'open'));
  }
  function statusText(p) {
    const st = openState(p);
    return st === 'open' ? '<span class="open">Open now</span>' : st === 'closed' ? '<span class="closed">Closed</span>' : '<span class="unk">Hours not listed</span>';
  }
  function cardHtml(p, i) {
    const tags = [];
    if (p.partner) tags.push('<span class="badge book">Book</span>');
    if (p.outdoor) tags.push('<span class="tag">Outdoor seating</span>');
    if (p.food) tags.push('<span class="tag">Food</span>');
    if (p.price) tags.push(`<span class="tag">${esc(p.price)}</span>`);
    return `<li><button class="card" data-id="${esc(p.id)}">
      ${thumb(p)}
      <div style="min-width:0">
        <h3>${esc(p.name)}</h3>
        <div class="meta">${p.rating ? `<span class="star">★ ${p.rating.toFixed(1)}</span><span>(${p.ratings})</span>` : ''}${p.d != null ? `<span>${fmtDist(p.d)}</span>` : ''}${statusText(p)}</div>
        ${p.address ? `<div class="addr">${esc(p.address)}</div>` : ''}
        ${tags.length ? `<div class="tags">${tags.join('')}</div>` : ''}
      </div></button></li>`;
  }
  function render() {
    const L = filtered();
    const unitLabel = `${RADII[S.unit][S.radiusIdx]} ${S.unit}`;
    $('#status').innerHTML = S.places.length
      ? `<b>${L.length}</b> lounge${L.length === 1 ? '' : 's'} within ${unitLabel}${S.openOnly ? ', open now' : ''}`
      : '';
    if (!L.length) {
      const wider = S.radiusIdx < 3;
      $('#list').innerHTML = `<li class="empty"><div class="empty-ic">☁</div>
        <p>${S.places.length ? 'No lounges match your filters.' : `No hookah lounges found within ${unitLabel}.`}</p>
        ${wider && !S.places.length ? `<button class="btn primary" id="widen">Search a wider area</button>` : ''}
        <button class="btn ghost" id="missing">Know a lounge we're missing?</button></li>`;
      if ($('#widen')) $('#widen').onclick = () => { S.radiusIdx = Math.min(3, S.radiusIdx + 1); store.set('radiusIdx', S.radiusIdx); renderRadii(); load(); };
      $('#missing').onclick = () => openForm({ kind: 'claim', place: null, missing: true });
    } else {
      $('#list').innerHTML = L.map(cardHtml).join('');
      $$('#list .card').forEach(b => b.onclick = () => openDetail(S.places.find(p => p.id === b.dataset.id)));
    }
    $('#credit').innerHTML = S.source === 'google' ? 'Listings powered by Google' :
      'Listings from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  }
  function renderRadii() {
    $('#radii').innerHTML = RADII[S.unit].map((v, i) => `<button role="radio" aria-checked="${i === S.radiusIdx}" data-i="${i}">${v} ${S.unit}</button>`).join('');
    $$('#radii button').forEach(b => b.onclick = () => { S.radiusIdx = +b.dataset.i; store.set('radiusIdx', S.radiusIdx); renderRadii(); load(); });
  }
  $('#fOpen').onclick = () => { S.openOnly = !S.openOnly; $('#fOpen').setAttribute('aria-pressed', S.openOnly); render(); if (mapReady) drawMap(); };
  $('#q').addEventListener('input', e => { S.q = e.target.value; render(); });

  /* ---------- detail ---------- */
  const ICON = {
    dir: '<svg viewBox="0 0 24 24"><path d="M12 2l9 9-9 11-9-11z"/><path d="M9 12h6M12 9l3 3-3 3"/></svg>',
    call: '<svg viewBox="0 0 24 24"><path d="M5 3h4l2 5-3 2a12 12 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 5a2 2 0 0 1 2-2z"/></svg>',
    web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    save: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    saved: '<svg viewBox="0 0 24 24" style="fill:currentColor"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    ig: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".6"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>',
  };
  const isApple = /iPhone|iPad|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document;
  function dirUrl(p) {
    return isApple ? `https://maps.apple.com/?daddr=${p.lat},${p.lng}&q=${encodeURIComponent(p.name)}`
      : `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  }
  function isSaved(p) { return S.saved.some(x => x.id === p.id); }
  function toggleSave(p) {
    if (isSaved(p)) { S.saved = S.saved.filter(x => x.id !== p.id); toast('Removed from saved'); }
    else { const { d, ...keep } = p; S.saved.unshift(keep); toast('Saved'); }
    store.set('saved', S.saved);
  }
  function openDetail(p) {
    if (!p) return;
    const rows = hoursRows(p);
    const tel = p.phone ? p.phone.replace(/[^\d+]/g, '') : '';
    const feats = [p.outdoor && 'Outdoor seating', p.food && 'Food', p.wheelchair === 'yes' && 'Wheelchair accessible', p.price].filter(Boolean);
    $('#detailInner').innerHTML = `
      <div class="d-hero" style="background:linear-gradient(140deg,${color(p.name)},${color(p.name + 'x')})">
        ${p.photo ? `<img src="${esc(p.photo)}" alt="">${p.photoCredit ? `<span class="credit-ph">Photo: ${esc(p.photoCredit)}</span>` : ''}` : esc(initials(p.name))}
        <button class="icon-btn" data-close aria-label="Close">✕</button>
      </div>
      <div class="d-body">
        <h2 id="dName">${esc(p.name)}</h2>
        <div class="d-sub">${p.rating ? `<span class="star">★ ${p.rating.toFixed(1)}</span><span>(${p.ratings})</span>` : ''}
          ${p.d != null ? `<span>${fmtDist(p.d)} away</span>` : ''}<span>${esc(p.kind || 'Hookah lounge')}</span></div>
        <div style="margin-top:6px">${statusText(p)}</div>
        <div class="acts">
          <a href="${dirUrl(p)}" target="_blank" rel="noopener">${ICON.dir}Directions</a>
          <a href="${tel ? 'tel:' + esc(tel) : '#'}" class="${tel ? '' : 'dis'}">${ICON.call}Call</a>
          <a href="${p.website ? esc(p.website) : '#'}" target="_blank" rel="noopener" class="${p.website ? '' : 'dis'}">${ICON.web}Website</a>
          <button id="dSave">${isSaved(p) ? ICON.saved + 'Saved' : ICON.save + 'Save'}</button>
        </div>
        <div class="rows">
          ${p.address ? `<div class="row">${ICON.pin}<div>${esc(p.address)}</div></div>` : `<div class="row">${ICON.pin}<div class="muted">Address not listed · <a href="${dirUrl(p)}" target="_blank" rel="noopener">open in maps</a></div></div>`}
          <div class="row">${ICON.clock}<div>${rows ? `${statusText(p)}<div class="hours">${rows.map(([d, h, t]) => `<span class="${t ? 'today' : ''}">${esc(d)}</span><span class="${t ? 'today' : ''}" style="white-space:pre-line">${esc(h)}</span>`).join('')}</div>` : '<span class="muted">Hours not listed. Call ahead to check.</span>'}</div></div>
          ${p.phone ? `<div class="row">${ICON.call}<div><a href="tel:${esc(tel)}">${esc(p.phone)}</a></div></div>` : ''}
          ${p.website ? `<div class="row">${ICON.web}<div><a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a></div></div>` : ''}
          ${p.instagram ? `<div class="row">${ICON.ig}<div><a href="${esc(p.instagram)}" target="_blank" rel="noopener">Instagram</a></div></div>` : ''}
        </div>
        ${feats.length ? `<div class="feat">${feats.map(f => `<span class="tag">${esc(f)}</span>`).join('')}</div>` : ''}
        <div class="cta-box">
          ${p.partner ? `<p><b>Book a table</b> with a deposit that goes toward your bill.</p><a class="btn primary block" href="${esc(p.partner)}">Book a table</a>`
            : `<p>This lounge doesn't take online bookings yet. Want to reserve a table here?</p><button class="btn primary block" id="dReq">Request online booking</button>`}
          <button class="btn ghost block" id="dShare">${ICON.share}Share this lounge</button>
        </div>
        <a href="#" class="claim" id="dClaim">Own this lounge? Claim it for free</a>
        <p class="src">${S.source === 'google' ? 'Info from Google. ' : `Info from <a href="${esc(p.osmUrl || 'https://www.openstreetmap.org')}" target="_blank" rel="noopener">OpenStreetMap</a>. `}Details can change, so call ahead.</p>
      </div>`;
    openSheet('#detail');
    $('#dSave').onclick = () => { toggleSave(p); $('#dSave').innerHTML = isSaved(p) ? ICON.saved + 'Saved' : ICON.save + 'Save'; };
    if ($('#dReq')) $('#dReq').onclick = () => openForm({ kind: 'booking', place: p });
    $('#dClaim').onclick = e => { e.preventDefault(); openForm({ kind: 'claim', place: p }); };
    $('#dShare').onclick = async () => {
      const text = `${p.name}${p.address ? ' · ' + p.address : ''}`;
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=&center=${p.lat},${p.lng}`;
      try {
        if (navigator.share) await navigator.share({ title: p.name, text, url: `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` });
        else { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Copied to clipboard'); }
      } catch {}
    };
  }

  /* ---------- forms ---------- */
  function openForm({ kind, place, missing }) {
    const booking = kind === 'booking';
    const title = booking ? 'Request online booking' : missing ? 'Add a missing lounge' : 'Claim this lounge';
    const intro = booking
      ? `We'll let <b>${esc(place.name)}</b> know guests want to book online. Leave your email if you'd like a heads-up when booking opens.`
      : missing ? 'Tell us the lounge name and city and we\'ll add it.'
      : `Get bookings, deposits and deals for <b>${esc(place?.name || 'your lounge')}</b>. We'll reach out to verify you're the owner.`;
    $('#formInner').innerHTML = `
      <div class="sheet-head"><h2 id="formTitle">${title}</h2><button class="icon-btn" data-close aria-label="Close">✕</button></div>
      <p class="muted" style="margin-bottom:14px">${intro}</p>
      <form class="form" id="reqForm" novalidate>
        ${missing ? `<label>Lounge name<input name="placeName" required maxlength="120"></label><label>City and address<input name="address" maxlength="200"></label>` : ''}
        <label>Your name ${booking ? '<span class="hint">(optional)</span>' : ''}<input name="name" autocomplete="name" maxlength="80" ${booking ? '' : 'required'}></label>
        <label>Email ${booking ? '<span class="hint">(optional)</span>' : ''}<input name="email" type="email" autocomplete="email" maxlength="120" ${booking ? '' : 'required'}></label>
        ${booking ? '' : `<label>Phone <span class="hint">(optional)</span><input name="phone" type="tel" autocomplete="tel" maxlength="40"></label>`}
        <label>Note <span class="hint">(optional)</span><textarea name="note" maxlength="500" placeholder="${booking ? 'e.g. party of 6 on Saturdays' : 'Anything we should know'}"></textarea></label>
        <p class="err" id="formErr" hidden></p>
        <button class="btn primary big" type="submit">${booking ? 'Send request' : missing ? 'Send' : 'Claim listing'}</button>
      </form>`;
    openSheet('#formSheet', true);
    $('#reqForm').onsubmit = async e => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      const err = $('#formErr');
      if (!booking && (!f.name || !f.email)) { err.textContent = 'Please add your name and email.'; err.hidden = false; return; }
      if (missing && !f.placeName) { err.textContent = 'Please add the lounge name.'; err.hidden = false; return; }
      if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) { err.textContent = 'That email doesn\'t look right.'; err.hidden = false; return; }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const res = await fetch('/api/request', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: missing ? 'claim' : kind, placeId: place?.id || 'missing', placeName: f.placeName || place?.name, address: f.address || place?.address || '', ...f }) });
        if (!res.ok) throw new Error();
        $('#formInner').innerHTML = `<div class="center" style="padding:10px 0">
          <div class="empty-ic" style="color:var(--green)">✓</div>
          <h2 style="font-family:var(--serif)">${booking ? 'Request sent' : 'Thanks!'}</h2>
          <p class="muted">${booking ? 'We\'ll let the lounge know. The more guests ask, the faster they join.' : 'We\'ll be in touch soon.'}</p>
          <button class="btn primary big" data-close>Done</button></div>`;
        bindClose();
      } catch { btn.disabled = false; btn.textContent = 'Try again'; err.textContent = 'Couldn\'t send. Check your connection.'; err.hidden = false; }
    };
  }
  $('#claimAny').onclick = () => openForm({ kind: 'claim', place: null, missing: true });
  $('#addMissing').onclick = e => { e.preventDefault(); openForm({ kind: 'claim', place: null, missing: true }); };

  /* ---------- sheets ---------- */
  let lastFocus;
  function openSheet(sel, stack) {
    if (!stack) closeSheets();
    lastFocus = document.activeElement;
    const s = $(sel); s.hidden = false; document.body.style.overflow = 'hidden';
    s.querySelector('.sheet-inner').scrollTop = 0;
    bindClose();
    const f = s.querySelector('[data-close], button, input'); if (f) setTimeout(() => f.focus({ preventScroll: true }), 50);
  }
  function closeSheets(sel) {
    $$(sel ? sel : '.sheet').forEach(s => { if (s.id !== 'ageSheet' || store.get('age', false)) s.hidden = true; });
    if ($$('.sheet').every(s => s.hidden)) document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function bindClose() {
    $$('[data-close]').forEach(b => b.onclick = e => { e.preventDefault(); const s = b.closest('.sheet'); s.hidden = true; if ($$('.sheet').every(x => x.hidden)) document.body.style.overflow = ''; });
  }
  $$('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s && s.id !== 'ageSheet') { s.hidden = true; if ($$('.sheet').every(x => x.hidden)) document.body.style.overflow = ''; } }));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { const open = $$('.sheet').filter(s => !s.hidden && s.id !== 'ageSheet').pop(); if (open) { open.hidden = true; if ($$('.sheet').every(x => x.hidden)) document.body.style.overflow = ''; } } });

  /* ---------- saved ---------- */
  function renderSaved() {
    const L = S.saved.map(p => ({ ...p, d: S.loc ? dist(S.loc, p) : null }));
    $('#savedEmpty').hidden = L.length > 0;
    $('#savedList').innerHTML = L.map(cardHtml).join('');
    $$('#savedList .card').forEach(b => b.onclick = () => openDetail(L.find(p => p.id === b.dataset.id)));
  }

  /* ---------- map (Leaflet, loaded on demand) ---------- */
  let map, layer, mapReady = false, meMarker;
  function loadLeaflet() {
    return new Promise((ok, fail) => {
      if (window.L) return ok();
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; document.head.appendChild(css);
      const js = document.createElement('script'); js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; js.onload = ok; js.onerror = fail; document.head.appendChild(js);
    });
  }
  async function initMap() {
    if (!S.loc) return;
    try { await loadLeaflet(); } catch { toast('Map could not load'); return; }
    if (!map) {
      map = L.map('map', { zoomControl: false }).setView([S.loc.lat, S.loc.lng], 12);
      L.control.zoom({ position: 'topright' }).addTo(map);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      layer = L.layerGroup().addTo(map);
      map.on('click', () => { $('#mapcard').hidden = true; });
      mapReady = true;
    }
    setTimeout(() => { map.invalidateSize(); drawMap(); }, 60);
  }
  function drawMap() {
    if (!map || !S.loc) return;
    layer.clearLayers();
    if (meMarker) meMarker.remove();
    meMarker = L.marker([S.loc.lat, S.loc.lng], { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), interactive: false }).addTo(map);
    const pts = [[S.loc.lat, S.loc.lng]];
    filtered().forEach((p, i) => {
      const m = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: '', html: `<div class="pin"><b>${i + 1}</b></div>`, iconSize: [34, 34], iconAnchor: [17, 34] }), title: p.name, alt: p.name });
      m.on('click', e => { L.DomEvent.stopPropagation(e); showMapCard(p); });
      m.addTo(layer); pts.push([p.lat, p.lng]);
    });
    if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 }); else map.setView(pts[0], 12);
  }
  function showMapCard(p) {
    const c = $('#mapcard'); c.innerHTML = `<ul class="list">${cardHtml(p)}</ul>`; c.hidden = false;
    c.querySelector('.card').onclick = () => openDetail(p);
  }

  /* ---------- settings ---------- */
  function renderUnits() {
    $$('.seg button').forEach(b => b.setAttribute('aria-checked', b.dataset.u === S.unit));
  }
  $$('.seg button').forEach(b => b.onclick = () => { if (S.unit === b.dataset.u) return; S.unit = b.dataset.u; store.set('unit', S.unit); renderUnits(); renderRadii(); if (S.loc) load(); });

  /* ---------- start ---------- */
  function start() {
    renderRadii(); renderUnits();
    if (!store.get('age', false)) { $('#ageSheet').hidden = false; document.body.style.overflow = 'hidden'; }
    $('#ageYes').onclick = () => { store.set('age', true); $('#ageSheet').hidden = true; document.body.style.overflow = ''; };
    if (S.loc) {
      $('#whereTxt').textContent = S.loc.label || 'Near you';
      show('explore'); load();
      // Refresh position quietly if the person allowed GPS before.
      if (S.loc.gps && navigator.permissions) navigator.permissions.query({ name: 'geolocation' }).then(st => { if (st.state === 'granted') { watch(); } }).catch(() => {});
    } else show('welcome');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  start();
})();
