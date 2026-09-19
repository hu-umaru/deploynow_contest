import { probabilities, sample, simulateColumn } from './quantum.js';
import { encoding } from './project.js';

/** A real projective measurement at EVERY column. Retain its basis outcome until the next gate. */
export function measureStep(project, step, previous = 0, random = Math.random, encoded = encoding(project)) {
  const col = step % 4;
  const input = encoded ? encoded.steps[step].mask : col === 0 ? 0 : previous;
  return sample(probabilities(simulateColumn(project.bars[Math.floor(step / 4)], col, input)), random);
}
export function recordLoop(project, random = Math.random) {
  const encoded = encoding(project), results = [];
  for (let step = 0; step < 16; step++) results.push(measureStep(project, step, results.at(-1) ?? 0, random, encoded));
  return results;
}
/** Exact ensemble preview. Sum classical branches created by earlier measurements, never amplitudes. */
export function previewSequence(project) {
  const encoded = encoding(project), results = [];
  let previous = [1, ...Array(31).fill(0)];
  for (let step = 0; step < 16; step++) {
    const col = step % 4, gates = project.bars[Math.floor(step / 4)];
    if (encoded || col === 0) {
      previous = Array(32).fill(0); previous[encoded ? encoded.steps[step].mask : 0] = 1;
    }
    const next = Array(32).fill(0);
    previous.forEach((weight, input) => {
      if (weight < 1e-15) return;
      probabilities(simulateColumn(gates, col, input)).forEach((p, output) => { next[output] += p * weight; });
    });
    results.push(next); previous = next;
  }
  return results;
}
