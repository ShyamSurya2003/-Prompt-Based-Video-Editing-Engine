// Prompt-based video editing engine. Deterministic: the parser only turns text into structured ops;
// all timeline logic is plain code. Edits are anchored to ORIGINAL source time (i.e. to content), never to the edited clock.
const crypto = require('crypto');
const POLICY = 'Times you type refer to the CURRENT (edited) timeline.';
const COLORS = ['red', 'green', 'blue', 'yellow', 'white', 'black', 'orange', 'purple', 'pink'];
const MIN_SPEED = 0.25, MAX_SPEED = 4, MIN_CAPTION_S = 0.7;
const NUMW = { five: 5, ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50 };
const r3 = x => Math.round(x * 1000) / 1000;
const norm = s => s.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
const fmt = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const ok = (summary, operations) => ({ status: 'applied', summary, operations });
const rej = reason => ({ status: 'rejected', reason });
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
const ord = i => ORD[i] || `#${i + 1}`;

function parseTime(s) {
  s = s.toLowerCase().trim().replace(/\b(five|ten|fifteen|twenty|thirty|forty|fifty)\b/g, w => NUMW[w]);
  let m;
  if ((m = s.match(/(\d+):(\d{2})/))) return +m[1] * 60 + +m[2];
  if ((m = s.match(/^(?:(\d+|a)\s*minutes?)?\s*(?:and\s*)?(\d+)?\s*(?:seconds?|secs?|s)?$/)) && (m[1] || m[2])) {
    return (m[1] ? (m[1] === 'a' ? 1 : +m[1]) : 0) * 60 + (m[2] ? +m[2] : 0);
  }
  return null;
}

class Session {
  constructor(transcript) {
    this.t = transcript; this.words = transcript.words; this.duration = transcript.duration;
    this.history = []; this.redo = []; this.pending = null; this.nextId = 1;
  }

