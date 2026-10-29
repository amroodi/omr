/*
 * Load test for the API — many simultaneous users on the busiest read paths, then a login flood to
 * check the shared rate limits. Run against a LOCAL or STAGING API only, never production:
 *
 *   ORG_USER=admin ORG_PW=… TENANT=damuon API=http://localhost:4200/api/v1 \
 *     node scripts/load-test.js [concurrency=50] [seconds=30]
 *
 * Prints requests/second, latency percentiles and error counts per endpoint.
 */
const API = process.env.API || 'http://localhost:4200/api/v1';
const TENANT = process.env.TENANT || 'damuon';
const CONC = Number(process.argv[2] || 50);
const SECS = Number(process.argv[3] || 30);
const H = { 'content-type': 'application/json', 'x-tenant-slug': TENANT };

async function login() {
  const r = await fetch(`${API}/auth/org/login`, { method: 'POST', headers: H, body: JSON.stringify({ tenantSlug: TENANT, username: process.env.ORG_USER, password: process.env.ORG_PW }) });
  const j = await r.json();
  if (!j.token) throw new Error(`login failed: ${JSON.stringify(j)}`);
  return j.token;
}

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))] : 0);

async function run(name, paths, token) {
  const lat = [];
  let ok = 0, bad = 0, n = 0;
  const codes = {};
  const end = Date.now() + SECS * 1000;
  const auth = { ...H, authorization: `Bearer ${token}` };
  const worker = async () => {
    while (Date.now() < end) {
      const p = paths[n++ % paths.length];
      const t = performance.now();
      try {
        const r = await fetch(API + p, { headers: auth });
        await r.arrayBuffer();
        lat.push(performance.now() - t);
        if (r.ok) ok++; else { bad++; codes[r.status] = (codes[r.status] || 0) + 1; }
      } catch (e) { bad++; codes[e.code || 'net'] = (codes[e.code || 'net'] || 0) + 1; }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));
  lat.sort((a, b) => a - b);
  console.log(`${name.padEnd(22)} ${(ok + bad) / SECS | 0} req/s  ok=${ok} err=${bad} ${Object.keys(codes).length ? JSON.stringify(codes) : ''}  p50=${pct(lat, 50) | 0}ms p95=${pct(lat, 95) | 0}ms p99=${pct(lat, 99) | 0}ms`);
}

(async () => {
  console.log(`API ${API} — ${CONC} concurrent users, ${SECS}s per scenario`);
  const token = await login();
  const list = await (await fetch(`${API}/claims`, { headers: { ...H, authorization: `Bearer ${token}` } })).json();
  const ids = (Array.isArray(list) ? list : list.items || []).slice(0, 40).map((c) => c.id);
  if (!ids.length) throw new Error('no claims to read');
  await run('health', ['/health'], token);
  await run('work desk', ['/claims/work-desk'], token);
  await run('case + documents', ids.flatMap((id) => [`/claims/${id}`, `/claims/${id}/checklist`]), token);
  await run('case fields', ids.map((id) => `/claims/${id}/fields`), token);

  // Login flood from one IP: the limiter must cap it (20 per 15 min per IP), across all API processes.
  const tries = 60;
  const res = await Promise.all(Array.from({ length: tries }, () =>
    fetch(`${API}/auth/org/login`, { method: 'POST', headers: H, body: JSON.stringify({ tenantSlug: TENANT, username: 'nobody-load-test', password: 'wrong-password' }) }).then((r) => r.status)));
  const by = res.reduce((m, s) => ((m[s] = (m[s] || 0) + 1), m), {});
  console.log(`login flood x${tries}       statuses ${JSON.stringify(by)}  (429 = refused by the rate limit)`);
})().catch((e) => { console.error(e); process.exit(1); });
