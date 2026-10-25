// Builds sample/interview.mp4 + public/transcript.json from the TTS wavs (word times are proportional to word length).
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const SR = 16000, dir = path.join(__dirname, 'wav');
const lines = fs.readFileSync(path.join(__dirname, 'script.txt'), 'utf8').split(/\r?\n/).filter(l => l.trim());
const pcmOf = f => { const b = fs.readFileSync(f); const i = b.indexOf('data'); return b.subarray(i + 8, i + 8 + b.readUInt32LE(i + 4)); };
const silence = s => Buffer.alloc(Math.round(s * SR) * 2);
const parts = [silence(0.6)], words = []; let t = 0.6;
lines.forEach((line, i) => {
  const pcm = pcmOf(path.join(dir, String(i).padStart(3, '0') + '.wav'));
  const dur = pcm.length / 2 / SR, toks = line.split(/\s+/);
  const total = toks.reduce((a, w) => a + w.length + 1, 0); let c = t;
  toks.forEach(w => { const d = dur * (w.length + 1) / total; words.push({ w: w.replace(/[.,]/g, ''), start: +c.toFixed(3), end: +(c + d).toFixed(3), speaker: 'A', conf: 0.95, sent: i }); c += d; });
  parts.push(pcm); t += dur;
  const gap = i === 13 ? 2.5 : 0.55; parts.push(silence(gap)); t += gap;
});
const pcm = Buffer.concat(parts), h = Buffer.alloc(44);
h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
fs.mkdirSync(path.join(__dirname, '../sample'), { recursive: true });
const wav = path.join(__dirname, 'all.wav'); fs.writeFileSync(wav, Buffer.concat([h, pcm]));
const duration = +(pcm.length / 2 / SR).toFixed(3);
fs.writeFileSync(path.join(__dirname, '../sample/transcript.json'), JSON.stringify({ video: 'interview.mp4', fps: 25, duration, words }, null, 1));
execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', `color=c=0x1f3a5f:s=480x270:r=25:d=${duration}`, '-i', wav,
  '-vf', "drawbox=x=190:y=60:w=100:h=100:color=0xf2c14e@1:t=fill,drawbox=x=0:y=230:w=480:h=40:color=black@0.4:t=fill",
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-shortest', '-movflags', '+faststart',
  path.join(__dirname, '../sample/interview.mp4')], { stdio: 'ignore' });
console.log('duration', duration, 'words', words.length);