  // ---------- timeline: a pure function of the history, replayed on the untouched original ----------
  timeline() {
    const restored = new Set(this.history.filter(h => h.kind === 'restore').map(h => h.target));
    const cuts = [], speeds = [], captions = [], mutes = []; let music = null;
    for (const h of this.history) {
      if (restored.has(h.id)) continue;
      if (h.kind === 'cut') cuts.push(...h.ranges);
      if (h.kind === 'speed') speeds.push({ ranges: h.ranges, f: h.factor });
      if (h.kind === 'caption') h.caps.forEach(c => captions.push({ ...c }));
      if (h.kind === 'style') { const c = captions.find(c => c.id === h.capId); if (c) Object.assign(c, h.style); }
      if (h.kind === 'mute') mutes.push(...h.mutes);
      if (h.kind === 'music') music = { ducking: true, level: 0.15 };
    }
    const pts = new Set([0, this.duration]);
    [...cuts, ...speeds.flatMap(s => s.ranges)].forEach(([a, b]) => { pts.add(r3(a)); pts.add(r3(b)); });
    const sorted = [...pts].filter(p => p >= 0 && p <= this.duration).sort((a, b) => a - b);
    const segs = []; let out = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1], mid = (a + b) / 2;
      if (cuts.some(([x, y]) => mid > x && mid < y)) continue;
      let f = 1; for (const s of speeds) if (s.ranges.some(([x, y]) => mid > x && mid < y)) f = s.f; // overlap rule: latest speed wins
      const last = segs[segs.length - 1];
      if (last && last.speed === f && last.src_end === a) { last.src_end = b; last.out_end = r3(last.out_start + (b - last.src_start) / f); out = last.out_end; continue; }
      segs.push({ src_start: a, src_end: b, speed: f, out_start: r3(out), out_end: r3(out + (b - a) / f) }); out = r3(out + (b - a) / f);
    }
    const toOut = (a, b) => { // source range -> edited-time range (null if fully cut)
      let s = null, e = null;
      for (const g of segs) {
        const x = Math.max(a, g.src_start), y = Math.min(b, g.src_end); if (x >= y) continue;
        if (s === null) s = g.out_start + (x - g.src_start) / g.speed; e = g.out_start + (y - g.src_start) / g.speed;
      }
      return s === null ? null : [r3(s), r3(e)];
    };
    const warnings = [], caps = [];
    for (const c of captions) {
      const o = toOut(c.src_start, c.src_end);
      if (!o) { warnings.push(`Caption "${c.text}" is hidden because its words are cut (it returns if they are restored).`); continue; }
      let [s, e] = o; if (e - s < MIN_CAPTION_S) e = Math.min(out, r3(s + MIN_CAPTION_S)); // readable minimum after speed-ups
      caps.push({ ...c, out_start: s, out_end: e });
    }
    const mus = mutes.map(m => ({ ...m, out: toOut(m.src_start, m.src_end) })).filter(m => m.out);
    const tl = { source: { file: this.t.video, duration: this.duration, fps: this.t.fps }, segments: segs, captions: caps, mutes: mus, music, duration_s: r3(out) };
    tl.timeline_hash = crypto.createHash('sha256').update(JSON.stringify(tl)).digest('hex').slice(0, 16);
    tl.time_policy = POLICY; tl.warnings = warnings;
    return tl;
  }
  // edited time -> source ranges (a range can span several source pieces)
  curToSrc(c0, c1) {
    const res = [];
    for (const g of this.timeline().segments) {
      const x = Math.max(c0, g.out_start), y = Math.min(c1, g.out_end); if (x >= y) continue;
      res.push([r3(g.src_start + (x - g.out_start) * g.speed), r3(g.src_start + (y - g.out_start) * g.speed)]);
    }
    return res;
  }
  snap(t) { // never clip a word: move the boundary to the nearer edge of the word it falls in
    const w = this.words.find(w => t > w.start && t < w.end); return w ? (t - w.start < w.end - t ? w.start : w.end) : t;
  }
  find(phrase) { // all occurrences of a phrase as [firstWordIdx, lastWordIdx]; prefix match on 4 letters (price ~ pricing)
    const p = norm(phrase).map(x => x.length > 4 ? x.slice(0, 4) : x), nw = this.words.map(w => norm(w.w)[0] || '');
    const res = [];
    for (let i = 0; i + p.length <= nw.length; i++) if (p.every((x, k) => nw[i + k].startsWith(x))) res.push([i, i + p.length - 1]);
    return res;
  }
  mentions(phrase) { // occurrences in adjacent sentences count as one mention; expanded to whole sentences
    const groups = [];
    for (const [i, j] of this.find(phrase)) {
      const s0 = this.words[i].sent ?? i, s1 = this.words[j].sent ?? j, g = groups[groups.length - 1];
      if (g && s0 - g.s1 <= 1) { g.s1 = s1; g.j = j; } else groups.push({ s0, s1, i, j });
    }
    return groups.map(g => {
      const ws = this.words.filter(w => w.sent !== undefined && w.sent >= g.s0 && w.sent <= g.s1);
      const a = ws.length ? ws[0].start : this.words[g.i].start, b = ws.length ? ws[ws.length - 1].end : this.words[g.j].end;
      return { a, b, label: `${fmt(a)}-${fmt(b)}` };
    });
  }

  // ---------- public API ----------
  view(res) { const t = this.timeline(); return { ...res, time_policy: POLICY, warnings: t.warnings, timeline_hash: t.timeline_hash, duration_s: t.duration_s }; }
  commit(r, before, text) { // push history entry, then describe the before/after
    if (r.entry) { r.entry.text = text; r.entry.id = this.nextId++; this.history.push(r.entry); this.redo = []; delete r.entry; }
    const d = r3(this.timeline().duration_s - before), now = this.timeline().duration_s;
    r.summary = `${r.summary} Length ${fmt(before)} -> ${fmt(now)} (${d === 0 ? 'unchanged' : (d > 0 ? '+' : '') + d + 's'}). ${POLICY}`;
    return r;
  }
  say(text) {
    const before = this.timeline().duration_s; let r;
    try { r = this.interpret(text.trim()); } catch (e) { r = rej(e.message); }
    this.pending = null;
    if (r.status === 'applied') r = this.commit(r, before, text);
    if (r.status === 'needs_clarification') this.pending = { options: r.opts, make: r.make, text };
    return this.view({ input: text, status: r.status, operations: r.operations || [], summary: r.summary || r.reason || '', question: r.question || null, options: r.options || null });
  }
  reply(answer) {
    const p = this.pending; if (!p) return this.view({ input: answer, status: 'rejected', operations: [], summary: 'No question is pending.', question: null, options: null });
    const a = answer.toLowerCase(); let picks = [];
    if (/\ball\b|every|both/.test(a)) picks = p.options.map((_, i) => i);
    else { let k = ORD.findIndex(o => a.includes(o)); if (k < 0) { const m = a.match(/\d+/); k = m ? +m[0] - 1 : -1; } if (k >= 0 && k < p.options.length) picks = [k]; }
    if (!picks.length) return this.view({ input: answer, status: 'needs_clarification', operations: [], summary: '', question: 'I could not tell which one you meant.', options: p.options.map(o => o.label) });
    this.pending = null; const before = this.timeline().duration_s;
    const r = this.commit(p.make(picks.map(i => p.options[i])), before, `${p.text} -> ${answer}`);
    return this.view({ input: answer, status: 'applied', operations: r.operations, summary: r.summary, question: null, options: null });
  }

  interpret(text) {
    const s = text.toLowerCase().replace(/[.!]+$/, '');
    if (/^undo\b/.test(s)) {
      if (s !== 'undo') return rej('Only a plain "undo" is supported (one instruction = one undo). Say "put back <what>" to restore a specific earlier edit.');
      const h = this.history.pop(); if (!h) return rej('Nothing to undo.'); this.redo.push(h);
      return ok(`Undid instruction #${h.id} ("${h.text}").`, [{ op: 'undo', target: h.id }]);
    }
    if (/^redo\b/.test(s)) { const h = this.redo.pop(); if (!h) return rej('Nothing to redo.'); this.history.push(h); return ok(`Redid instruction #${h.id}.`, [{ op: 'redo', target: h.id }]); }
    if (/^render\b/.test(s)) return ok('Render requested. Run `npm run render` (or the session runner) to produce the video from this timeline.', [{ op: 'render' }]);
    if (/(put|bring).*back|restore/.test(s)) return this.restore(s);
    if (/caption/.test(s) && /auto|whole video|entire video/.test(s)) return this.autoCaption();
    if (/make .*caption|caption.*(bigger|smaller)/.test(s) && !/\badd\b/.test(s)) return this.styleCaption(s);
    if (/\b(add|put|insert)\b.*(caption|text)/.test(s)) return this.addCaption(text);
    if (/make (it|that|this) (bigger|smaller|shorter|longer)/.test(s)) return rej('There is no caption or other element to resize. Add a caption first.');
    if (/\b(mute|bleep)\b/.test(s)) return this.mute(s);
    if (/music/.test(s)) return { status: 'applied', operations: [{ op: 'music', ducking: 'auto-lowers under speech' }], summary: 'Added background music that ducks under speech.', entry: { kind: 'music' } };
    if (/\b(speed|slow)\b/.test(s)) return this.speed(s);
    if (/\b(cut|remove|delete|trim)\b/.test(s)) return this.cut(s);
    return rej('I did not understand that. Try: cut, speed up, caption, mute, remove fillers/silences, add music, put back, undo, redo, render.');
  }
  span(s) { // "from A to B" / "A-B" / "A to B"
    const m = s.match(/(?:from\s+)?([\d:]+|a minute[\w ]*?|\d+ seconds?)\s*(?:to|-|until)\s*([\d:]+(?:\s*seconds?)?|a minute[\w ]*?)(?:\s+by|\s+at|\s*$)/);
    if (!m) return null; const a = parseTime(m[1]), b = parseTime(m[2]); return a === null || b === null ? null : [a, b];
  }
  checkRange(a, b) {
    const d = this.timeline().duration_s;
    if (a >= b) throw new Error(`Invalid range ${fmt(a)}-${fmt(b)}.`);
    if (a >= d) throw new Error(`Out of range: ${fmt(a)} is past the end of the current video (${fmt(d)}).`);
  }
  cut(s) {
    const d = this.timeline().duration_s; let m, ranges, label, summary;
    if (/(everything|whole video|entire video)/.test(s) && !/\b(after|before)\b/.test(s)) return rej('Cannot cut the whole video: nothing would be left. Say which part to remove.');
    if (/filler|\bums?\b|\buhs?\b/.test(s)) {
      const f = this.words.filter(w => /^(um+|uh+|er+|erm)$/i.test(w.w));
      if (!f.length) return ok('No filler words found.', []);
      ranges = f.map(w => [w.start, w.end]);
      return { status: 'applied', operations: [{ op: 'cut', ranges, reason: 'filler words um/uh ("like" is left alone: it is not reliably a filler)' }], summary: `Removed ${f.length} filler words.`, entry: { kind: 'cut', ranges, label: 'fillers' } };
    }
    if (/silence/.test(s)) {
      m = s.match(/(\d+(?:\.\d+)?)/); const n = m ? +m[1] : 1; ranges = [];
      for (let i = 0; i < this.words.length - 1; i++) { const g = this.words[i + 1].start - this.words[i].end; if (g > n) ranges.push([r3(this.words[i].end + 0.15), r3(this.words[i + 1].start - 0.15)]); }
      if (!ranges.length) return ok(`No silences longer than ${n}s.`, []);
      return { status: 'applied', operations: [{ op: 'cut', ranges }], summary: `Removed ${ranges.length} silence(s) longer than ${n}s (0.3s of each is kept).`, entry: { kind: 'cut', ranges, label: 'silences' } };
    }
    if ((m = s.match(/\bfirst\s+(.+?)(?:\s*seconds?)?$/))) {
      const n = parseTime(m[1] + ' seconds'); if (n === null) return rej('Could not read the duration.');
      if (n >= d) return rej('Cannot cut the whole video.');
      ranges = this.curToSrc(0, n).map(([a, b]) => [a, this.snap(b)]); label = 'intro'; summary = `Cut the first ${n}s.`;
    } else if ((m = s.match(/\blast\s+(.+?)(?:\s*seconds?)?$/))) {
      const n = parseTime(m[1] + ' seconds'); if (n === null) return rej('Could not read the duration.');
      if (n >= d) return rej('Cannot cut the whole video.');
      ranges = this.curToSrc(d - n, d).map(([a, b]) => [this.snap(a), b]); label = 'ending'; summary = `Cut the last ${n}s.`;
    } else if ((m = s.match(/\bafter (?:i say|the word|i mention)\s+(.+)$/))) {
      const word = m[1].replace(/['"]/g, ''), occ = this.find(word); if (!occ.length) return rej(`I could not find "${word}" in the transcript.`);
      const mk = ch => { const ranges = [[ch[0].a, this.duration]]; return { status: 'applied', operations: [{ op: 'cut', ranges }], summary: `Cut everything after "${word}" (${ch[0].label}).`, entry: { kind: 'cut', ranges, label: 'after ' + word } }; };
      const opts = occ.map(([, j], k) => ({ a: this.words[j].end, label: `after the ${ord(k)} time (original ${fmt(this.words[j].end)})` }));
      if (opts.length === 1) return mk(opts);
      return { status: 'needs_clarification', question: `"${word}" is said ${opts.length} times. Cut everything after which one?`, options: opts.map(o => o.label), opts, make: mk };
    } else if ((m = s.match(/(?:about|regarding|mentioning)\s+(.+)$/))) {
      const word = m[1].replace(/['"]/g, ''), ms = this.mentions(word); if (!ms.length) return rej(`I could not find anything about "${word}" in the transcript.`);
      const mk = ch => { const ranges = ch.map(o => [r3(o.a - 0.05), r3(o.b + 0.05)]); return { status: 'applied', operations: [{ op: 'cut', ranges }], summary: `Removed ${ch.length} part(s) about "${word}" (original ${ch.map(c => c.label).join(', ')}).`, entry: { kind: 'cut', ranges, label: word } }; };
      if (ms.length === 1) return mk(ms);
      const opts = ms.map((o, i) => ({ ...o, label: `the ${ord(i)} one (original ${o.label})` }));
      return { status: 'needs_clarification', question: `"${word}" is mentioned ${ms.length} times. Which one, or all?`, options: [...opts.map(o => o.label), 'all of them'], opts: [...opts, { label: 'all of them', all: true }].map(o => o), make: ch => mk(ch.some(c => c.all) ? ms : ch) };
    } else {
      const sp = this.span(s); if (!sp) return rej('Say what to cut: a range ("from 0:30 to 0:40"), "the first/last N seconds", "the part about X", "everything after I say X", fillers or silences.');
      const [a, b] = sp; this.checkRange(a, b); const bb = Math.min(b, d);
      if (a === 0 && bb >= d) return rej('Cannot cut the whole video.');
      ranges = this.curToSrc(a, bb).map(([x, y]) => [this.snap(x), this.snap(y)]); summary = `Cut ${fmt(a)}-${fmt(bb)}.`; label = `${fmt(a)}-${fmt(bb)}`;
    }
    if (!ranges.length) return rej('That range is already empty.');
    return { status: 'applied', operations: [{ op: 'cut', ranges }], summary, entry: { kind: 'cut', ranges, label } };
  }
  speed(s) {
    const m = s.match(/(\d+(?:\.\d+)?)\s*x/); if (!m) return rej('Say the factor, e.g. "by 2x".');
    let f = +m[1]; if (/slow/.test(s)) f = 1 / f;
    if (f > MAX_SPEED || f < MIN_SPEED) return rej(`Speed ${m[1]}x is outside the supported range ${MIN_SPEED}x-${MAX_SPEED}x.`);
    const sp = this.span(s); if (!sp) return rej('Say which range, e.g. "from 1:00 to 1:30".');
    const [a, b] = sp; this.checkRange(a, b);
    const ranges = this.curToSrc(a, Math.min(b, this.timeline().duration_s));
    return { status: 'applied', operations: [{ op: 'speed', factor: f, ranges }], summary: `Set ${fmt(a)}-${fmt(b)} to ${f}x (where speed changes overlap, the latest wins).`, entry: { kind: 'speed', ranges, factor: f, label: `speed ${f}x` } };
  }
  capEntry(q, i, j) {
    const ws = this.words.slice(i, j + 1).map(w => w.w).join(' ');
    return { status: 'applied', operations: [{ op: 'caption', text: q, words: ws, src_start: this.words[i].start, src_end: this.words[j].end }],
      summary: `Caption "${q}" attached to the words "${ws}" (original time ${fmt(this.words[i].start)}-${fmt(this.words[j].end)}).`,
      entry: { kind: 'caption', caps: [{ id: `c${this.nextId}_${i}`, text: q, w0: i, w1: j, src_start: this.words[i].start, src_end: this.words[j].end, color: 'white', size: 28 }] } };
  }
  addCaption(text) {
    const q = text.match(/['"“‘](.+?)['"”’](?=\s|$)/); if (!q) return rej('Put the caption text in quotes, e.g. add a caption \'Welcome!\' when I say ...');
    const rest = text.slice(q.index + q[0].length); let m;
    if ((m = rest.match(/(?:when|where|as) (?:i|he|she|they) say\s+(.+)$/i))) {
      const occ = this.find(m[1].replace(/['"]/g, '')); if (!occ.length) return rej(`I could not find "${m[1]}" in the transcript.`);
      if (occ.length === 1) return this.capEntry(q[1], ...occ[0]);
      return { status: 'needs_clarification', question: `"${m[1]}" occurs ${occ.length} times. Which one?`, options: occ.map((o, k) => `the ${ord(k)} one (original ${fmt(this.words[o[0]].start)})`), opts: occ.map((o, k) => ({ o, label: ord(k) })), make: ch => this.capEntry(q[1], ...ch[0].o) };
    }
    if ((m = rest.match(/\bat\s+(.+)$/i))) {
      const t = parseTime(m[1]), d = this.timeline().duration_s;
      if (t === null) return rej('Could not read that time.');
      if (t >= d) return rej(`Out of range: ${fmt(t)} is past the end of the video (${fmt(d)}).`);
      const src = this.curToSrc(t, Math.min(t + 0.1, d))[0][0], i = this.words.findIndex(w => w.end > src); let j = i;
      while (j + 1 < this.words.length && this.words[j + 1].end - this.words[i].start < 2.5) j++;
      return this.capEntry(q[1], i, j);
    }
    return rej('Say where: "when I say ..." or "at 0:30".');
  }
  autoCaption() {
    const by = new Map(); this.words.forEach((w, i) => { const k = w.sent ?? Math.floor(i / 8); by.set(k, [...(by.get(k) || []), i]); });
    const caps = [...by.values()].map((ix, k) => ({ id: `a${k}`, text: ix.map(i => this.words[i].w).join(' '), w0: ix[0], w1: ix[ix.length - 1], src_start: this.words[ix[0]].start, src_end: this.words[ix[ix.length - 1]].end, color: 'white', size: 22 }));
    return { status: 'applied', operations: [{ op: 'auto_caption', count: caps.length }], summary: `Added ${caps.length} captions covering the whole video.`, entry: { kind: 'caption', caps } };
  }
  styleCaption(s) {
    const tl = this.timeline(); if (!tl.captions.length) return rej('There is no caption to change. Add one first.');
    if (tl.captions.length > 1) return { status: 'needs_clarification', question: 'Which caption?', options: tl.captions.slice(0, 8).map(c => `"${c.text}" at ${fmt(c.out_start)}`), opts: tl.captions.slice(0, 8).map(c => ({ c, label: c.text })), make: ch => this.styleApply(s, ch[0].c) };
    return this.styleApply(s, tl.captions[0]);
  }
  styleApply(s, c) {
    const style = {}, col = COLORS.find(x => s.includes(x));
    if (col) style.color = col; if (/bigger|larger/.test(s)) style.size = Math.round(c.size * 1.3); if (/smaller/.test(s)) style.size = Math.round(c.size * 0.75);
    if (!Object.keys(style).length) return rej('Say a colour (red, blue, ...) or bigger/smaller.');
    return { status: 'applied', operations: [{ op: 'style_caption', caption: c.text, ...style }], summary: `Caption "${c.text}": ${Object.entries(style).map(([k, v]) => k + '=' + v).join(', ')}.`, entry: { kind: 'style', capId: c.id, style } };
  }
  mute(s) {
    const m = s.match(/(?:mute|bleep)\s+(?:the (?:word|words|phrase)\s+)?['"]?(.+?)['"]?$/); if (!m) return rej('Say what to mute, e.g. mute "pricing".');
    const occ = this.find(m[1]); if (!occ.length) return rej(`I could not find "${m[1]}" in the transcript.`);
    const mutes = occ.map(([i, j]) => ({ src_start: this.words[i].start, src_end: this.words[j].end, w0: i, w1: j }));
    const low = occ.filter(([i, j]) => this.words.slice(i, j + 1).some(w => w.conf < 0.6)).length;
    return { status: 'applied', operations: mutes.map(x => ({ op: 'mute', ...x })), summary: `Muted ${mutes.length} occurrence(s) of "${m[1]}"${low ? ` (${low} low-confidence: please verify)` : ''}. Muted audio stays on its words.`, entry: { kind: 'mute', mutes } };
  }
  restore(s) {
    const restoredIds = new Set(this.history.filter(h => h.kind === 'restore').map(h => h.target));
    const live = this.history.filter(h => h.kind === 'cut' && !restoredIds.has(h.id));
    if (!live.length) return rej('There is nothing removed to put back.');
    const mk = ch => ({ status: 'applied', operations: [{ op: 'restore', target: ch[0].h.id }], summary: `Put back edit #${ch[0].h.id} ("${ch[0].h.text}"). Other edits are untouched; captions on restored words return.`, entry: { kind: 'restore', target: ch[0].h.id } });
    let pick = live; const m = s.match(/(?:about|on)\s+(\w+)/);
    if (/intro|beginning|start|first/.test(s)) pick = live.filter(h => h.ranges.some(r => r[0] === 0));
    else if (m) pick = live.filter(h => (h.label || '').toLowerCase().includes(m[1]));
    if (!pick.length) return rej('I could not find a removed part matching that.');
    if (pick.length === 1) return mk([{ h: pick[0] }]);
    return { status: 'needs_clarification', question: 'Which removed part should come back?', options: pick.map(h => `#${h.id}: ${h.text}`), opts: pick.map(h => ({ h, label: `#${h.id}: ${h.text}` })), make: mk };
  }
}
module.exports = { Session, fmt, POLICY };
