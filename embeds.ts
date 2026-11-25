import fs from 'node:fs';
import path from 'node:path';

export type LatLon = { lat: number; lon: number };
export type Leg = { flight?: boolean; points: LatLon[] };
export type Music = Awaited<ReturnType<typeof music>>;
export type Travel = Awaited<ReturnType<typeof travel>>;
export type Run = NonNullable<Awaited<ReturnType<typeof run>>>;
export type Embeds = { music?: Music | null; travel?: Travel | null; run?: Run | null };
export type EmbedConfig = { music?: { artist: string | number }; travel?: { polarsteps: string } };

type ItunesRelease = { wrapperType: string; releaseDate: string; artworkUrl100: string; collectionName: string; artistName: string; collectionViewUrl: string };
type Trip = {
  id: number; name: string; slug: string; start_date: string; end_date: string; total_km?: number; visited_countries?: unknown[];
  steps?: { display_name?: string; name: string; start_time?: number; location?: LatLon }[];
  route_segments?: { transport_mode: string; route?: string }[];
};
type Activity = { id: number; type: string; sport_type?: string; visibility?: string; private?: boolean; map?: { summary_polyline?: string }; distance: number; moving_time: number; total_elevation_gain?: number; start_date_local: string };

const get = async (url: string, headers: Record<string, string> = {}) => {
  const res = await fetch(url, { headers: { 'user-agent': 'leolem.dev build', ...headers }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res;
};

export async function music({ artist }: { artist: string | number }, assetDir: string) {
  const data = await (await get(`https://itunes.apple.com/lookup?id=${artist}&entity=album&sort=recent&limit=20`)).json() as { results: ItunesRelease[] };
  const releases = data.results.filter((r) => r.wrapperType === 'collection').sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const r = releases[0];
  if (!r) throw new Error('no releases for artist ' + artist);
  const art = await (await get(r.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'))).arrayBuffer();
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'music.jpg'), Buffer.from(art));
  const kind = / - EP$/.test(r.collectionName) ? 'EP' : / - Single$/.test(r.collectionName) ? 'Single' : 'Album';
  return { title: r.collectionName.replace(/ - (EP|Single)$/, ''), artist: r.artistName, kind, year: r.releaseDate.slice(0, 4), url: r.collectionViewUrl.replace(/\?.*$/, ''), art: '/assets/embeds/music.jpg' };
}

const PS = { 'polarsteps-api-version': '73', referer: 'https://www.polarsteps.com/' };
export async function travel({ polarsteps }: { polarsteps: string }) {
  const user = await (await get(`https://api.polarsteps.com/users/byusername/${polarsteps}`, PS)).json() as { trips?: { id: number; start_date: string }[] };
  const latest = [...(user.trips || [])].sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
  if (!latest) throw new Error('no trips for ' + polarsteps);
  const trip = await (await get(`https://api.polarsteps.com/trips/${latest.id}`, PS)).json() as Trip;
  const steps = (trip.steps || []).filter((s) => s.location).sort((a, b) => (a.start_time || 0) - (b.start_time || 0))
    .map((s) => ({ name: s.display_name || s.name, lat: s.location!.lat, lon: s.location!.lon }));
  const day = (d: string) => new Date(d).getTime(), days = Math.max(1, Math.round((day(trip.end_date) - day(trip.start_date)) / 864e5));
  return {
    title: trip.name, url: `https://www.polarsteps.com/${polarsteps}/${trip.id}-${trip.slug}`, days, km: Math.round(trip.total_km || 0),
    countries: (trip.visited_countries || []).length, steps, profile: `https://www.polarsteps.com/${polarsteps}`,
    paths: (trip.route_segments || []).map((s): Leg => ({ flight: s.transport_mode === 'flight', points: s.route ? decodePolyline(s.route).map(([lat, lon]) => ({ lat, lon })) : [] })).filter((p) => p.points.length > 1),
  };
}

function decodePolyline(str: string) {
  const pts: [number, number][] = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const which of [0, 1]) {
      let b: number, shift = 0, result = 0;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d; else lon += d;
    }
    pts.push([lat / 1e5, lon / 1e5]);
  }
  return pts;
}
const clock = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60); return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`; };
export async function run() {
  const { STRAVA_CLIENT_ID: id, STRAVA_CLIENT_SECRET: secret, STRAVA_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) return null;
  const tok = await (await fetch('https://www.strava.com/oauth/token', { method: 'POST', body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: refresh, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(10000) })).json() as { access_token?: string; refresh_token?: string; message?: string };
  if (!tok.access_token) throw new Error('no access token: ' + (tok.message || JSON.stringify(tok).slice(0, 120)));
  if (tok.refresh_token && tok.refresh_token !== refresh) console.warn('embeds: Strava issued a new refresh token; update STRAVA_REFRESH_TOKEN');
  const list = await (await get('https://www.strava.com/api/v3/athlete/activities?per_page=30', { authorization: `Bearer ${tok.access_token}` })).json() as Activity[];
  const a = list.find((x) => /Run$/.test(x.sport_type || x.type) && x.visibility !== 'only_me' && !x.private && x.map?.summary_polyline);
  if (!a) throw new Error('no public run among the latest 30 activities');
  const k = a.distance / 1000, route = decodePolyline(a.map!.summary_polyline!).map(([lat, lon]) => ({ lat, lon }));
  return {
    date: new Date(a.start_date_local).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
    km: k.toFixed(1), time: clock(a.moving_time), pace: `${clock(a.moving_time / k)} /km`, up: Math.round(a.total_elevation_gain || 0),
    url: `https://www.strava.com/activities/${a.id}`,
    route,
  };
}

export async function fetchEmbeds(config: EmbedConfig, assetDir: string) {
  const out: Embeds = {};
  const settle = async <T>(key: string, got: Promise<T>) => {
    try { return await got; } catch (e) { console.warn(`embeds: ${key} unavailable, showing a plain link (${(e as Error).message})`); return null; }
  };
  if (config.music) out.music = await settle('music', music(config.music, assetDir));
  if (config.travel) out.travel = await settle('travel', travel(config.travel));
  out.run = await settle('run', run());
  return out;
}
