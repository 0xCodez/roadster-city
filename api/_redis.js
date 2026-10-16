// Tiny Upstash Redis REST client (no npm packages, so the site keeps no build step).
// Vercel's Upstash integration sets KV_REST_API_URL / KV_REST_API_TOKEN
// (older setups: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const configured = () => Boolean(URL_ && TOKEN);

// Run several commands in one round trip. Returns the results in order.
async function pipeline(commands) {
  if (!commands.length) return [];
  const res = await fetch(`${URL_}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`Redis ${res.status}`);
  const out = await res.json();
  return out.map((r) => (r.error ? null : r.result));
}

// Redis HGETALL comes back as a flat [field, value, ...] list.
function hash(flat) {
  const o = {};
  if (Array.isArray(flat)) for (let i = 0; i + 1 < flat.length; i += 2) o[flat[i]] = Number(flat[i + 1]) || 0;
  return o;
}

const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

module.exports = { configured, pipeline, hash, day, secret: () => TOKEN || '' };
