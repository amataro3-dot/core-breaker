// みんなで遊ぶ: 名前・部屋を作る/入る・ロビーの画面。
// 部屋のしくみは js/lobby.js、データベースは js/net.js。
// URLに ?fake=1 をつけると、にせもののデータベースで動く(画面のテスト用)。
import { connectFirebase, createFakeStore, fakeDb } from './net.js?v=0.6.2';
import { Room, cleanName } from './lobby.js?v=0.6.2';

const LEVEL_LABEL = { weak: 'よわい', normal: 'ふつう', strong: 'つよい' };

export function initOnline(api) {
  const { $ } = api;
  const fake = /[?&]fake=1/.test(location.search);
  let db = null;
  let room = null;
  let busy = false;
  let lastRound = 0;   // 何試合目まで始めたか
  let inMatch = false; // みんなで遊ぶの試合をしているところか

  // 前に使った名前
  try { $('name').value = localStorage.getItem('cb-name') || ''; } catch (_) { /* なしでよい */ }

  const msg = (id, text, ok = false) => {
    $(id).textContent = text || '';
    $(id).classList.toggle('ok', ok);
  };

  async function getDb() {
    if (db) return db;
    if (fake) {
      window.__cbFakeStore = window.__cbFakeStore || createFakeStore();
      db = fakeDb(window.__cbFakeStore, 'me-' + Math.random().toString(36).slice(2, 8));
    } else {
      db = await connectFirebase();
    }
    return db;
  }

  function readName() {
    const n = cleanName($('name').value);
    if (!n) { msg('online-msg', '名前を入れてね'); return null; }
    try { localStorage.setItem('cb-name', n); } catch (_) { /* 保存できなくてもよい */ }
    return n;
  }

  async function enter(how) {
    if (busy) return;
    const name = readName();
    if (!name) return;
    busy = true;
    msg('online-msg', 'つないでいます…', true);
    try {
      const d = await getDb();
      room = new Room(d);
      room.onChange = renderLobby;
      room.onClosed = () => {
        room = null;
        if (!inMatch) { api.showScreen('online'); msg('online-msg', '部屋から出ました'); }
      };
      const res = how === 'create'
        ? await room.create(name, 4, 'normal')
        : await room.join($('code').value, name);
      if (!res.ok) {
        room = null;
        msg('online-msg', res.error || 'うまくいきませんでした');
      } else {
        msg('online-msg', '');
        msg('lobby-msg', '');
        lastRound = (room.data && room.data.round) || 0;
        api.setMode('online');
        api.showScreen('lobby');
        renderLobby();
      }
    } catch (e) {
      console.error(e);
      room = null;
      msg('online-msg', 'つながりませんでした。電波のよい所で、もう一度ためしてね');
    }
    busy = false;
  }

  // ---- ロビーの表示 ----
  function slotHtml(p, room) {
    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const tags = (p.id === room.data.host ? '<span class="tag">ホスト</span>' : '') +
      (p.id === room.uid ? '<span class="tag you">YOU</span>' : '');
    const canMove = room.isHost && p.id !== room.uid;
    return `<button type="button" class="slot${p.id === room.uid ? ' me' : ''}" data-pid="${p.id}"${canMove ? '' : ' disabled'}>` +
      `<span class="nm">${esc(p.name)}</span>${tags}${canMove ? '<span class="mv">⇄</span>' : ''}</button>`;
  }

  function renderLobby() {
    if (!room || !room.data) return;
    const r = room;
    $('lobby-code').textContent = r.code;
    for (const team of ['cyan', 'pink']) {
      const list = r.team(team);
      let html = list.map((p) => slotHtml(p, r)).join('');
      for (let i = list.length; i < r.size; i++) html += '<div class="slot ai"><span class="nm">AI</span></div>';
      $(`team-${team}`).innerHTML = html;
    }
    const me = r.me;
    $('to-cyan').disabled = !me || me.team === 'cyan' || r.team('cyan').length >= r.size;
    $('to-pink').disabled = !me || me.team === 'pink' || r.team('pink').length >= r.size;

    // ホストだけが人数・強さを選べる
    $('lobby-host').style.display = r.isHost ? '' : 'none';
    for (const b of document.querySelectorAll('[data-lsize]')) b.classList.toggle('on', Number(b.dataset.lsize) === r.size);
    for (const b of document.querySelectorAll('[data-llevel]')) b.classList.toggle('on', b.dataset.llevel === r.level);
    $('lobby-info').textContent = `${r.size}対${r.size} ・ AIの強さ: ${LEVEL_LABEL[r.level]}`;
    $('lobby-hint').textContent = r.isHost
      ? 'ほかの人の名前を押すと、反対のチームに移せます。空いた枠はAIが入ります'
      : '空いた枠はAIが入ります';

    const playing = r.state === 'playing';
    $('lobby-start').style.display = r.isHost ? '' : 'none';
    $('lobby-start').disabled = playing;
    $('lobby-wait').style.display = r.isHost ? 'none' : '';
    $('lobby-wait').textContent = playing
      ? '試合中です。ホストがロビーにもどるのを待っています…'
      : 'ホストが始めるのを待っています…';

    // ホストがスタートしたら、みんな試合へ
    const round = r.data.round || 0;
    if (playing && round > lastRound && !inMatch) {
      lastRound = round;
      inMatch = true;
      api.startMatch({ size: r.size, level: r.level, team: me ? me.team : 'cyan' });
    }
  }

  async function act(p) {
    const res = await p;
    if (res && res.error) msg('lobby-msg', res.error);
    else msg('lobby-msg', '');
  }

  // ---- ボタン ----
  $('go-online').addEventListener('click', () => {
    api.setMode('online');
    msg('online-msg', '');
    api.showScreen(room ? 'lobby' : 'online');
  });
  $('online-back').addEventListener('click', () => api.showScreen('title'));
  $('create').addEventListener('click', () => enter('create'));
  $('join').addEventListener('click', () => enter('join'));
  $('code').addEventListener('input', () => { $('code').value = $('code').value.replace(/[^0-9]/g, '').slice(0, 4); });
  $('to-cyan').addEventListener('click', () => room && act(room.setTeam(room.uid, 'cyan')));
  $('to-pink').addEventListener('click', () => room && act(room.setTeam(room.uid, 'pink')));
  for (const id of ['team-cyan', 'team-pink']) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('[data-pid]');
      if (!b || !room || !room.isHost || b.dataset.pid === room.uid) return;
      const p = room.players.find((q) => q.id === b.dataset.pid);
      if (p) act(room.setTeam(p.id, p.team === 'cyan' ? 'pink' : 'cyan'));
    });
  }
  for (const b of document.querySelectorAll('[data-lsize]')) {
    b.addEventListener('click', () => room && act(room.setSize(Number(b.dataset.lsize))));
  }
  for (const b of document.querySelectorAll('[data-llevel]')) {
    b.addEventListener('click', () => room && act(room.setLevel(b.dataset.llevel)));
  }
  $('lobby-start').addEventListener('click', () => room && act(room.start()));
  $('lobby-leave').addEventListener('click', async () => {
    if (!room) return;
    const r = room;
    room = null;
    await r.leave();
    api.showScreen('online');
    msg('online-msg', '部屋を出ました', true);
  });

  // 結果画面から
  $('to-lobby').addEventListener('click', async () => {
    inMatch = false;
    api.stopMatch();
    if (!room) { api.showScreen('online'); msg('online-msg', '部屋がなくなりました'); return; }
    if (room.isHost && room.state === 'playing') await room.backToLobby();
    api.showScreen('lobby');
    renderLobby();
  });
  $('to-title').addEventListener('click', async () => {
    inMatch = false;
    api.stopMatch();
    if (room) { const r = room; room = null; await r.leave(); }
    api.showScreen('title');
  });

  return {
    get room() { return room; },
    get db() { return db; },
  };
}
