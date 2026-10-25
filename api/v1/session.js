// POST /api/v1/session  {steps:[{say, answer?}]} -> per-step results + final timeline.
// Stateless: the session is replayed deterministically from the step list on every call.
const { Session } = require('../../engine/engine');
const transcript = require('../../sample/transcript.json');

module.exports = (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET') return res.status(200).send(JSON.stringify({ transcript_words: transcript.words.length, duration: transcript.duration }));
  const steps = req.body && req.body.steps;
  if (!Array.isArray(steps) || steps.length > 100) {
    return res.status(400).send(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'Body must be {"steps":[{"say":"..."}]} with at most 100 steps.', retryable: false, details: {} } }));
  }
  const s = new Session(transcript), results = [];
  for (const st of steps) {
    let r = s.say(String(st.say || '').slice(0, 300));
    if (r.status === 'needs_clarification' && st.answer) r = { ...r, answered: s.reply(String(st.answer).slice(0, 100)) };
    results.push(r);
  }
  res.status(200).send(JSON.stringify({ results, timeline: s.timeline() }));
};
