// Keyed async mutex: serialises work per key (e.g. per combat id).
export class KeyedMutex {
  constructor() { this.tails = new Map(); }
  async run(key, fn) {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release; const p = new Promise(r => (release = r));
    const tail = prev.then(() => p); this.tails.set(key, tail);
    await prev;
    try { return await fn(); } finally { release(); if (this.tails.get(key) === tail) this.tails.delete(key); }
  }
}
