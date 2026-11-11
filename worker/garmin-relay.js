// Dragon Training: Garmin relay (Cloudflare Worker)
//
// Garmin's Personal API does not let web pages call it directly. This worker
// passes the app's requests through to Garmin and adds the headers a browser
// needs. It stores nothing: your API key travels with each request from your
// own browser and is never saved here.
//
// Deploy: Cloudflare dashboard → Workers & Pages → Create → Create Worker →
// name it "dragon-relay" → Deploy → Edit code → replace everything with this
// file → Deploy. Paste the worker's address into Dragon Training → Settings →
// Garmin Connect → Relay address.

const UPSTREAM = 'https://personal.connectapi.garmin.com';

// Only these sites may use the relay. Add more if you host the app elsewhere.
const ALLOWED_ORIGINS = ['https://xca1b3r.github.io'];

// Only the Garmin services the app uses are forwarded.
const ALLOWED_PREFIXES = [
  '/personalapitoken-service/',
  '/hrv-service/',
  '/sleep-service/',
  '/usersummary-service/',
  '/wellness-service/',
  '/activitylist-service/',
  '/activity-service/',
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Accept, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed) return new Response('This relay only serves Dragon Training.', { status: 403, headers: cors });

    const url = new URL(request.url);
    if (!ALLOWED_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return new Response('Not found', { status: 404, headers: cors });
    }
    if (request.method !== 'GET' && request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
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

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers,
      body,
    });

    const out = new Headers(cors);
    const type = upstream.headers.get('Content-Type');
    if (type) out.set('Content-Type', type);
    out.set('Cache-Control', 'no-store');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  },
};
