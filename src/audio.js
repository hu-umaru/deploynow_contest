import { noteEvents } from './project.js';
import { probabilities, sample, simulate } from './quantum.js';

/** Audio-clock scheduler: short lookahead, cancellable nodes, no remote samples. */
export class Player {
  context = null;
  master = null;
  nodes = new Set();
  timers = new Set();
  playing = false;
  generation = 0;
  async start(project, onBar) {
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
    const distributions = project.bars.map(bar => probabilities(simulate(bar)));
    let bar = 0, next = this.context.currentTime + 0.08;
    const duration = 240 / project.bpm;
    const tick = () => {
      if (!this.playing) return;
      while (next < this.context.currentTime + 0.15) {
        const current = bar % 4;
        const index = project.recording ? project.recording[current] : sample(distributions[current]);
        for (const event of noteEvents(index, project, next)) this.note(event, project.voice);
        const scheduled = next;
        const timer = setTimeout(() => {
          this.timers.delete(timer);
          if (this.playing) onBar(current, index, scheduled, duration);
        }, Math.max(0, (next - this.context.currentTime) * 1000));
        this.timers.add(timer);
        next += duration; bar++;
      }
    };
    tick();
    this.interval = setInterval(tick, 25);
  }
  note({ midi, time, duration }, voice) {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = voice === 'bell' ? 'sine' : 'triangle';
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.22, time + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    oscillator.connect(gain).connect(this.master);
    this.nodes.add(oscillator);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(oscillator); };
    oscillator.start(time); oscillator.stop(time + duration + 0.02);
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
