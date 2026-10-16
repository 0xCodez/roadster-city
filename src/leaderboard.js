// Shared leaderboard (api/leaderboard.js). A random player id is kept in this
// browser instead of an account; the nickname is optional. The best total score
// is sent at most every 15 s while it grows, and once more when the page closes.

const API = '/api/leaderboard';
const SEND_EVERY = 15000;

function playerId() {
  try {
    let id = localStorage.getItem('rr-pid');
    if (!/^[a-z0-9]{12,24}$/i.test(id || '')) {
      const a = new Uint8Array(12);
      crypto.getRandomValues(a);
      id = [...a].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
      localStorage.setItem('rr-pid', id);
    }
    return id;
  } catch {
    return null; // storage blocked: no leaderboard
  }
}

const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);

export function createLeaderboard({ onUpdate } = {}) {
  const pid = playerId();
  let name = '';
  try { name = localStorage.getItem('rr-name') || ''; } catch {}
  let sent = -1, sentAt = 0, data = null, busy = false;

  async function call(method, body) {
    if (!pid || busy) return;
    busy = true;
    try {
      const res = await fetch(method === 'GET' ? `${API}?pid=${pid}` : API, {
        method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) { data = await res.json(); onUpdate?.(data); }
    } catch {} finally { busy = false; }
  }

  return {
    get name() { return name; },
    get data() { return data; },
    get enabled() { return Boolean(pid); },
    setName(n, score) {
      const clean = cleanName(n);
      if (clean === name) return;
      name = clean;
      try { localStorage.setItem('rr-name', name); } catch {}
      sentAt = 0;
      this.submit(score, true);
    },
    refresh() { return call('GET'); },
    // Call often; it only sends when the score went up and enough time passed.
    submit(score, force = false) {
      const now = Date.now();
      if (busy || !pid) return; // try again on the next call
      if (!force && (score <= sent || now - sentAt < SEND_EVERY)) return;
      sent = Math.max(sent, score);
      sentAt = now;
      call('POST', { pid, name, score });
    },
    // Last chance when the page is closing.
    flush(score) {
      if (!pid || score <= sent || !navigator.sendBeacon) return;
      sent = score;
      navigator.sendBeacon(API, new Blob([JSON.stringify({ pid, name, score })], { type: 'text/plain' }));
    },
  };
}

// The ranking tab in the pause menu.
export function renderBoard(el, data, { name, onName }) {
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  if (!data) {
    el.innerHTML = '<div class="board-empty">Loading the leaderboard…</div>';
    return;
  }
  const me = data.me;
  const you = me && me.rank
    ? `<div class="you">YOU <b>#${fmt(me.rank)}</b> <span>of ${fmt(data.players)} · ${fmt(me.score)}</span></div>`
    : `<div class="you"><span>Score some points to get on the board · ${fmt(data.players)} players</span></div>`;
  const row = (t) => `<li class="${t.me ? 'me' : ''}${t.rank <= 3 ? ' podium p' + t.rank : ''}"><span class="r">${t.rank}</span><span class="n">${esc(t.name)}${t.me ? ' <em>you</em>' : ''}</span><span class="s">${fmt(t.score)}</span></li>`;
  let rows = data.top.map(row).join('');
  if (me && me.rank && me.rank > data.top.length) {
    rows += `<li class="gap">…</li>` + row({ rank: me.rank, name: me.name || name || 'You', score: me.score, me: true });
  }
  el.innerHTML = `
    <div class="board-head">${you}
      <form class="nick"><input maxlength="16" placeholder="Your nickname" value="${esc(name)}" aria-label="Nickname" /><button type="submit">SAVE</button></form>
    </div>
    <ol class="board">${rows || '<li class="board-empty">No scores yet. Be the first!</li>'}</ol>`;
  el.querySelector('form.nick').addEventListener('submit', (e) => {
    e.preventDefault();
    onName(e.target.querySelector('input').value);
  });
}
