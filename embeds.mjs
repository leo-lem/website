// The data behind the home page's embeds, fetched at build time so the page loads nothing from these services.
// Each fetch may fail (no network, a changed API): then its card falls back to a plain link and the build goes on.
import fs from 'node:fs';
import path from 'node:path';

const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { 'user-agent': 'leolem.dev build', ...headers }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

// Apple's public lookup: the artist's releases, newest first. The artwork is copied into the site.
export async function music({ artist }, assetDir) {
  const data = await (await get(`https://itunes.apple.com/lookup?id=${artist}&entity=album&sort=recent&limit=20`)).json();
  const releases = data.results.filter((r) => r.wrapperType === 'collection').sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const r = releases[0];
  if (!r) throw new Error('no releases for artist ' + artist);
  const art = await (await get(r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'))).arrayBuffer();
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'music.jpg'), Buffer.from(art));
  const kind = / - EP$/.test(r.collectionName) ? 'EP' : / - Single$/.test(r.collectionName) ? 'Single' : 'Album';
  return { title: r.collectionName.replace(/ - (EP|Single)$/, ''), artist: r.artistName, kind, year: r.releaseDate.slice(0, 4), url: r.collectionViewUrl.replace(/\?.*$/, ''), art: '/assets/embeds/music.jpg' };
}

// Polarsteps has no public API; its web app's own API answers with these headers.
const PS = { 'polarsteps-api-version': '73', referer: 'https://www.polarsteps.com/' };
export async function travel({ polarsteps }) {
  const user = await (await get(`https://api.polarsteps.com/users/byusername/${polarsteps}`, PS)).json();
  const latest = [...(user.trips || [])].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  if (!latest) throw new Error('no trips for ' + polarsteps);
  const trip = await (await get(`https://api.polarsteps.com/trips/${latest.id}`, PS)).json();
  const steps = (trip.steps || []).filter((s) => s.location).sort((a, b) => (a.start_time || 0) - (b.start_time || 0))
    .map((s) => ({ name: s.display_name || s.name, lat: s.location.lat, lon: s.location.lon }));
  const day = (d) => new Date(d).getTime(), days = Math.max(1, Math.round((day(trip.end_date) - day(trip.start_date)) / 864e5));
  return {
    title: trip.name, url: `https://www.polarsteps.com/${polarsteps}/${trip.id}-${trip.slug}`, days, km: Math.round(trip.total_km || 0),
    countries: (trip.visited_countries || []).length, steps, profile: `https://www.polarsteps.com/${polarsteps}`,
    // The tracked route, as Polarsteps' own map draws it: one line per leg (walks, buses, trains, flights).
    paths: (trip.route_segments || []).map((s) => ({ flight: s.transport_mode === 'flight', points: s.route ? decodePolyline(s.route).map(([lat, lon]) => ({ lat, lon })) : [] })).filter((p) => p.points.length > 1),
  };
}

// Strava: the newest public run. Needs STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET and STRAVA_REFRESH_TOKEN (secrets in
// CI, site/.env locally); without them the card stays a stand-in.
function decodePolyline(str) {
  const pts = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}
const clock = (s) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`; };
export async function run() {
  const { STRAVA_CLIENT_ID: id, STRAVA_CLIENT_SECRET: secret, STRAVA_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) return null;
  const tok = await (await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10000) })).json();
  if (!tok.access_token) throw new Error('no access token: ' + (tok.message || JSON.stringify(tok).slice(0, 120)));
  if (tok.refresh_token && tok.refresh_token !== refresh) console.warn('embeds: Strava issued a new refresh token; update STRAVA_REFRESH_TOKEN');
  const list = await (await get('https://www.strava.com/api/v3/athlete/activities?per_page=30', { authorization: `Bearer ${tok.access_token}` })).json();
  const a = list.find((x) => /Run$/.test(x.sport_type || x.type) && x.visibility !== 'only_me' && !x.private && x.map?.summary_polyline);
  if (!a) throw new Error('no public run among the latest 30 activities');
  const k = a.distance / 1000, route = decodePolyline(a.map.summary_polyline).map(([lat, lon]) => ({ lat, lon }));
  return {
    date: new Date(a.start_date_local).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    km: k.toFixed(1), time: clock(a.moving_time), pace: `${clock(a.moving_time / k)} /km`, up: Math.round(a.total_elevation_gain || 0),
    url: `https://www.strava.com/activities/${a.id}`,
    route,
  };
}

export async function fetchEmbeds(config, assetDir) {
  const out = {};
  for (const [key, fn] of [['music', music], ['travel', travel], ['run', run]]) {
    if (key !== 'run' && !config[key]) continue;
    try { out[key] = await fn(config[key], assetDir); } catch (e) { console.warn(`embeds: ${key} unavailable, showing a plain link (${e.message})`); out[key] = null; }
  }
  return out;
}
