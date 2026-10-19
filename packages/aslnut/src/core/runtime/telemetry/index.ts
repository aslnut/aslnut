// core › runtime › telemetry › remote-log: what happens on a phone reaches your machine. Events go as JSON lines,
// batched (one request every `every` ms at most, and when the page is hidden), to an endpoint that takes them. Level
// 'warn' sends errors, the governor's steps and frames over 100 ms; 'info' adds a heartbeat a second (frame times,
// draws, tiles, pixel ratio, memory, what the governor dropped) and your own events (`w.log(ev, data)`).
//   world(canvas, { log: '/api/log' }) · world(canvas, { log: { url, level: 'info', fields: { page: 'city' } } })

export interface RemoteLogOptions {
  /** where the lines go (POST, one JSON object per line) */
  url: string;
  /** 'warn' (default): errors, budget steps, long frames · 'info': and a heartbeat a second, and your events */
  level?: 'warn' | 'info';
  /** fields on every line (a page name, a build), or a function giving them */
  fields?: Record<string, unknown> | (() => Record<string, unknown>);
  /** ms between requests at most (default 2000) */
  every?: number;
  /** your own sender (default fetch with keepalive) */
  send?: (url: string, body: string) => void;
}

export class RemoteLog {
  readonly level: 'warn' | 'info';
  private o: RemoteLogOptions; private q: string[] = []; private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private sid = Math.random().toString(36).slice(2, 8); private off: (() => void) | null = null;
  constructor(o: RemoteLogOptions) {
    this.o = o; this.level = o.level ?? 'warn';
    if (typeof addEventListener === 'function') { const f = () => this.flush(); addEventListener('pagehide', f); this.off = () => removeEventListener('pagehide', f); }
  }
  /** one event (an 'info' one is dropped at level 'warn') */
  send(ev: string, data: Record<string, unknown> = {}, level: 'warn' | 'info' = 'info'): void {
    if (level === 'info' && this.level === 'warn') return;
    const f = typeof this.o.fields === 'function' ? this.o.fields() : this.o.fields;
    this.q.push(JSON.stringify({ sid: this.sid, t: Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now()), ...f, ev, ...data }));
    if (this.q.length > 400) this.q.splice(0, this.q.length - 400);
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.o.every ?? 2000);
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = 0;
    if (!this.q.length) return;
    const body = this.q.splice(0).join('\n');
    try {
      if (this.o.send) this.o.send(this.o.url, body);
      else if (typeof fetch === 'function') void fetch(this.o.url, { method: 'POST', body, keepalive: body.length < 60000 }).catch(() => {});
    } catch { /* telemetry never breaks the page */ }
  }
  dispose(): void { this.flush(); this.off?.(); this.off = null; }
}
