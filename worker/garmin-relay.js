// Dragon Training relay (Cloudflare Worker) — Garmin and Strava
//
// Garmin: passes the app's requests through to Garmin's Personal API and adds
// the headers a browser needs. Your Garmin key travels with each request from
// your own browser and is never saved here.
//
// Strava: holds your Strava app's Client Secret (as a Cloudflare secret) so it
// never sits in the web page, swaps sign-in codes for tokens, and passes
// activity requests through to Strava. Strava tokens are kept in your browser,
// not here.
//
// Deploy: Cloudflare dashboard → Workers & Pages → your "dragon-relay" worker →
// Edit code → replace everything with this file → Deploy.
// Strava keys: worker → Settings → Variables and Secrets → Add:
//   STRAVA_CLIENT_ID      (type Text)   your Strava app's Client ID
//   STRAVA_CLIENT_SECRET  (type Secret) your Strava app's Client Secret

const GARMIN = 'https://personal.connectapi.garmin.com';
const STRAVA = 'https://www.strava.com';

// Only these sites may use the relay. Add more if you host the app elsewhere.
const ALLOWED_ORIGINS = ['https://xca1b3r.github.io'];

// Only the Garmin services the app uses are forwarded.
const GARMIN_PREFIXES = [
  '/personalapitoken-service/',
  '/hrv-service/',
  '/sleep-service/',
  '/usersummary-service/',
  '/wellness-service/',
  '/activitylist-service/',
  '/activity-service/',
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed) return new Response('This relay only serves Dragon Training.', { status: 403, headers: cors });
    if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

    const url = new URL(request.url);
    const path = url.pathname;

    // ---------- Strava ----------
    if (path.startsWith('/strava/')) {
      const id = env && env.STRAVA_CLIENT_ID, secret = env && env.STRAVA_CLIENT_SECRET;

      if (path === '/strava/config') {
        return json({ client_id: id || null });
      }

      if (path === '/strava/token' && request.method === 'POST') {
        if (!id || !secret) return json({ error: 'Strava keys are not set on the relay.' }, 500);
        const body = await request.json().catch(() => ({}));
        const form = new URLSearchParams({ client_id: id, client_secret: secret });
        if (body.code) { form.set('grant_type', 'authorization_code'); form.set('code', body.code); }
        else if (body.refresh_token) { form.set('grant_type', 'refresh_token'); form.set('refresh_token', body.refresh_token); }
        else return json({ error: 'Missing code or refresh_token.' }, 400);
        const r = await fetch(STRAVA + '/oauth/token', { method: 'POST', body: form });
        const out = await r.json().catch(() => ({}));
        return json(out, r.status);
      }

      if (path === '/strava/deauthorize' && request.method === 'POST') {
        const auth = request.headers.get('Authorization') || '';
        const r = await fetch(STRAVA + '/oauth/deauthorize', { method: 'POST', headers: { Authorization: auth } });
        return json({ ok: r.ok }, r.ok ? 200 : r.status);
      }

      if (path.startsWith('/strava/api/v3/') && request.method === 'GET') {
        const headers = new Headers({ Accept: 'application/json' });
        const auth = request.headers.get('Authorization'); if (auth) headers.set('Authorization', auth);
        const r = await fetch(STRAVA + path.replace(/^\/strava/, '') + url.search, { headers });
        const out = new Headers(cors);
        out.set('Content-Type', r.headers.get('Content-Type') || 'application/json');
        out.set('Cache-Control', 'no-store');
        return new Response(r.body, { status: r.status, headers: out });
      }

      return json({ error: 'Not found' }, 404);
    }

    // ---------- Garmin ----------
    if (!GARMIN_PREFIXES.some((p) => path.startsWith(p))) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const headers = new Headers();
    for (const name of ['Authorization', 'Accept', 'Content-Type']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    let body;
    if (request.method === 'POST') {
      const buf = await request.arrayBuffer();
      if (buf.byteLength) body = buf;
    }
    const upstream = await fetch(GARMIN + path + url.search, { method: request.method, headers, body });
    const out = new Headers(cors);
    const type = upstream.headers.get('Content-Type');
    if (type) out.set('Content-Type', type);
    out.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
