// aslnut docs viewer: markdown pages rendered in the browser (no dependency). Nav from nav.json; deep links
// #path or #path~anchor (an anchor is a heading or an API row: the slug of its first cell). Two special blocks:
//   ```hier   → the whole aslnut tree from map.json, collapsible, each node linked to its reference row
//   ```flow   → a flow diagram from the JSON inside the block (boxes, arrows, loops), each box linked
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const slug = (s) => String(s).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const STATUS = ['built', 'partly', 'planned', 'proposed', 'open'];

  function link(h) {
    if (/^(https?:|mailto:)/.test(h)) return h;
    if (h.startsWith('#')) return h;
    const [file, frag] = h.split('#');
    let p = resolve(current, file.replace(/\.md$/, ''));
    if (frag) p += '~' + frag;
    return '#' + p;
  }
  function inline(s) {
    const codes = [];
    s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
    s = esc(s);
    s = s.replace(/\[(built|partly|planned|proposed|open)\]/g, (_, k) => `<span class="s ${k}">${k}</span>`);
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, h) => `<a href="${link(h)}">${t}</a>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<i>$2</i>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
  }
  function resolve(from, rel) {
    if (rel.startsWith('/')) return rel.slice(1);
    const parts = from.split('/'); parts.pop();
    for (const p of rel.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
    return parts.join('/');
  }
  function md(src) {
    const lines = src.replace(/\r/g, '').split('\n'), out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^<!--/.test(l)) { i++; continue; }
      if (/^```/.test(l)) {
        const lang = l.slice(3).trim(), buf = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        if (lang === 'hier') { out.push('<div class="hier" data-hier></div>'); continue; }
        if (lang === 'flow') { out.push(`<div class="flow">${flow(buf.join('\n'))}</div>`); continue; }
        const tree = lang === 'tree' || buf.some((b) => /[├└│]/.test(b));
        out.push(`<pre class="${tree ? 'tree' : ''}"><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      if (/^#{1,4} /.test(l)) {
        const n = l.match(/^#+/)[0].length, t = l.slice(n + 1);
        out.push(`<h${n} id="${slug(t.replace(/`/g, ''))}">${inline(t)}</h${n}>`); i++; continue;
      }
      if (/^\|/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
        const cells = (r) => r.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
        const head = cells(rows[0]), body = rows.slice(2).map(cells);
        const cls = head[0] === '#' ? 'cards' : head.length >= 5 ? 'wide' : '';   // a '#' first column → cards on phones
        out.push(`<table${cls ? ` class="${cls}"` : ''}><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) =>
          `<tr id="${slug(r[0].replace(/`/g, ''))}">${r.map((c, k) => `<td data-h="${esc(head[k] || '')}">${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      if (/^> /.test(l)) { const buf = []; while (i < lines.length && /^> ?/.test(lines[i])) buf.push(lines[i++].replace(/^> ?/, '')); out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue; }
      if (/^\s*([-*]|\d+\.) /.test(l)) {
        const ordered = /^\s*\d+\./.test(l), buf = [];
        while (i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i])) buf.push(lines[i++].replace(/^\s*([-*]|\d+\.) /, ''));
        const tag = ordered ? 'ol' : 'ul';
        out.push(`<${tag}>${buf.map((b) => `<li>${inline(b)}</li>`).join('')}</${tag}>`);
        continue;
      }
      if (!l.trim()) { i++; continue; }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^(#|```|\||> |<!--|\s*([-*]|\d+\.) )/.test(lines[i])) buf.push(lines[i++]);
      out.push(`<p>${inline(buf.join(' '))}</p>`);
    }
    return out.join('\n');
  }

  // ── the flow diagram: { steps: [{ title, text, items, href, via }], loops: [{ title, text, href }] } ──
  function flow(src) {
    let j; try { j = JSON.parse(src); } catch (e) { return `<p class="muted">flow: ${esc(e.message)}</p>`; }
    const box = (b) => `<a class="fbox" href="${link(b.href || '#')}"><b>${esc(b.title)}</b>` +
      (b.text ? `<span>${esc(b.text)}</span>` : '') +
      (b.items ? `<ul>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '') + `</a>`;
    let h = '<div class="fcol">';
    j.steps.forEach((b, k) => {
      h += box(b);
      if (k < j.steps.length - 1) h += `<div class="farrow"><span>${esc(j.steps[k + 1].via || '')}</span></div>`;
    });
    h += '</div>';
    if (j.loops) h += '<div class="floops">' + j.loops.map((l) =>
      `<a class="floop" href="${link(l.href || '#')}"><b>↺ ${esc(l.title)}</b><span>${esc(l.text)}</span></a>`).join('') + '</div>';
    return h;
  }

  // ── the hierarchy: map.json → nested lists, collapsible ──
  async function hier(el) {
    let j; try { j = await (await fetch('map.json', { cache: 'no-store' })).json(); } catch (e) { el.textContent = 'map.json: ' + e.message; return; }
    const count = (n) => (n.c ? n.c.reduce((a, k) => a + (k.c ? count(k) : 1), 0) : 1);
    const node = (n, depth) => {
      const kids = n.c || [], open = depth < 2;
      const name = `<a href="${n.h ? '#' + n.h : '#map'}">${esc(n.n)}${kids.length ? '/' : ''}</a>`;
      const dot = `<i class="dot ${n.s}" title="${n.s}"></i>`;
      if (!kids.length) return `<li class="leaf">${dot}${name}</li>`;
      return `<li class="${open ? 'open' : ''}"><button class="tg" aria-label="expand">${open ? '▾' : '▸'}</button>${dot}${name}` +
        `<span class="cnt">${count(n)}</span><ul>${kids.map((k) => node(k, depth + 1)).join('')}</ul></li>`;
    };
    el.innerHTML = `<div class="hbar"><button data-all="1">expand all</button><button data-all="0">collapse all</button>` +
      `<input type="search" placeholder="find… e.g. anchors"></div>` +
      `<div class="legend">${STATUS.map((s) => `<span><i class="dot ${s}"></i>${s}</span>`).join('')}</div>` +
      `<div class="hscroll"><ul class="hroot">${node(j.tree, 0)}</ul></div>`;
    const setOpen = (li, on) => { li.classList.toggle('open', on); const b = li.querySelector(':scope > .tg'); if (b) b.textContent = on ? '▾' : '▸'; };
    el.addEventListener('click', (e) => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.classList.contains('tg')) setOpen(t.parentElement, !t.parentElement.classList.contains('open'));
      if (t.dataset.all) for (const li of el.querySelectorAll('li:not(.leaf)')) setOpen(li, t.dataset.all === '1');
    });
    el.querySelector('input').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      for (const li of el.querySelectorAll('li')) li.classList.remove('hit');
      if (!q) return;
      for (const li of el.querySelectorAll('li')) {
        const a = li.querySelector(':scope > a');
        if (a && a.textContent.toLowerCase().includes(q)) {
          li.classList.add('hit');
          for (let p = li.parentElement.closest('li'); p; p = p.parentElement.closest('li')) setOpen(p, true);
        }
      }
    });
  }

  let current = 'README', nav = [];
  async function show() {
    const [page, anchor] = (decodeURIComponent(location.hash.slice(1)) || 'README').split('~');
    const same = page === current && $('page').dataset.loaded === page;
    current = page;
    if (!same) {
      try {
        const r = await fetch(current + '.md', { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status + ' ' + current);
        $('page').innerHTML = md(await r.text());
        $('page').dataset.loaded = page;
        const h = $('page').querySelector('h1'); document.title = (h ? h.textContent + ' · ' : '') + 'aslnut docs';
        await Promise.all([...$('page').querySelectorAll('[data-hier]')].map(hier));
      } catch (e) { $('page').innerHTML = `<p class="muted">Not found: ${esc(String(e.message))}</p>`; $('page').dataset.loaded = ''; }
    }
    for (const a of document.querySelectorAll('nav a')) a.classList.toggle('on', a.getAttribute('href') === '#' + current);
    $('nav').classList.remove('open');
    for (const x of document.querySelectorAll('.flash')) x.classList.remove('flash');
    const target = anchor && document.getElementById(anchor);
    if (target) { target.scrollIntoView({ block: 'center' }); target.classList.add('flash'); } else if (!same) window.scrollTo(0, 0);
  }
  async function start() {
    try { const j = await (await fetch('nav.json', { cache: 'no-store' })).json(); nav = j.sections; $('stamp').textContent = j.stamp; } catch (e) { nav = []; }
    $('nav').innerHTML = nav.map((s) => `<h4>${esc(s.title)}</h4>` + s.pages.map((p) => `<a class="${p.sub ? 'sub' : ''}" href="#${p.path}">${esc(p.title)}</a>`).join('')).join('');
    $('menu').onclick = () => $('nav').classList.toggle('open');
    addEventListener('hashchange', show);
    show();
  }
  start();
})();
