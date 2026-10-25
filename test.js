const test = require('node:test'), assert = require('node:assert'), { Session } = require('./engine/engine');
const T = require('./sample/transcript.json');
const run = steps => { const s = new Session(T); const r = steps.map(x => { let o = s.say(x[0]); if (x[1]) o = s.reply(x[1]); return o; }); return { s, r }; };

test('worked example', () => {
  const { s, r } = run([["Add a caption 'Welcome!' when I say welcome to the channel"], ['Cut the first 30 seconds'], ['Remove the part about pricing', 'the second one'],
    ['Speed up from 1:00 to 1:30 by 2x'], ['Actually, put the intro back'], ['Undo'], ['Make that caption red']]);
  assert.ok(r.every(x => x.status === 'applied'));
  const tl = s.timeline(); assert.equal(tl.captions[0].color, 'red'); assert.ok(tl.captions[0].out_start < 40);
  assert.ok(r[4].duration_s > r[3].duration_s && r[5].duration_s === r[3].duration_s);
});

test('clarification, rejection, determinism', () => {
  const a = run([['Remove the part about pricing']]).r[0]; assert.equal(a.status, 'needs_clarification'); assert.equal(a.options.length, 4);
  for (const t of ['Cut everything', 'Speed up 10x from 0:10 to 0:20', "Add a caption 'Hi' at 9:00", 'Make it bigger']) assert.equal(run([[t]]).r[0].status, 'rejected', t);
  const h = () => run([['Cut the first 30 seconds'], ['Remove filler words']]).s.timeline().timeline_hash;
  assert.equal(h(), h());
});

test('caption hides when its words are cut and returns on restore/redo', () => {
  const { s } = run([["Add a caption 'W' when I say welcome to the channel"], ['Cut from 1:00 to 1:10']]);
  assert.equal(s.timeline().captions.length, 0);
  s.say('Put back what I removed'); assert.equal(s.timeline().captions.length, 1);
  s.say('undo'); assert.equal(s.timeline().captions.length, 0);
  s.say('redo'); assert.equal(s.timeline().captions.length, 1);
});
