#!/usr/bin/env node
// Session runner: node cli/run.js <session.yaml> [outDir]  ->  outDir/results.json (+ timeline.json, output.mp4)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const YAML = require('yaml'), { Session } = require('../engine/engine');
const [, , file, outDir = 'out'] = process.argv;
if (!file) { console.error('usage: node cli/run.js session.yaml [outDir]'); process.exit(2); }
const sess = YAML.parse(fs.readFileSync(file, 'utf8'));
const root = path.join(__dirname, '..');
const local = path.isAbsolute(sess.video) ? sess.video : fs.existsSync(path.resolve(path.dirname(file), sess.video)) ? path.resolve(path.dirname(file), sess.video) : path.join(root, 'sample', path.basename(sess.video));
const transcript = JSON.parse(fs.readFileSync(path.join(root, 'sample', 'transcript.json'), 'utf8'));
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const srcBefore = fs.existsSync(local) ? hash(local) : null;
fs.mkdirSync(outDir, { recursive: true });
const s = new Session(transcript), results = [];
(async () => {
  for (const [i, step] of sess.steps.entries()) {
    let r = s.say(step.say);
    if (r.status === 'needs_clarification' && step.answer) r = { ...r, answered: s.reply(step.answer) };
    if (/^render/i.test(step.say)) { r.video = path.join(outDir, 'output.mp4'); require('./render')(s.timeline(), local, r.video); }
    results.push({ step: i + 1, ...r }); console.log(`${i + 1}. [${r.answered ? r.answered.status : r.status}] ${step.say}`);
  }
  const tl = s.timeline();
  fs.writeFileSync(path.join(outDir, 'timeline.json'), JSON.stringify(tl, null, 2));
  fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ source_sha256_before: srcBefore, source_sha256_after: fs.existsSync(local) ? hash(local) : null, results, final_timeline: tl }, null, 2));
  console.log('timeline_hash', tl.timeline_hash, 'duration_s', tl.duration_s, '| source untouched:', srcBefore === hash(local));
})();
