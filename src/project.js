export const SCALES = {
  major: { name: 'C major pentatonic', notes: ['C4', 'D4', 'E4', 'G4', 'A4'], midi: [60, 62, 64, 67, 69] },
  minor: { name: 'A minor pentatonic', notes: ['A3', 'C4', 'D4', 'E4', 'G4'], midi: [57, 60, 62, 64, 67] },
  dreamy: { name: 'D dreamy pentatonic', notes: ['D4', 'E4', 'F♯4', 'A4', 'B4'], midi: [62, 64, 66, 69, 71] },
};
const h = (q, col = 0) => ({ type: 'H', q, col });
const x = (q, col = 0) => ({ type: 'X', q, col });
const cx = (q, target, col = 1) => ({ type: 'CNOT', q, target, col });
const rz = (q, angle, col = 1) => ({ type: 'RZ', q, angle, col });

export function preset(kind = 'dream') {
  const base = { version: 1, title: 'はじめての量子スケッチ', bpm: 96, scale: 'major', style: 'arpeggio', voice: 'bell', volume: 0.55, bars: [], recording: null };
  if (kind === 'bell') {
    base.title = 'ふたつの音、ひとつの偶然';
    base.bars = Array.from({ length: 4 }, (_, i) => [h(i % 3), cx(i % 3, (i % 3) + 2)]);
  } else if (kind === 'interference') {
    base.title = '干渉のグラデーション';
    base.bars = [0, Math.PI / 2, Math.PI, Math.PI * 1.5].map(angle => [h(2), rz(2, angle), h(2, 2)]);
  } else if (kind === 'blank') {
    base.title = '名前のない量子スケッチ'; base.bars = [[], [], [], []];
  } else {
    base.bars = [
      [h(0), h(2), h(4), cx(0, 1, 2)],
      [x(0), h(1), h(3), cx(3, 4, 2)],
      [h(0), rz(0, Math.PI / 2), h(0, 2), x(2), h(4)],
      [h(1), cx(1, 3), x(0), h(4, 3)],
    ];
  }
  return base;
}

export function occupied(gate) {
  return gate.type === 'CNOT' ? Array.from({ length: Math.abs(gate.q - gate.target) + 1 }, (_, i) => Math.min(gate.q, gate.target) + i) : [gate.q];
}

/** CNOT reserves its full visual span so wires never obscure another gate. */
export function putGate(gates, gate) {
  const rows = occupied(gate);
  return [...gates.filter(g => g.col !== gate.col || !occupied(g).some(q => rows.includes(q))), gate];
}

export function validateProject(input) {
  const fail = () => { throw new Error('対応していない、または壊れたプロジェクトです。'); };
  const int = (x, min, max) => Number.isInteger(x) && x >= min && x <= max;
  if (!input || input.version !== 1 || typeof input.title !== 'string' || input.title.length > 80 || !int(input.bpm, 40, 180)
      || !Object.hasOwn(SCALES, input.scale) || !['chord', 'arpeggio'].includes(input.style) || !['bell', 'soft'].includes(input.voice)
      || !Number.isFinite(input.volume) || input.volume < 0 || input.volume > 1 || !Array.isArray(input.bars) || input.bars.length !== 4) fail();
  const bars = input.bars.map(bar => {
    if (!Array.isArray(bar) || bar.length > 20) fail();
    const cells = new Set();
    return bar.map(g => {
      if (!g || !['H', 'X', 'RZ', 'CNOT'].includes(g.type) || !int(g.q, 0, 4) || !int(g.col, 0, 3)) fail();
      if (g.type === 'CNOT' && (!int(g.target, 0, 4) || g.target === g.q)) fail();
      if (g.type === 'RZ' && (!Number.isFinite(g.angle) || Math.abs(g.angle) > 2 * Math.PI)) fail();
      for (const q of occupied(g)) { const key = `${g.col}:${q}`; if (cells.has(key)) fail(); cells.add(key); }
      return { type: g.type, q: g.q, col: g.col, ...(g.type === 'CNOT' ? { target: g.target } : {}), ...(g.type === 'RZ' ? { angle: g.angle } : {}) };
    });
  });
  if (input.recording !== null && (!Array.isArray(input.recording) || input.recording.length !== 4 || input.recording.some(n => !int(n, 0, 31)))) fail();
  return { version: 1, title: input.title, bpm: input.bpm, scale: input.scale, style: input.style, voice: input.voice, volume: input.volume, bars, recording: input.recording ? [...input.recording] : null };
}

export function noteEvents(index, project, barStart = 0) {
  const notes = SCALES[project.scale].midi.filter((_, q) => index & (1 << q));
  const beat = 60 / project.bpm;
  if (project.style === 'chord') return notes.map(midi => ({ midi, time: barStart, duration: beat * 3.5 }));
  if (!notes.length) return [];
  return Array.from({ length: 8 }, (_, i) => ({ midi: notes[i % notes.length], time: barStart + i * beat / 2, duration: beat * 0.8 }));
}
