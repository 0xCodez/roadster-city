// /api/leaderboard: the shared leaderboard for all players.
//   GET  ?pid=<id>            -> top 20, your rank and score, number of players
//   POST {pid, name, score}   -> saves your best score (it only ever goes up) and
//                                your nickname, then answers like GET
// A player is a random id kept in their browser: no accounts, nothing personal.

const { configured, pipeline } = require('./_redis');

const LB = 'rc:lb'; // sorted set: player id -> best score
const NAMES = 'rc:lbname'; // hash: player id -> nickname
const MAX_SCORE = 5e6;
const MAX_JUMP = 250000; // most a score can rise in one save, against obvious fakes
const SAVE_EVERY = 5; // seconds between saves per player

const validPid = (p) => typeof p === 'string' && /^[a-z0-9]{12,24}$/i.test(p);

// Letters (any alphabet), digits, spaces and _ . - only; 2-16 characters.
function cleanName(s) {
  const n = String(s || '').normalize('NFKC').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return n.length >= 2 ? n : '';
}

async function board(pid) {
  const cmds = [['ZREVRANGE', LB, 0, 19, 'WITHSCORES'], ['ZCARD', LB]];
  if (pid) cmds.push(['ZREVRANK', LB, pid], ['ZSCORE', LB, pid], ['HGET', NAMES, pid]);
  const r = await pipeline(cmds);
  const flat = r[0] || [];
  const ids = [], scores = [];
  for (let i = 0; i + 1 < flat.length; i += 2) { ids.push(flat[i]); scores.push(Number(flat[i + 1]) || 0); }
  const names = ids.length ? (await pipeline([['HMGET', NAMES, ...ids]]))[0] || [] : [];
  const top = ids.map((id, i) => ({ rank: i + 1, name: names[i] || `Racer ${id.slice(0, 4).toUpperCase()}`, score: scores[i], me: id === pid }));
  const ranked = pid && r[2] !== null && r[2] !== undefined;
  const me = pid ? { rank: ranked ? Number(r[2]) + 1 : null, score: Number(r[3]) || 0, name: r[4] || '' } : null;
  return { top, me, players: Number(r[1]) || 0 };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!configured()) return res.status(503).json({ error: 'Leaderboard not set up' });
  try {
    if (req.method === 'GET') {
      const pid = validPid(req.query.pid) ? req.query.pid : null;
      return res.status(200).json(await board(pid));
    }
    if (req.method !== 'POST') return res.status(405).end();
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
    if (!body || !validPid(body.pid)) return res.status(400).json({ error: 'Bad request' });
    const pid = body.pid;
    const score = Math.max(0, Math.min(MAX_SCORE, Math.round(Number(body.score) || 0)));
    const name = cleanName(body.name);
    const [fresh, prev] = await pipeline([['SET', `rc:lbt:${pid}`, '1', 'NX', 'EX', SAVE_EVERY], ['ZSCORE', LB, pid]]);
    if (fresh === 'OK') {
      const cmds = [];
      const capped = Math.min(score, (Number(prev) || 0) + MAX_JUMP);
      if (capped > 0) cmds.push(['ZADD', LB, 'GT', capped, pid]);
      if (name) cmds.push(['HSET', NAMES, pid, name]);
      if (cmds.length) await pipeline(cmds);
    }
    return res.status(200).json(await board(pid));
  } catch {
    return res.status(502).json({ error: 'Database error' });
  }
};

module.exports.cleanName = cleanName; // for tests
