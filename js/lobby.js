// 部屋(ロビー)のしくみ。画面とは別にして、テストしやすくしている。
// データの形:
// rooms/1234: {
//   createdAt, host: ホストのID, state: 'lobby' | 'playing', size: 1|2|4, level: 'weak'|'normal'|'strong',
//   round: 何試合目か, startAt,
//   players: { ID: { name, team: 'cyan'|'pink', joinedAt } }
// }

export const SIZES = [1, 2, 4];
export const LEVELS = ['weak', 'normal', 'strong'];
export const NAME_MAX = 10;

export function cleanName(name) {
  return String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, NAME_MAX);
}

export class Room {
  // db: net.js の connectFirebase() か fakeDb() が返すもの
  constructor(db) {
    this.db = db;
    this.uid = db.uid;
    this.code = null;
    this.data = null;
    this.off = null;
    this.onChange = () => {};  // 部屋の中身が変わったとき
    this.onClosed = () => {};  // 部屋がなくなった・追い出されたとき
  }

  // ---- 見やすい形にする ----
  get players() {
    const ps = (this.data && this.data.players) || {};
    return Object.entries(ps)
      .map(([id, p]) => ({ id, name: p.name, team: p.team, joinedAt: p.joinedAt || 0 }))
      .sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
  }
  team(t) { return this.players.filter((p) => p.team === t); }
  get me() { return this.players.find((p) => p.id === this.uid) || null; }
  get isHost() { return !!this.data && this.data.host === this.uid; }
  get size() { return (this.data && this.data.size) || 4; }
  get level() { return (this.data && this.data.level) || 'normal'; }
  get state() { return (this.data && this.data.state) || 'lobby'; }

  // ---- 部屋を作る ----
  async create(name, size = 4, level = 'normal') {
    name = cleanName(name);
    for (let i = 0; i < 30; i++) {
      const code = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
      const v = await this.db.get(`rooms/${code}`);
      // 使われていない番号(または、だれもいなくなった部屋)なら使う
      if (v && v.players) continue;
      const now = this.db.now();
      await this.db.set(`rooms/${code}`, {
        createdAt: now, host: this.uid, state: 'lobby', size, level, round: 0,
        players: { [this.uid]: { name, team: 'cyan', joinedAt: now } },
      });
      await this.attach(code);
      return { ok: true, code };
    }
    return { ok: false, error: '部屋を作れませんでした。もう一度ためしてね' };
  }

  // ---- 部屋に入る ----
  async join(code, name) {
    name = cleanName(name);
    code = String(code || '').trim();
    if (!/^[0-9]{4}$/.test(code)) return { ok: false, error: '4けたの数字を入れてね' };
    const v = await this.db.get(`rooms/${code}`);
    if (!v || !v.players) return { ok: false, error: 'その部屋は見つかりません' };
    const ps = Object.values(v.players);
    const size = v.size || 4;
    if (v.players[this.uid]) { await this.attach(code); return { ok: true, code }; }
    if (v.state === 'playing') return { ok: false, error: 'いま試合中なので入れません。終わるまで待ってね' };
    if (ps.length >= size * 2) return { ok: false, error: '部屋が満員です' };
    // 人が少ないチームに入る(同じならシアン)
    const c = ps.filter((p) => p.team === 'cyan').length;
    const k = ps.filter((p) => p.team === 'pink').length;
    const team = c <= k && c < size ? 'cyan' : 'pink';
    await this.db.set(`rooms/${code}/players/${this.uid}`, { name, team, joinedAt: this.db.now() });
    await this.attach(code);
    return { ok: true, code };
  }

  async attach(code) {
    this.code = code;
    // 回線が切れたら、自分を部屋から消す(Firebaseのサーバーがやってくれる)
    await this.db.onDisconnectRemove(`rooms/${code}/players/${this.uid}`);
    let seen = false;
    this.off = this.db.onValue(`rooms/${code}`, (v) => {
      this.data = v;
      if (!v || !v.players || !v.players[this.uid]) {
        // 部屋が消えた・自分がいなくなった
        if (seen) this.close();
        return;
      }
      seen = true;
      this.fixHost();
      this.onChange(this);
    });
  }

  // ホストがいなくなったら、いちばん先に入った人が新しいホストになる
  fixHost() {
    const ps = this.players;
    if (!ps.length) return;
    if (this.data.players[this.data.host]) return;
    if (ps[0].id === this.uid) this.db.update(`rooms/${this.code}`, { host: this.uid });
  }

  close() {
    if (this.off) { this.off(); this.off = null; }
    const was = this.code;
    this.code = null;
    this.data = null;
    if (was) this.onClosed();
  }

  // ---- 部屋を出る ----
  async leave() {
    const code = this.code;
    if (!code) return;
    const ps = this.players;
    const wasHost = this.isHost;
    if (this.off) { this.off(); this.off = null; }
    this.code = null;
    this.data = null;
    if (this.db.cancelOnDisconnect) await this.db.cancelOnDisconnect(`rooms/${code}/players/${this.uid}`);
    if (ps.length <= 1) {
      await this.db.remove(`rooms/${code}`); // 最後の人が出たら、部屋ごと消す
    } else {
      const rest = ps.filter((p) => p.id !== this.uid);
      const upd = { [`players/${this.uid}`]: null };
      // ホストが出るときは、次に入った人をホストにする
      if (wasHost) upd.host = rest[0].id;
      await this.db.update(`rooms/${code}`, upd);
    }
  }

  // ---- チームを移る ----
  // 自分は自由に、ホストはほかの人も移せる。満員なら移れない
  async setTeam(pid, team) {
    if (!this.code || !this.data) return { ok: false };
    if (pid !== this.uid && !this.isHost) return { ok: false, error: 'ホストだけが、ほかの人を移せます' };
    const p = this.players.find((q) => q.id === pid);
    if (!p || p.team === team) return { ok: false };
    if (this.team(team).length >= this.size) return { ok: false, error: 'そのチームは満員です' };
    await this.db.update(`rooms/${this.code}/players/${pid}`, { team });
    return { ok: true };
  }

  // ---- ホストだけ: 人数・強さ ----
  async setSize(size) {
    if (!this.isHost || !SIZES.includes(size)) return { ok: false };
    if (this.team('cyan').length > size || this.team('pink').length > size) {
      return { ok: false, error: '人が多すぎて、その人数にはできません' };
    }
    await this.db.update(`rooms/${this.code}`, { size });
    return { ok: true };
  }

  async setLevel(level) {
    if (!this.isHost || !LEVELS.includes(level)) return { ok: false };
    await this.db.update(`rooms/${this.code}`, { level });
    return { ok: true };
  }

  // ---- ホストだけ: スタート・ロビーにもどす ----
  async start() {
    if (!this.isHost || this.state !== 'lobby') return { ok: false };
    await this.db.update(`rooms/${this.code}`, {
      state: 'playing', startAt: this.db.now(), round: ((this.data && this.data.round) || 0) + 1,
    });
    return { ok: true };
  }

  async backToLobby() {
    if (!this.isHost || this.state !== 'playing') return { ok: false };
    await this.db.update(`rooms/${this.code}`, { state: 'lobby' });
    return { ok: true };
  }
}
