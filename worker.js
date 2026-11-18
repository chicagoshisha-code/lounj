/**
 * Lounj — find hookah lounges near you, anywhere in the world.
 *
 * Static app is served from ./public (Workers static assets).
 * API:
 *   GET  /api/nearby?lat=..&lng=..&r=meters   lounges around a point
 *   GET  /api/geocode?q=Berlin               search a city/address
 *   GET  /api/where?lat=..&lng=..            name of the place at a point
 *   GET  /api/photo?name=places/../photos/.. Google photo (Google mode only)
 *   POST /api/request                        guest "request booking" / owner "claim listing"
 *   GET  /api/requests?token=ADMIN_TOKEN     list saved requests (needs KV + ADMIN_TOKEN)
 *
 * Data source:
 *   - Default: OpenStreetMap (Overpass + Nominatim). Free, worldwide, no key.
 *   - If the secret GOOGLE_PLACES_KEY is set: Google Places API (New), with
 *     ratings, photos, phone, website and opening hours.
 */

const UA = 'Lounj/1.0 (lounge finder; contact info@chicagoshisha.com)';
const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const NAME_RE = 'hookah|shisha|sheesha|nargil|narghil|argile|argila|arguile|kalyan|kaljan|kalian|кальян|شيشة|شيشه|نرجيلة|أرجيلة|اركيلة|قلیان|قليان|נרגילה|हुक्का';
const MAX_R = 50000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });
      switch (url.pathname) {
        case '/api/nearby': return await nearby(url, env, ctx);
        case '/api/places': return await placesFromHits(request);
        case '/api/confirm': return await confirm(request, env);
        case '/api/confirms': return await confirms(url, env);
        case '/api/geocode': return await geocode(url, ctx);
        case '/api/where': return await where(url, ctx);
        case '/api/photo': return await photo(url, env);
        case '/api/request': return await saveRequest(request, env);
        case '/api/requests': return await listRequests(url, env);
        case '/api/health': return json({ ok: true, source: env.GOOGLE_PLACES_KEY ? 'google' : 'osm', kv: !!env.LOUNJ_KV });
      }
      return json({ error: 'not_found' }, 404);
    } catch (err) {
      console.error(err && err.stack || err);
      return json({ error: 'server_error', message: String(err && err.message || err) }, 502);
    }
  },
};

/* ---------------- helpers ---------------- */
function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type' }; }
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...cors(), ...extra } });
}
function num(v, lo, hi) { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; }

