// Anonymous play stats for the dashboard (/dashboard). No cookies, no stored IDs:
// each page load gets a random session id that lives only in memory. Counts are
// batched and sent once a minute, plus once when the page is hidden.
// Nothing is sent from localhost, so testing doesn't skew the numbers.

const ENDPOINT = '/api/track';
const BEAT = 60; // seconds between batches while playing

function sessionId() {
  const a = new Uint8Array(9);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

// "2x KICKFLIP" -> "kickflip", "AIR 2.4 S" -> "air time", "720 SPIN" -> "spin".
function trickKey(name) {
  return String(name).toLowerCase()
    .replace(/^\d+x\s+/, '')
    .replace(/^air .*/, 'air time')
    .replace(/^\d+ spin$/, 'spin')
    .trim();
}

export function createTelemetry() {
  const off = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || new URLSearchParams(location.search).has('notrack');
  const sid = sessionId();
  let sec = 0, sinceBeat = 0, score = 0, playing = false;
  let tricks = {}, events = {}, tasks = [];

  function send(type, data = {}, beacon = false) {
    if (off) return;
    const body = JSON.stringify({ t: type, sid, ...data });
    try {
      if (beacon && navigator.sendBeacon) navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain' }));
      else fetch(ENDPOINT, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
    } catch {}
  }

  function flush(type, beacon) {
    const hasData = sec > 0 || Object.keys(tricks).length || Object.keys(events).length || tasks.length;
    if (!hasData && type !== 'end') return;
    send(type, { sec: Math.round(sec), tricks, events, tasks, score }, beacon);
    sec = 0; sinceBeat = 0; tricks = {}; events = {}; tasks = [];
  }

  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && playing) flush('end', true); });
  addEventListener('pagehide', () => { if (playing) flush('end', true); });

  return {
    visit() { send('visit', { ref: document.referrer.slice(0, 200) }); },
    play() {
      playing = true;
      send('play', { orient: innerHeight > innerWidth ? 'portrait' : 'landscape' });
    },
    trick(name) { const k = trickKey(name); tricks[k] = (tricks[k] || 0) + 1; },
    event(name) { events[name] = (events[name] || 0) + 1; },
    task(id) { tasks.push(id); },
    score(points) { score = Math.max(score, Math.round(points)); },
    // Call every frame with real time; counts only while the game is actually in play.
    tick(dt, active) {
      if (!playing || !active || document.visibilityState !== 'visible') return;
      sec += dt;
      sinceBeat += dt;
      if (sinceBeat >= BEAT) flush('beat');
    },
  };
}
