// POST /api/track: anonymous play events from the game.
// No cookies and nothing personal is stored: unique visitors are counted with a
// daily hash of IP + browser + date + a secret (like Plausible), and the IP itself
// is never written anywhere.

const crypto = require('crypto');
const { configured, pipeline, day, secret } = require('./_redis');

const DAY_TTL = 400 * 24 * 3600; // keep daily keys ~13 months
const LIMIT_PER_DAY = 600; // events per visitor per day; the rest are dropped

// Only these names are counted, so nobody can fill the dashboard with junk.
const TRICKS = ['kickflip', 'double kickflip', 'frontflip', 'backflip', 'spin', 'air time', 'clean landing',
  'perfect landing', 'good landing', 'lineup cleared', 'wall climb', 'rooftop landing', 'drift', 'ring'];
const EVENTS = ['crash', 'hop', 'launch', 'release', 'takeoff', 'refill', 'ring', 'fans', 'bump'];
const TASKS = ['wall', 'wallPerfect', 'kickflip', 'double', 'rings5', 'ringsAll', 'rooftop', 'drift', 'speed',
  'refuel', 'stars5', 'launch', 'flip', 'hang', 'combo'];

function device(ua) {
  if (/iPad|Tablet/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua)) return 'phone';
  return 'desktop';
}
function os(ua) {
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux|CrOS/i.test(ua)) return 'Linux';
  return 'Other';
}
function app(ua) {
  if (/Twitter/i.test(ua)) return 'X app';
  if (/Telegram/i.test(ua)) return 'Telegram app';
  if (/FBAN|FBAV|Instagram/i.test(ua)) return 'Meta app';
  if (/; wv\)/i.test(ua)) return 'Other app';
  return 'Browser';
}
function source(ref, ua) {
  let host = '';
  try { host = new URL(ref).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
  if (/(^|\.)(x\.com|twitter\.com|t\.co)$/.test(host) || (!host && /Twitter/i.test(ua))) return 'X';
  if (/telegram|(^|\.)t\.me$/.test(host) || (!host && /Telegram/i.test(ua))) return 'Telegram';
  if (/(^|\.)google\./.test(host)) return 'Google';
  if (/roadster-city\.vercel\.app$/.test(host)) return 'Direct';
  if (!host) return 'Direct';
  return host.slice(0, 40).replace(/[^a-z0-9.-]/g, '');
}
const clean = (s, max = 24) => String(s || '').toLowerCase().slice(0, max);
const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  if (!configured()) return res.status(204).end(); // database not connected yet: ignore quietly
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  if (!body || typeof body !== 'object' || !/^[a-z0-9]{8,20}$/i.test(body.sid || '')) return res.status(400).end();

  const ua = String(req.headers['user-agent'] || '').slice(0, 300);
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim();
  const d = day();
  const visitor = crypto.createHash('sha256').update(`${ip}|${ua}|${d}|${secret()}`).digest('hex').slice(0, 20);
  const country = /^[A-Z]{2}$/.test(req.headers['x-vercel-ip-country'] || '') ? req.headers['x-vercel-ip-country'] : 'XX';
  const now = Date.now();

  try {
    const [count] = await pipeline([['INCR', `rc:rl:${visitor}:${d}`], ['EXPIRE', `rc:rl:${visitor}:${d}`, 90000]]);
    if (count > LIMIT_PER_DAY) return res.status(204).end();

    const cmds = [];
    const daily = (key) => { cmds.push(['EXPIRE', key, DAY_TTL]); };
    if (body.t === 'visit') {
      cmds.push(['PFADD', `rc:v:${d}`, visitor], ['PFADD', 'rc:vall', visitor], ['INCR', `rc:pv:${d}`], ['HINCRBY', 'rc:tot', 'pv', 1]);
      daily(`rc:v:${d}`); daily(`rc:pv:${d}`);
      cmds.push(['HINCRBY', 'rc:src', source(body.ref, ua), 1], ['HINCRBY', 'rc:dev', device(ua), 1],
        ['HINCRBY', 'rc:os', os(ua), 1], ['HINCRBY', 'rc:geo', country, 1], ['HINCRBY', 'rc:app', app(ua), 1]);
    } else if (body.t === 'play') {
      cmds.push(['INCR', `rc:play:${d}`], ['HINCRBY', 'rc:tot', 'plays', 1], ['PFADD', `rc:pu:${d}`, visitor],
        ['HINCRBY', 'rc:orient', body.orient === 'portrait' ? 'portrait' : 'landscape', 1]);
      daily(`rc:play:${d}`); daily(`rc:pu:${d}`);
    } else if (body.t === 'beat' || body.t === 'end') {
      const sec = num(body.sec, 90);
      if (sec) { cmds.push(['INCRBY', `rc:sec:${d}`, sec], ['HINCRBY', 'rc:tot', 'sec', sec]); daily(`rc:sec:${d}`); }
      for (const [k, v] of Object.entries(body.tricks || {})) if (TRICKS.includes(k)) cmds.push(['HINCRBY', 'rc:tricks', k, num(v, 50)]);
      for (const [k, v] of Object.entries(body.events || {})) if (EVENTS.includes(k)) cmds.push(['HINCRBY', 'rc:events', k, num(v, 50)]);
      for (const id of (Array.isArray(body.tasks) ? body.tasks : []).slice(0, 15)) if (TASKS.includes(id)) cmds.push(['HINCRBY', 'rc:tasks', id, 1]);
      const score = num(body.score, 5e6);
      if (score > 0) {
        // One entry per play session; GT only ever raises it.
        cmds.push(['ZADD', 'rc:top', 'GT', score, `${body.sid}|${device(ua)}|${country}|${d}`], ['ZREMRANGEBYRANK', 'rc:top', 0, -101]);
      }
      if (body.t === 'beat') cmds.push(['ZADD', 'rc:live', now, body.sid]);
      else cmds.push(['ZREM', 'rc:live', body.sid]);
      cmds.push(['ZREMRANGEBYSCORE', 'rc:live', 0, now - 10 * 60 * 1000]);
    } else return res.status(400).end();

    await pipeline(cmds);
    return res.status(204).end();
  } catch {
    return res.status(204).end(); // stats are best-effort; never bother the game
  }
};

module.exports.source = source; // for tests