async function cached(ctx, key, ttl, produce) {
  const cache = caches.default;
  const req = new Request('https://cache.lounj.internal/' + encodeURIComponent(key));
  const hit = await cache.match(req);
  if (hit) return hit.json();
  const data = await produce();
  const keep = Array.isArray(data) && data.length === 0 ? 600 : ttl;
  const res = new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${keep}` } });
  ctx.waitUntil(cache.put(req, res));
  return data;
}

/* ---------------- nearby ---------------- */
async function nearby(url, env, ctx) {
  const lat = num(url.searchParams.get('lat'), -90, 90);
  const lng = num(url.searchParams.get('lng'), -180, 180);
  if (lat === null || lng === null) return json({ error: 'bad_location' }, 400);
  const r = Math.round(Math.min(MAX_R, Math.max(1000, Number(url.searchParams.get('r')) || 16000)));
  // Round to ~1 km so nearby users share the cache.
  const rl = Math.round(lat * 100) / 100, rg = Math.round(lng * 100) / 100;
  if (env.GOOGLE_PLACES_KEY) {
    const places = await cached(ctx, `g2:${rl}:${rg}:${r}`, 6 * 3600, () => googleNearby(rl, rg, r, env.GOOGLE_PLACES_KEY));
    return json({ source: 'google', places }, 200, { 'cache-control': 'public, max-age=600' });
  }
  const places = await cached(ctx, `o3:${rl}:${rg}:${r}`, 6 * 3600, () => osmNearby(rl, rg, r));
  return json({ source: 'osm', places }, 200, { 'cache-control': 'public, max-age=600' });
}

export function overpassQuery(lat, lng, r) {
  const a = `(around:${r},${lat},${lng})`;
  // Keep this cheap: tag lookups plus a name match limited to food & drink places.
  return `[out:json][timeout:20];(
nwr["amenity"="hookah_lounge"]${a};
nwr["hookah"="yes"]${a};
nwr["shisha"="yes"]${a};
nwr["smoking"="hookah"]${a};
nwr["amenity"~"^(cafe|bar|pub|restaurant|nightclub|lounge)$"]["name"~"${NAME_RE}",i]${a};
);out center tags 120;`;
}

async function osmNearby(lat, lng, r) {
  // 1) Photon (OSM search engine): fast keyword search inside a bounding box.
  const dLat = r / 111320, dLng = r / (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map(v => v.toFixed(5)).join(',');
  const words = ['hookah', 'shisha', 'nargile', 'кальян', 'شيشة'];
  const hits = new Map();
  await Promise.all(words.map(async w => {
    try {
      const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(w)}&bbox=${bbox}&lat=${lat}&lon=${lng}&limit=40`,
        { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
      if (!res.ok) return;
      const data = await res.json();
      for (const f of data.features || []) {
        const p = f.properties || {};
        if (!p.osm_id || !p.osm_type || !p.name) continue;
        if (!/^(amenity|leisure|tourism)$/.test(p.osm_key || '')) continue;
        if (!new RegExp(NAME_RE, 'i').test(p.name) && p.osm_value !== 'hookah_lounge') continue;
        const type = { N: 'node', W: 'way', R: 'relation' }[p.osm_type];
        if (!type) continue;
        const [lo, la] = f.geometry?.coordinates || [];
        hits.set(`${type}/${p.osm_id}`, { type, id: p.osm_id, lat: la, lon: lo, tags: {
          name: p.name, amenity: p.osm_key === 'amenity' ? p.osm_value : undefined,
          'addr:housenumber': p.housenumber, 'addr:street': p.street, 'addr:city': p.city || p.district, 'addr:postcode': p.postcode } });
      }
    } catch {}
  }));
  // 2) Overpass, tag-only (cheap) in the same box, as a bonus. Ignored if it's slow.
  try {
    const [w, s, e, n] = bbox.split(',');
    const q = `[out:json][timeout:8][bbox:${s},${w},${n},${e}];(nwr["amenity"="hookah_lounge"];nwr["hookah"="yes"];nwr["shisha"="yes"];);out center tags 80;`;
    const res = await fetch(OVERPASS[0], { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': UA }, signal: AbortSignal.timeout(9000) });
    if (res.ok) {
      const d = await res.json();
      for (const el of d.elements || []) hits.set(`${el.type}/${el.id}`, el);
    }
  } catch {}
  return enrich(hits);
}

async function enrich(hits) {
  // Full tags (hours, phone, website) from the main OSM API, in batches.
  const byType = { node: [], way: [], relation: [] };
  for (const h of hits.values()) if (!h.full) byType[h.type].push(h.id);
  await Promise.all(Object.entries(byType).flatMap(([type, ids]) => {
    const chunks = [];
    for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100));
    return chunks.map(async chunk => {
      try {
        const res = await fetch(`https://api.openstreetmap.org/api/0.6/${type}s.json?${type}s=${chunk.join(',')}`,
          { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return;
        const d = await res.json();
        for (const el of d.elements || []) {
          const h = hits.get(`${type}/${el.id}`);
          if (h && el.tags) h.tags = { ...h.tags, ...el.tags };
        }
      } catch {}
    });
  }));
  for (const h of hits.values()) for (const k of Object.keys(h.tags)) if (h.tags[k] == null) delete h.tags[k];
  return normalizeOsm([...hits.values()].map(h => ({ ...h, lat: h.lat ?? h.center?.lat, lon: h.lon ?? h.center?.lon })));
}

export function normalizeOsm(elements) {
  const seen = new Set();
  const out = [];
  for (const e of elements) {
    const t = e.tags || {};
    if (!t.name) continue;
    const la = e.lat ?? e.center?.lat, lo = e.lon ?? e.center?.lon;
    if (la == null || lo == null) continue;
    const key = t.name.toLowerCase() + Math.round(la * 1000) + Math.round(lo * 1000);
    if (seen.has(key)) continue;
    seen.add(key);
    const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
    const city = t['addr:city'] || t['addr:town'] || t['addr:village'] || t['addr:suburb'] || '';
    const address = [street, city, t['addr:postcode']].filter(Boolean).join(', ') || t['addr:full'] || '';
    let website = t.website || t['contact:website'] || t.url || '';
    if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
    const ig = t['contact:instagram'] || t.instagram || '';
    out.push({
      id: `osm:${e.type}/${e.id}`,
      name: t.name,
      lat: la, lng: lo,
      address, city,
      phone: t.phone || t['contact:phone'] || '',
      website,
      instagram: ig ? (ig.startsWith('http') ? ig : 'https://instagram.com/' + ig.replace(/^@/, '')) : '',
      hours: t.opening_hours || '',
      outdoor: t.outdoor_seating === 'yes',
      wheelchair: t.wheelchair || '',
      food: !!(t.cuisine || t.food === 'yes' || t.amenity === 'restaurant'),
      kind: t.amenity === 'hookah_lounge' ? 'Hookah lounge' : t.amenity ? cap(t.amenity.replace('_', ' ')) + ' · hookah' : 'Hookah lounge',
      cat: category(t),
      hookah: hasHookah(t) ? 'yes' : 'maybe',
      cuisine: (t.cuisine || '').split(';')[0].replace(/_/g, ' '),
      osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    });
  }
  return out;
}
const NAME_TEST = new RegExp(NAME_RE, 'i');
function hasHookah(t) {
  return t.amenity === 'hookah_lounge' || /^(yes|only)$/.test(t.hookah || '') || /^(yes|only)$/.test(t.shisha || '') || t.smoking === 'hookah' || NAME_TEST.test(t.name || '');
}
function category(t) {
  const a = t.amenity || '';
  if (a === 'restaurant' || a === 'fast_food' || a === 'food_court') return 'restaurant';
  if (a === 'hookah_lounge' || a === 'lounge') return 'lounge';
  if (a === 'cafe') return NAME_TEST.test(t.name || '') ? 'lounge' : 'cafe';
  if (a === 'bar' || a === 'pub' || a === 'biergarten') return NAME_TEST.test(t.name || '') ? 'lounge' : 'bar';
  if (a === 'nightclub') return 'club';
  return 'lounge';
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// The app searches Photon from the user's device (Photon blocks server traffic) and
// sends the hits here so we can add hours/phone/website from the OSM API.
async function placesFromHits(request) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  let body; try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const hits = new Map();
  for (const h of (body.hits || []).slice(0, 200)) {
    if (!['node', 'way', 'relation'].includes(h.type) || !Number.isInteger(+h.id)) continue;
    const la = num(h.lat, -90, 90), lo = num(h.lon, -180, 180);
    if (la === null || lo === null) continue;
    const t = h.tags || {};
    const tags = {};
    for (const k of ['name', 'amenity', 'cuisine', 'hookah', 'shisha', 'smoking', 'addr:housenumber', 'addr:street', 'addr:city', 'addr:postcode']) if (t[k]) tags[k] = String(t[k]).slice(0, 200);
    if (!tags.name) continue;
    hits.set(`${h.type}/${+h.id}`, { type: h.type, id: +h.id, lat: la, lon: lo, tags });
  }
  return json({ places: await enrich(hits) });
}

/* ---------------- Google Places (optional) ---------------- */
async function googleNearby(lat, lng, r, key) {
  const mask = ['id', 'displayName', 'formattedAddress', 'shortFormattedAddress', 'location', 'rating', 'userRatingCount', 'priceLevel',
    'internationalPhoneNumber', 'nationalPhoneNumber', 'websiteUri', 'googleMapsUri', 'regularOpeningHours.weekdayDescriptions',
    'currentOpeningHours.openNow', 'photos', 'primaryTypeDisplayName', 'outdoorSeating', 'servesFood', 'accessibilityOptions']
    .map(f => 'places.' + f).join(',');
  const results = [];
  for (const q of ['hookah lounge', 'shisha lounge']) {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mask },
      body: JSON.stringify({ textQuery: q, maxResultCount: 20, locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(r, 50000) } } }),
    });
    if (!res.ok) throw new Error('google ' + res.status + ' ' + (await res.text()).slice(0, 200));
    const data = await res.json();
    results.push(...(data.places || []));
  }
  const seen = new Set();
  return results.filter(p => !seen.has(p.id) && seen.add(p.id)).map(p => ({
    id: 'g:' + p.id,
    name: p.displayName?.text || 'Lounge',
    lat: p.location?.latitude, lng: p.location?.longitude,
    address: p.shortFormattedAddress || p.formattedAddress || '',
    city: '',
    phone: p.internationalPhoneNumber || p.nationalPhoneNumber || '',
    website: p.websiteUri || '',
    instagram: '',
    hoursList: p.regularOpeningHours?.weekdayDescriptions || [],
    openNow: p.currentOpeningHours?.openNow ?? null,
    rating: p.rating ?? null, ratings: p.userRatingCount ?? 0,
    price: ({ PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' })[p.priceLevel] || '',
    photo: p.photos?.[0]?.name ? '/api/photo?name=' + encodeURIComponent(p.photos[0].name) : '',
    photoCredit: p.photos?.[0]?.authorAttributions?.[0]?.displayName || '',
    outdoor: !!p.outdoorSeating, food: !!p.servesFood,
    wheelchair: p.accessibilityOptions?.wheelchairAccessibleEntrance ? 'yes' : '',
    kind: p.primaryTypeDisplayName?.text || 'Hookah lounge',
    mapsUrl: p.googleMapsUri || '',
  })).filter(p => p.lat != null);
}

async function photo(url, env) {
  const name = url.searchParams.get('name') || '';
  if (!env.GOOGLE_PLACES_KEY || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) return json({ error: 'bad_photo' }, 400);
  const res = await fetch(`https://places.googleapis.com/v1/${name}/media?maxWidthPx=900&key=${env.GOOGLE_PLACES_KEY}`);
  return new Response(res.body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
}

/* ---------------- geocoding (Nominatim) ---------------- */
async function geocode(url, ctx) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 120);
  if (q.length < 2) return json({ results: [] });
  const lang = url.searchParams.get('lang') || 'en';
  const data = await cached(ctx, `geo:${lang}:${q.toLowerCase()}`, 7 * 86400, async () => {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&addressdetails=1&q=${encodeURIComponent(q)}`,
      { headers: { 'user-agent': UA, 'accept-language': lang } });
    if (!res.ok) throw new Error('nominatim ' + res.status);
    const rows = await res.json();
    return rows.map(r => ({ name: label(r.address) || r.display_name.split(',').slice(0, 2).join(','), detail: r.display_name, lat: +r.lat, lng: +r.lon }));
  });
  return json({ results: data }, 200, { 'cache-control': 'public, max-age=86400' });
}
async function where(url, ctx) {
  const lat = num(url.searchParams.get('lat'), -90, 90), lng = num(url.searchParams.get('lng'), -180, 180);
  if (lat === null || lng === null) return json({ error: 'bad_location' }, 400);
  const lang = url.searchParams.get('lang') || 'en';
  const rl = Math.round(lat * 50) / 50, rg = Math.round(lng * 50) / 50;
  const data = await cached(ctx, `rev:${lang}:${rl}:${rg}`, 30 * 86400, async () => {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1&lat=${rl}&lon=${rg}`,
      { headers: { 'user-agent': UA, 'accept-language': lang } });
    if (!res.ok) throw new Error('nominatim ' + res.status);
    const r = await res.json();
    return { name: label(r.address) || 'Your area', country: r.address?.country_code || '' };
  });
  return json(data, 200, { 'cache-control': 'public, max-age=86400' });
}
function label(a) {
  if (!a) return '';
  const place = a.city || a.town || a.village || a.suburb || a.municipality || a.county || '';
  const region = a.country_code === 'us' ? (a['ISO3166-2-lvl4'] || '').replace('US-', '') : (a.country || '');
  return [place, region].filter(Boolean).join(', ');
}

