/** Five-qubit statevector. Internal bit q is 1 << q; UI strings read q0…q4. */
export const QUBITS = 5;
export const DIM = 1 << QUBITS;

export function zeroState() {
  const state = { re: new Float64Array(DIM), im: new Float64Array(DIM) };
  state.re[0] = 1;
  return state;
}

/** Mutates the state with a unitary gate. Columns are circuit time, not musical beats. */
export function applyGate(state, gate) {
  const mask = 1 << gate.q;
  if (gate.type === 'CNOT') {
    const target = 1 << gate.target;
    for (let i = 0; i < DIM; i++) if ((i & mask) && !(i & target)) {
      const j = i | target;
      [state.re[i], state.re[j]] = [state.re[j], state.re[i]];
      [state.im[i], state.im[j]] = [state.im[j], state.im[i]];
    }
    return state;
  }
  for (let i = 0; i < DIM; i++) if (!(i & mask)) {
    const j = i | mask;
    const ar = state.re[i], ai = state.im[i], br = state.re[j], bi = state.im[j];
    if (gate.type === 'H') {
      state.re[i] = (ar + br) * Math.SQRT1_2;
      state.im[i] = (ai + bi) * Math.SQRT1_2;
      state.re[j] = (ar - br) * Math.SQRT1_2;
      state.im[j] = (ai - bi) * Math.SQRT1_2;
    } else if (gate.type === 'X') {
      state.re[i] = br; state.im[i] = bi;
      state.re[j] = ar; state.im[j] = ai;
    } else if (gate.type === 'RZ') {
      const c = Math.cos(gate.angle / 2), s = Math.sin(gate.angle / 2);
      state.re[i] = ar * c + ai * s; state.im[i] = ai * c - ar * s;
      state.re[j] = br * c - bi * s; state.im[j] = bi * c + br * s;
    } else throw new Error('Unknown gate');
  }
  return state;
}

export function simulate(gates) {
  const state = zeroState();
  [...gates].sort((a, b) => a.col - b.col || a.q - b.q).forEach(g => applyGate(state, g));
  return state;
}

export function probabilities(state) {
  return Array.from(state.re, (re, i) => re * re + state.im[i] * state.im[i]);
}

export function marginals(probs) {
  return Array.from({ length: QUBITS }, (_, q) => probs.reduce((sum, p, i) => sum + ((i & (1 << q)) ? p : 0), 0));
}

/** One joint sample preserves entanglement; never sample the marginals independently. */
export function sample(probs, random = Math.random) {
  const total = probs.reduce((s, p) => s + p, 0);
  if (!Number.isFinite(total) || total <= 0 || probs.some(p => !Number.isFinite(p) || p < 0)) throw new Error('Invalid probability distribution');
  const r = random();
  if (r < 0 || r >= 1 || !Number.isFinite(r)) throw new Error('Random must be in [0,1)');
  let cumulative = 0, last = 0;
  for (let i = 0; i < probs.length; i++) {
    if (probs[i] > 0) last = i;
    cumulative += probs[i];
    if (r * total < cumulative) return i;
  }
  return last;
}

export function bitString(index) {
  return Array.from({ length: QUBITS }, (_, q) => (index >> q) & 1).join('');
}
