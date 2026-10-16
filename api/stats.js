// GET /api/stats?days=7|30: totals for the dashboard. Needs the x-dashboard-key
// header to match the DASHBOARD_PASSWORD environment variable set in Vercel.

const crypto = require('crypto');
const { configured, pipeline, hash, day } = require('./_redis');

function allowed(given) {
  // Stray spaces or a newline from copy-paste don't count.
  const want = (process.env.DASHBOARD_PASSWORD || '').trim();
  given = String(given || '').trim();
  if (!want || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.DASHBOARD_PASSWORD) return res.status(503).json({ error: 'Set DASHBOARD_PASSWORD in the Vercel project settings.' });
  if (!allowed(req.headers['x-dashboard-key'])) return res.status(401).json({ error: 'Wrong password' });
  if (!configured()) return res.status(503).json({ error: 'Connect an Upstash Redis database to the Vercel project.' });

  const n = Math.max(1, Math.min(90, Number(req.query.days) || 30));
  const now = Date.now();
  const days = Array.from({ length: n }, (_, i) => day(now - (n - 1 - i) * 86400000));

  const cmds = [
    ['MGET', ...days.map((d) => `rc:pv:${d}`)],
    ['MGET', ...days.map((d) => `rc:play:${d}`)],
    ['MGET', ...days.map((d) => `rc:sec:${d}`)],
    ...days.map((d) => ['PFCOUNT', `rc:v:${d}`]),
    ...days.map((d) => ['PFCOUNT', `rc:pu:${d}`]),
    ['PFCOUNT', 'rc:vall'],
    ['PFCOUNT', ...days.map((d) => `rc:v:${d}`)], // unique visitors across the whole range
    ['HGETALL', 'rc:tot'],
    ...['src', 'dev', 'os', 'geo', 'app', 'orient', 'tricks', 'events', 'tasks'].map((k) => ['HGETALL', `rc:${k}`]),
    ['ZREVRANGE', 'rc:top', 0, 19, 'WITHSCORES'],
    ['ZCOUNT', 'rc:live', now - 2 * 60 * 1000, '+inf'],
  ];
  try {
    const r = await pipeline(cmds);
    let i = 0;
    const pv = r[i++] || [], plays = r[i++] || [], sec = r[i++] || [];
    const visitors = days.map(() => Number(r[i++]) || 0);
    const players = days.map(() => Number(r[i++]) || 0);
    const allVisitors = Number(r[i++]) || 0;
    const rangeVisitors = Number(r[i++]) || 0;
    const tot = hash(r[i++]);
    const dims = {};
    for (const k of ['sources', 'devices', 'os', 'countries', 'apps', 'orientation', 'tricks', 'events', 'tasks']) dims[k] = hash(r[i++]);
    const topFlat = r[i++] || [];
    const top = [];
    for (let j = 0; j + 1 < topFlat.length; j += 2) {
      const [, dev, country, date] = String(topFlat[j]).split('|');
      top.push({ score: Number(topFlat[j + 1]) || 0, device: dev, country, date });
    }
    const live = Number(r[i++]) || 0;
    res.status(200).json({
      generated: now,
      live,
      range: { days: n, visitors: rangeVisitors },
      daily: days.map((d, k) => ({
        date: d, visitors: visitors[k], players: players[k],
        pageviews: Number(pv[k]) || 0, plays: Number(plays[k]) || 0, minutes: Math.round((Number(sec[k]) || 0) / 60),
      })),
      totals: { visitors: allVisitors, pageviews: tot.pv || 0, plays: tot.plays || 0, minutes: Math.round((tot.sec || 0) / 60) },
      ...dims,
      top,
    });
  } catch (err) {
    res.status(502).json({ error: 'Database error' });
  }
};