/* ---------------- requests & claims ---------------- */
async function saveRequest(request, env) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const kind = body.kind === 'claim' ? 'claim' : 'booking';
  const clean = (v, n) => String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
  const rec = {
    kind,
    placeId: clean(body.placeId, 120), placeName: clean(body.placeName, 120), address: clean(body.address, 200),
    email: clean(body.email, 120), name: clean(body.name, 80), phone: clean(body.phone, 40), note: clean(body.note, 500),
    country: request.cf?.country || '', city: request.cf?.city || '', at: new Date().toISOString(),
  };
  if (!rec.placeName) return json({ error: 'missing_place' }, 400);
  if (rec.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rec.email)) return json({ error: 'bad_email' }, 400);
  if (env.LOUNJ_KV) {
    const key = `${kind}:${rec.at}:${crypto.randomUUID().slice(0, 8)}`;
    await env.LOUNJ_KV.put(key, JSON.stringify(rec), { expirationTtl: 60 * 60 * 24 * 365 });
    return json({ ok: true, saved: true });
  }
  console.log('lounj request', JSON.stringify(rec));
  return json({ ok: true, saved: false });
}
async function listRequests(url, env) {
  if (!env.ADMIN_TOKEN || url.searchParams.get('token') !== env.ADMIN_TOKEN) return json({ error: 'forbidden' }, 403);
  if (!env.LOUNJ_KV) return json({ error: 'no_kv' }, 501);
  const list = await env.LOUNJ_KV.list({ limit: 500 });
  const rows = await Promise.all(list.keys.map(k => env.LOUNJ_KV.get(k.name, 'json')));
  return json({ count: rows.length, requests: rows.filter(Boolean).sort((a, b) => b.at.localeCompare(a.at)) });
}

