import { encoding, noteEvents, originalEvents } from './project.js';
import { measureStep } from './sequencer.js';

/** Audio-clock scheduler: short lookahead, cancellable nodes, no remote samples. */
export class Player {
  context = null;
  master = null;
  nodes = new Set();
  timers = new Set();
  playing = false;
  generation = 0;
  async start(project, onStep, mode = 'quantum') {
    this.stop();
    const generation = this.generation;
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const compressor = this.context.createDynamicsCompressor();
      this.master.connect(compressor).connect(this.context.destination);
    }
    await this.context.resume();
    if (generation !== this.generation) return;
    this.playing = true;
    this.master.gain.setValueAtTime(project.volume * 0.55, this.context.currentTime);
    const encoded = encoding(project);
    let count = 0, previous = 0, next = this.context.currentTime + 0.08;
    const duration = 60 / project.bpm;
    const tick = () => {
      if (!this.playing) return;
      while (next < this.context.currentTime + 0.15) {
        const step = count % 16;
        const playingMode = mode === 'compare' ? Math.floor(count / 16) % 2 === 0 ? 'original' : 'quantum' : mode;
        const index = playingMode === 'original' ? null : project.recording ? project.recording[step] : measureStep(project, step, previous, Math.random, encoded);
        if (index !== null) previous = index;
        const events = playingMode === 'original' ? originalEvents(project, step, next) : noteEvents(index, project, step, next, encoded);
        for (const event of events) this.note(event, project.voice);
        const scheduled = next;
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (this.playing) onStep({ step, index, mode: playingMode, scheduled, duration });
        }, Math.max(0, (next - this.context.currentTime) * 1000));
        this.timers.add(timer);
        next += duration; count++;
      }
    };
    tick();
    this.interval = setInterval(tick, 25);
  }
  note({ midi, time, duration, velocity = 0.72 }, voice) {
    const gain = this.context.createGain();
    const envelope = Math.max(0.04, duration);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.18 * velocity, time + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.001, time + envelope);
    gain.connect(this.master);
    const partials = voice === 'piano' ? [[1, 1], [2, 0.3], [3, 0.1]] : [[1, 1]];
    let remaining = partials.length;
    for (const [harmonic, level] of partials) {
      const oscillator = this.context.createOscillator(), partialGain = this.context.createGain();
      oscillator.type = voice === 'soft' ? 'triangle' : 'sine';
      oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12) * harmonic;
      partialGain.gain.value = level;
      oscillator.connect(partialGain).connect(gain);
      this.nodes.add(oscillator);
      oscillator.onended = () => {
        oscillator.disconnect(); partialGain.disconnect(); this.nodes.delete(oscillator);
        if (--remaining === 0) gain.disconnect();
      };
      oscillator.start(time); oscillator.stop(time + envelope + 0.02);
    }
  }
  setVolume(value) {
    if (this.master) this.master.gain.setTargetAtTime(value * 0.55, this.context.currentTime, 0.02);
  }
  stop() {
    this.generation++;
    this.playing = false;
    clearInterval(this.interval);
    this.timers.forEach(clearTimeout); this.timers.clear();
    this.nodes.forEach(node => { try { node.stop(); } catch { /* Already ended. */ } });
    this.nodes.clear();
  }
}
