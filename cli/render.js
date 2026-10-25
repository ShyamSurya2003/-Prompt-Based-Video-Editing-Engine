// Renders a timeline to video with ffmpeg. Separate from editing: the source file is only ever read.
const { execFileSync } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const esc = t => t.replace(/[\\:%]/g, c => '\\' + c).replace(/'/g, '’');
const FONT = process.env.FONT_FILE || 'C\\:/Windows/Fonts/arial.ttf';
const atempo = f => { const c = []; while (f > 2) { c.push('atempo=2'); f /= 2; } while (f < 0.5) { c.push('atempo=0.5'); f /= 0.5; } c.push(`atempo=${f}`); return c.join(','); };
module.exports = function render(tl, src, out) {
  const fps = tl.source.fps || 25, F = [];
  tl.segments.forEach((g, i) => {
    F.push(`[0:v]trim=start=${g.src_start}:end=${g.src_end},setpts=(PTS-STARTPTS)/${g.speed},fps=${fps}[v${i}]`);
    F.push(`[0:a]atrim=start=${g.src_start}:end=${g.src_end},asetpts=PTS-STARTPTS,${atempo(g.speed)}[a${i}]`);
  });
  const n = tl.segments.length;
  F.push(tl.segments.map((_, i) => `[v${i}][a${i}]`).join('') + `concat=n=${n}:v=1:a=1[cv][ca]`);
  let v = 'cv', a = 'ca';
  tl.captions.forEach((c, i) => {
    F.push(`[${v}]drawtext=fontfile='${FONT}':text='${esc(c.text)}':fontsize=${c.size}:fontcolor=${c.color}:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-60:enable='between(t,${c.out_start},${c.out_end})'[t${i}]`); v = `t${i}`;
  });
  if (tl.mutes.length) { F.push(`[${a}]${tl.mutes.map(m => `volume=enable='between(t,${m.out[0]},${m.out[1]})':volume=0`).join(',')}[am]`); a = 'am'; }
  if (tl.music) { // placeholder generated tone as "music"; ducks under speech via sidechain compression
    F.push(`[${a}]asplit[sp][sc]`);
    F.push(`sine=frequency=220:sample_rate=16000,volume=${tl.music.level},apad,atrim=duration=${tl.duration_s}[mu]`);
    F.push(`[mu][sc]sidechaincompress=threshold=0.02:ratio=8[du]`);
    F.push(`[sp][du]amix=inputs=2:duration=first:normalize=0[amx]`); a = 'amx';
  }
  const fc = F.filter(Boolean).join(';');
  execFileSync(ffmpeg, ['-y', '-i', src, '-filter_complex', fc, '-map', `[${v}]`, '-map', `[${a}]`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { stdio: ['ignore', 'ignore', 'pipe'] });
  return out;
};