/* ---------------- guest confirmations: "does this place have hookah?" ---------------- */
const ID_RE = /^osm:(node|way|relation)\/\d+$|^g:[\w-]+$/;
async function confirm(request, env) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (!env.LOUNJ_KV) return json({ ok: true, saved: false });
  let b; try { b = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  if (!ID_RE.test(String(b.id || ''))) return json({ error: 'bad_id' }, 400);
  const key = 'hk:' + b.id;
  const cur = (await env.LOUNJ_KV.get(key, 'json')) || { y: 0, n: 0 };
  if (b.yes === true) cur.y++; else if (b.yes === false) cur.n++; else return json({ error: 'bad_vote' }, 400);
  cur.name = String(b.name || cur.name || '').slice(0, 120);
  cur.at = new Date().toISOString();
  await env.LOUNJ_KV.put(key, JSON.stringify(cur));
  return json({ ok: true, y: cur.y, n: cur.n });
}
async function confirms(url, env) {
  const ids = (url.searchParams.get('ids') || '').split(',').filter(i => ID_RE.test(i)).slice(0, 80);
  if (!env.LOUNJ_KV || !ids.length) return json({ votes: {} });
  const rows = await Promise.all(ids.map(i => env.LOUNJ_KV.get('hk:' + i, 'json')));
  const votes = {};
  ids.forEach((i, k) => { if (rows[k]) votes[i] = { y: rows[k].y, n: rows[k].n }; });
  return json({ votes }, 200, { 'cache-control': 'public, max-age=60' });
}
