import test from 'node:test';
import assert from 'node:assert/strict';
import { applyGate, bitString, marginals, probabilities, sample, simulate, zeroState } from '../src/quantum.js';
import { noteEvents, preset, putGate, validateProject } from '../src/project.js';
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const h = (q, col) => ({ type: 'H', q, col });

test('vacuum is silent and UI bit order reads q0 through q4', () => {
  assert.deepEqual(probabilities(zeroState()), [1, ...Array(31).fill(0)]);
  assert.equal(bitString(1), '10000'); assert.equal(bitString(16), '00001');
  assert.deepEqual(noteEvents(0, preset()), []);
});
test('Hadamard twice cancels on every qubit', () => {
  for (let q = 0; q < 5; q++) {
    const p = probabilities(simulate([h(q, 0), h(q, 1)])); close(p[0], 1); close(p[1 << q], 0);
  }
});
test('H Rz(theta) H yields P(1) = sin²(theta/2), not random independent gates', () => {
  for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2]) {
    const probs = probabilities(simulate([h(2, 0), { type: 'RZ', q: 2, col: 1, angle }, h(2, 2)]));
    close(probs[4], Math.sin(angle / 2) ** 2); close(probs[0], Math.cos(angle / 2) ** 2);
  }
});
test('Rz changes phases but not measurement probabilities on its own', () => {
  const before = simulate([h(1, 0)]), after = simulate([h(1, 0), { type: 'RZ', q: 1, col: 1, angle: 1.234 }]);
  probabilities(before).forEach((p, i) => close(p, probabilities(after)[i]));
  assert.notEqual(after.im[0], 0);
});
test('Bell pair has only correlated outcomes, with either control orientation', () => {
  for (const [q, target] of [[0, 4], [4, 0], [2, 3], [3, 2]]) {
    const p = probabilities(simulate([h(q, 0), { type: 'CNOT', q, target, col: 1 }]));
    const paired = (1 << q) | (1 << target);
    close(p[0], 0.5); close(p[paired], 0.5);
    for (let i = 0; i < 32; i++) if (i !== 0 && i !== paired) close(p[i], 0);
    close(marginals(p)[q], 0.5); close(marginals(p)[target], 0.5);
    for (let r = 0; r < 100; r++) assert.ok([0, paired].includes(sample(p, () => r / 100)));
  }
});
test('all five H gates produce a normalized uniform distribution', () => {
  probabilities(simulate(Array.from({ length: 5 }, (_, q) => h(q, 0)))).forEach(p => close(p, 1 / 32));
});
test('complex norm is conserved over 1000 mixed gates', () => {
  const state = zeroState();
  for (let i = 0; i < 1000; i++) {
    const type = ['H', 'RZ', 'X', 'CNOT'][i % 4], q = i % 5;
    applyGate(state, { type, q, target: (q + 1) % 5, angle: i * 0.017 });
  }
  close(probabilities(state).reduce((a, b) => a + b, 0), 1, 1e-10);
});
test('sampling skips zero-weight states even at the lower boundary', () => {
  assert.equal(sample([0, 0, 1, 0], () => 0), 2);
  assert.equal(sample([0.5, 0.5], () => 0.5), 1);
  assert.equal(sample([0, 0, 1, 0], () => 1 - Number.EPSILON), 2);
  assert.throws(() => sample([0, 0])); assert.throws(() => sample([1], () => 1));
});
test('circuits execute in column order regardless of serialization order', () => {
  const g = [h(0, 0), { type: 'RZ', q: 0, col: 1, angle: Math.PI }, h(0, 2)];
  assert.deepEqual(probabilities(simulate(g)), probabilities(simulate(g.toReversed())));
});
test('all presets round-trip through validated JSON', () => {
  for (const kind of ['dream', 'bell', 'interference', 'blank']) {
    const p = preset(kind); assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))), p);
  }
});
test('untrusted project validation rejects malformed gates, ranges and overlaps', () => {
  const cases = [
    p => { p.version = 2; }, p => { p.bpm = 0; }, p => { p.volume = NaN; },
    p => { p.scale = 'toString'; }, p => { p.title = '<'.repeat(81); },
    p => { p.bars[0] = [{ type: 'H', q: 5, col: 0 }]; },
    p => { p.bars[0] = [{ type: 'RZ', q: 1, col: 0, angle: Infinity }]; },
    p => { p.bars[0] = [{ type: 'CNOT', q: 1, target: 1, col: 0 }]; },
    p => { p.bars[0] = [h(0, 0), h(0, 0)]; },
    p => { p.bars[0] = [{ type: 'CNOT', q: 0, target: 4, col: 0 }, h(2, 0)]; },
    p => { p.recording = [0, 1, 2, 32]; }, p => { p.bars = []; },
  ];
  for (const mutate of cases) { const p = preset(); mutate(p); assert.throws(() => validateProject(p)); }
});
test('placing gates resolves occupied CNOT spans and retains other columns', () => {
  const gates = [{ type: 'CNOT', q: 0, target: 4, col: 0 }, h(1, 1)];
  assert.deepEqual(putGate(gates, h(2, 0)), [h(1, 1), h(2, 0)]);
});
test('chord and arpeggio mapping follow selected bits and exact bar timing', () => {
  const p = { ...preset(), bpm: 120, style: 'chord' };
  assert.deepEqual(noteEvents(5, p, 10).map(e => [e.midi, e.time]), [[60, 10], [64, 10]]);
  p.style = 'arpeggio'; const events = noteEvents(5, p, 10);
  assert.equal(events.length, 8); assert.equal(events.at(-1).time, 11.75);
  assert.deepEqual(events.map(e => e.midi), [60, 64, 60, 64, 60, 64, 60, 64]);
});
