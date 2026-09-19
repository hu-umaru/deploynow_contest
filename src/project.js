import { encodeNotes } from './musicxml.js';
export const SCALES = {
  major: { name: 'C major pentatonic', notes: ['C4', 'D4', 'E4', 'G4', 'A4'], midi: [60, 62, 64, 67, 69] },
  minor: { name: 'A minor pentatonic', notes: ['A3', 'C4', 'D4', 'E4', 'G4'], midi: [57, 60, 62, 64, 67] },
  dreamy: { name: 'D dreamy pentatonic', notes: ['D4', 'E4', 'F♯4', 'A4', 'B4'], midi: [62, 64, 66, 69, 71] },
};
export const isPair = g => ['CNOT', 'PAIR'].includes(g.type);
export const hasAngle = g => ['RZ', 'INT'].includes(g.type);
export function preset(kind = 'dream') {
  const base = { version: 2, title: '拍ごとの量子スケッチ', bpm: 120, scale: 'major', style: 'chord', voice: 'piano', volume: 0.55, bars: [[], [], [], []], recording: null, source: null };
  if (kind === 'bell') {
    base.title = '拍ごとの量子デュエット';
    base.bars = Array.from({ length: 4 }, () => Array.from({ length: 4 }, (_, col) => ({ type: 'PAIR', q: 0, target: 2, col })));
  } else if (kind === 'interference') {
    base.title = '1拍の中の干渉';
    base.bars = Array.from({ length: 4 }, () => [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map((angle, col) => ({ type: 'INT', q: 2, angle, col })));
  } else if (kind === 'blank') base.title = '名前のない量子スケッチ';
  else base.bars = Array.from({ length: 4 }, (_, b) => Array.from({ length: 4 }, (_, col) => [
    { type: 'X', q: (col + b) % 3, col },
    { type: 'INT', q: 4, angle: Math.PI / 2, col },
  ]).flat());
  return base;
}
export function occupied(gate) {
  return isPair(gate) ? Array.from({ length: Math.abs(gate.q - gate.target) + 1 }, (_, i) => Math.min(gate.q, gate.target) + i) : [gate.q];
}
export function putGate(gates, gate) {
  const rows = occupied(gate);
  return [...gates.filter(g => g.col !== gate.col || !occupied(g).some(q => rows.includes(q))), gate];
}
export function validateProject(input) {
  const fail = () => { throw new Error('対応していない、または壊れたプロジェクトです。'); };
  const int = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
  const finite = (x, min, max) => typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max;
  if (!input || ![1, 2].includes(input.version) || typeof input.title !== 'string' || input.title.length > 80 || !int(input.bpm, 40, 180)
      || !Object.hasOwn(SCALES, input.scale) || !['chord', 'arpeggio'].includes(input.style) || !['bell', 'soft', 'piano'].includes(input.voice)
      || !finite(input.volume, 0, 1) || !Array.isArray(input.bars) || input.bars.length !== 4) fail();
  const bars = input.bars.map(bar => {
    if (!Array.isArray(bar) || bar.length > 20) fail();
    const cells = new Set();
    return bar.map(g => {
      if (!g || !['H', 'X', 'RZ', 'CNOT', 'INT', 'PAIR'].includes(g.type) || !int(g.q, 0, 4) || !int(g.col, 0, 3)) fail();
      if (isPair(g) && (!int(g.target, 0, 4) || g.target === g.q)) fail();
      if (hasAngle(g) && !finite(g.angle, -2 * Math.PI, 2 * Math.PI)) fail();
      for (const q of occupied(g)) { const key = `${g.col}:${q}`; if (cells.has(key)) fail(); cells.add(key); }
      return { type: g.type, q: g.q, col: g.col, ...(isPair(g) ? { target: g.target } : {}), ...(hasAngle(g) ? { angle: g.angle } : {}) };
    });
  });
  const recordingLength = input.version === 1 ? 4 : 16;
  if (input.recording !== null && (!Array.isArray(input.recording) || input.recording.length !== recordingLength || input.recording.some(n => !int(n, 0, 31)))) fail();
  let source = null;
  if (input.version === 2 && input.source !== null) {
    const s = input.source;
    if (!s || typeof s.title !== 'string' || s.title.length > 80 || !Array.isArray(s.notes) || !s.notes.length || s.notes.length > 1024
        || !Array.isArray(s.warnings) || s.warnings.length > 12 || s.warnings.some(w => typeof w !== 'string' || w.length > 200)) fail();
    const notes = s.notes.map(n => {
      if (!n || !int(n.midi, 0, 127) || !finite(n.start, 0, 16 - 1e-8) || !finite(n.duration, 1e-8, 16 - n.start + 1e-8) || !finite(n.velocity, 0.05, 1)) fail();
      return { midi: n.midi, start: n.start, duration: n.duration, velocity: n.velocity };
    });
    source = { title: s.title, notes, warnings: [...s.warnings] };
  }
  return { version: 2, title: input.title, bpm: input.bpm, scale: input.scale, style: input.style, voice: input.voice, volume: input.volume, bars, recording: input.version === 1 ? null : input.recording ? [...input.recording] : null, source };
}
export function fromScore(score) {
  const project = preset('blank');
  Object.assign(project, { title: score.title, bpm: score.bpm, source: { title: score.title, notes: score.notes, warnings: score.warnings } });
  applyRemix(project, 'gentle', 60);
  return validateProject(project);
}
export function applyRemix(project, kind, degrees = 60) {
  project.recording = null;
  project.bars = Array.from({ length: 4 }, () => []);
  if (kind === 'faithful') return;
  for (let step = 0; step < 16; step++) {
    const bar = project.bars[Math.floor(step / 4)], col = step % 4;
    if (kind === 'duet') bar.push({ type: 'PAIR', q: 3, target: 4, col });
    else if (kind === 'rhythm') bar.push({ type: 'H', q: 0, col });
    else bar.push({ type: 'INT', q: 0, angle: degrees * Math.PI / 180, col }, { type: 'INT', q: 4, angle: degrees * Math.PI / 240, col });
  }
}
export function encoding(project) { return project.source ? encodeNotes(project.source.notes) : null; }
export function pitchesAt(project, step, encoded = encoding(project)) { return encoded ? encoded.steps[step].pitches : SCALES[project.scale].midi; }
export function noteEvents(index, project, step = 0, start = 0, encoded = encoding(project)) {
  const notes = pitchesAt(project, step, encoded).filter((_, q) => index & (1 << q));
  const beat = 60 / project.bpm;
  if (project.style === 'chord') return notes.map(midi => ({ midi, time: start, duration: beat * 0.85, velocity: 0.72 }));
  return notes.map((midi, i) => ({ midi, time: start + i * beat / notes.length, duration: beat * 0.65, velocity: 0.72 }));
}
export function originalEvents(project, step, start = 0) {
  const beat = 60 / project.bpm;
  return (project.source?.notes || []).filter(n => n.start >= step && n.start < step + 1).map(n => ({ midi: n.midi, time: start + (n.start - step) * beat, duration: n.duration * beat * 0.96, velocity: n.velocity }));
}
