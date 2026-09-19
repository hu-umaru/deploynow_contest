import test from 'node:test';
import assert from 'node:assert/strict';
import { probabilities, simulateColumn } from '../src/quantum.js';
import { applyRemix, encoding, fromScore, noteEvents, originalEvents, pitchesAt, preset, validateProject } from '../src/project.js';
import { previewSequence, recordLoop } from '../src/sequencer.js';
import { demoScore, encodeNotes } from '../src/musicxml.js';
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('H / measure / H / measure is NOT coherent H-H cancellation', () => {
  const p = preset('blank'); p.bars[0] = [{ type: 'H', q: 0, col: 0 }, { type: 'H', q: 0, col: 1 }];
  const d = previewSequence(p);
  close(d[0][0], 0.5); close(d[1][0], 0.5); close(d[1][1], 0.5);
});
test('actual collapsed outcome survives empty columns, resets at next bar', () => {
  const p = preset('blank'); p.bars[0] = [{ type: 'H', q: 0, col: 0 }];
  const result = recordLoop(p, () => 0.9);
  assert.equal(result.length, 16); assert.deepEqual(result.slice(0, 4), [1, 1, 1, 1]);
  assert.deepEqual(result.slice(4), Array(12).fill(0));
});
test('conditional X uses the previous outcome, never restarts the whole bar circuit', () => {
  const p = preset('blank'); p.bars[0] = [0, 1, 2, 3].map(col => ({ type: 'X', q: 1, col }));
  assert.deepEqual(recordLoop(p).slice(0, 4), [2, 0, 2, 0]);
});
test('Rz after a projective measurement cannot alter later probabilities', () => {
  const p = preset('blank'); p.bars[0] = [{ type: 'H', q: 0, col: 0 }, { type: 'RZ', q: 0, col: 1, angle: Math.PI }, { type: 'H', q: 0, col: 2 }];
  const d = previewSequence(p); close(d[2][1], 0.5);
});
test('within-column interference preserves sin²(theta/2)', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
    const p = probabilities(simulateColumn([{ type: 'INT', q: 2, col: 0, angle }], 0));
    close(p[4], Math.sin(angle / 2) ** 2);
  }
});
test('within-column PAIR generates Bell outcomes before measurement', () => {
  const p = probabilities(simulateColumn([{ type: 'PAIR', q: 0, target: 4, col: 0 }], 0));
  close(p[0], 0.5); close(p[17], 0.5);
  close(p.reduce((s, v) => s + v, 0), 1);
});
test('ensemble preview matches the exact two-coin trajectory distribution', () => {
  const p = preset('blank'); p.bars[0] = [{ type: 'H', q: 0, col: 0 }, { type: 'CNOT', q: 0, target: 1, col: 1 }, { type: 'H', q: 2, col: 2 }];
  const d = previewSequence(p)[2];
  for (const i of [0, 3, 4, 7]) close(d[i], 0.25);
  close(d.reduce((s, v) => s + v, 0), 1);
});
test('score pitches are preserved across more than five distinct notes', () => {
  const notes = [60, 61, 62, 63, 64, 65, 66].map((midi, start) => ({ midi, start, duration: 1, velocity: 0.8 }));
  const p = fromScore({ title: 'chromatic', notes, bpm: 120, warnings: [] }); applyRemix(p, 'faithful');
  const encoded = encoding(p), results = recordLoop(p);
  assert.deepEqual(results.slice(0, 7), Array(7).fill(1));
  assert.deepEqual(results.slice(7), Array(9).fill(0));
  assert.deepEqual(results.slice(0, 7).flatMap((mask, i) => noteEvents(mask, p, i, 0, encoded).map(e => e.midi)), notes.map(n => n.midi));
});
test('five concurrent source pitches stay exactly five; denser chords report reduction', () => {
  for (const size of [1, 5, 7]) {
    const notes = Array.from({ length: size }, (_, i) => ({ midi: 48 + i * 2, start: 0, duration: 2, velocity: 0.7 }));
    const e = encodeNotes(notes);
    assert.ok(e.steps.every(s => s.pitches.length === 5 && new Set(s.pitches).size === 5));
    assert.equal(e.steps[0].mask, (1 << Math.min(5, size)) - 1);
    assert.equal(e.omitted, Math.max(0, size - 5) * 2);
  }
});
test('source preparation overrides previous measurement at each column', () => {
  const p = fromScore(demoScore()); applyRemix(p, 'faithful');
  p.bars[0] = [{ type: 'X', q: 0, col: 0 }];
  const result = recordLoop(p), e = encoding(p);
  assert.equal(result[0], e.steps[0].mask ^ 1); assert.equal(result[1], e.steps[1].mask);
});
test('original retains fractional onset and duration; quantum rhythm is beat-quantized', () => {
  const p = fromScore(demoScore()); applyRemix(p, 'faithful');
  const original = originalEvents(p, 13, 10);
  assert.ok(original.some(e => e.time === 10.25));
  assert.ok(encoding(p).quantized > 0);
  assert.ok(noteEvents(3, p, 13, 10).every(e => e.time === 10 && e.duration < 0.5));
});
test('old v1 saves migrate safely without repeating four stale bar samples', () => {
  const old = { ...preset(), version: 1, recording: [0, 1, 2, 3] }; delete old.source;
  const upgraded = validateProject(old);
  assert.equal(upgraded.version, 2); assert.equal(upgraded.recording, null); assert.equal(upgraded.source, null);
  assert.deepEqual(upgraded.bars, old.bars);
});
test('score and all 16 frozen outcomes survive JSON round-trip', () => {
  const p = fromScore(demoScore('twinkle')); p.recording = recordLoop(p);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  assert.equal(pitchesAt(p, 0).length, 5);
});
test('source schema rejects nonfinite, out-of-range, huge and injected note payloads', () => {
  for (const mutate of [
    p => { p.source.notes[0].start = -1; }, p => { p.source.notes[0].duration = Infinity; },
    p => { p.source.notes[0].midi = 128; }, p => { p.source.notes[0].velocity = '1'; },
    p => { p.source.notes = Array(1025).fill(p.source.notes[0]); }, p => { p.source.warnings = ['x'.repeat(201)]; },
  ]) { const p = fromScore(demoScore()); mutate(p); assert.throws(() => validateProject(p)); }
});
