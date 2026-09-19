/** Uncompressed, score-partwise MusicXML. No network, no external entities. */
const children = (node, name) => Array.from(node.children || []).filter(el => el.localName === name);
const child = (node, name) => children(node, name)[0];
const value = (node, name, fallback = '') => child(node, name)?.textContent.trim() ?? fallback;
const fail = message => { throw new Error(message); };
const pitchClass = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const noteName = midi => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][midi % 12] + (Math.floor(midi / 12) - 1);

export function parseMusicXML(text, name = '読み込んだ楽譜') {
  if (typeof text !== 'string' || text.length > 2_000_000) fail('MusicXMLは2MB以下にしてください。');
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text)) fail('内部エンティティを含むXMLには対応していません。');
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || doc.documentElement.localName !== 'score-partwise') fail('非圧縮のMusicXML（score-partwise形式）を選んでください。PDF・画像・MXLは未対応です。');
  const root = doc.documentElement, notes = [], warnings = new Set();
  let bpm = null;
  const parts = children(root, 'part');
  if (!parts.length || parts.length > 32) fail('パート数が不正です（1〜32パート）。');
  const title = value(child(root, 'work') || root, 'work-title', value(root, 'movement-title', name)).slice(0, 80);
  for (const part of parts) {
    let divisions = 1, nominal = 4, base = 0;
    const ties = new Map();
    for (const measure of children(part, 'measure')) {
      if (base >= 16 - 1e-8) { warnings.add('先頭16拍だけを使用します。'); break; }
      let cursor = 0, end = 0, previousOnset = 0;
      for (const el of Array.from(measure.children)) {
        if (el.localName === 'attributes') {
          if (child(el, 'divisions')) divisions = Number(value(el, 'divisions'));
          if (!Number.isFinite(divisions) || divisions <= 0) fail('divisionsが不正です。');
          const meter = child(el, 'time');
          if (meter) {
            const beats = Number(value(meter, 'beats')), unit = Number(value(meter, 'beat-type'));
            if (!Number.isFinite(beats) || beats <= 0 || ![1, 2, 4, 8, 16, 32].includes(unit)) fail('この拍子表記には対応していません。');
            nominal = beats * 4 / unit;
            if (nominal !== 4) warnings.add('4/4の16拍グリッドに並べ直します。');
          }
          if (child(el, 'transpose')) fail('移調楽器は実音（concert pitch）のMusicXMLで書き出してください。');
        } else if (el.localName === 'backup' || el.localName === 'forward') {
          const duration = Number(value(el, 'duration')) / divisions;
          if (!Number.isFinite(duration) || duration < 0) fail('拍の移動量が不正です。');
          cursor += el.localName === 'backup' ? -duration : duration;
          if (cursor < -1e-7) fail('小節の先頭より前へのbackupがあります。');
          cursor = Math.max(0, cursor); end = Math.max(end, cursor);
        } else if (el.localName === 'direction' || el.localName === 'sound') {
          const sound = el.localName === 'sound' ? el : child(el, 'sound');
          let tempo = Number(sound?.getAttribute('tempo'));
          if (!tempo) {
            const metro = child(child(el, 'direction-type') || el, 'metronome');
            if (metro) {
              const unit = { whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25 }[value(metro, 'beat-unit')];
              const dots = children(metro, 'beat-unit-dot').length;
              tempo = Number(value(metro, 'per-minute')) * unit * (2 - 2 ** -dots);
            }
          }
          if (Number.isFinite(tempo) && tempo > 0) {
            if (bpm === null) bpm = tempo;
            else if (Math.abs(tempo - bpm) > 0.1) warnings.add('テンポ変化は省略し、最初のテンポで演奏します。');
          }
        } else if (el.localName === 'note') {
          if (child(el, 'grace')) { warnings.add('装飾音は省略します。'); continue; }
          const duration = Number(value(el, 'duration')) / divisions;
          if (!Number.isFinite(duration) || duration <= 0) fail('音符のdurationが不正です。');
          const chord = Boolean(child(el, 'chord'));
          const onset = chord ? previousOnset : cursor;
          if (!chord) { previousOnset = cursor; cursor += duration; }
          end = Math.max(end, onset + duration);
          if (child(el, 'rest')) continue;
          const pitch = child(el, 'pitch');
          if (!pitch) { warnings.add('打楽器など音高のない音符は省略します。'); continue; }
          const step = value(pitch, 'step'), octave = Number(value(pitch, 'octave', 'NaN')), alter = Number(value(pitch, 'alter', '0'));
          const midi = (octave + 1) * 12 + pitchClass[step] + alter;
          if (!Number.isInteger(octave) || !Number.isInteger(alter) || !Number.isInteger(midi) || midi < 0 || midi > 127) fail('音高が不正、または微分音を含んでいます。');
          const start = base + onset;
          const key = `${midi}:${value(el, 'voice', '1')}:${value(el, 'staff', '1')}`;
          const types = children(el, 'tie').map(t => t.getAttribute('type'));
          const previous = types.includes('stop') ? ties.get(key) : null;
          let note;
          if (previous && Math.abs(previous.start + previous.duration - start) < 1e-6) {
            previous.duration += duration; note = previous;
          } else {
            note = { midi, start, duration, velocity: 0.75 };
            notes.push(note);
          }
          if (types.includes('start')) ties.set(key, note); else ties.delete(key);
          if (notes.length > 4096) fail('音符が多すぎます。短いフレーズを書き出してください。');
        } else if (el.localName === 'barline' && child(el, 'repeat')) warnings.add('繰り返し記号は展開せず、記譜順に読み込みます。');
      }
      base += measure.getAttribute('implicit') === 'yes' ? end : Math.max(nominal, end);
    }
  }
  const excerpt = notes.filter(n => n.start < 16 && n.start >= 0).map(n => ({ ...n, duration: Math.min(n.duration, 16 - n.start) })).sort((a, b) => a.start - b.start || b.midi - a.midi);
  if (!excerpt.length) fail('先頭16拍に演奏できる音符がありません。');
  if (excerpt.length > 1024) fail('先頭16拍の音符が多すぎます（上限1024音）。');
  if (bpm !== null && (bpm < 40 || bpm > 180)) warnings.add('テンポを40〜180 BPMの範囲に調整しました。');
  return { title: title || name.slice(0, 80), notes: excerpt, bpm: Math.round(Math.min(180, Math.max(40, bpm || 120))), warnings: [...warnings] };
}

/** A deterministic, explicit music encoding. Quantum outcomes do not alter pitch mapping. */
export function encodeNotes(notes) {
  const rounded = notes.map(n => ({ ...n, start: Math.round(n.start), end: Math.max(Math.round(n.start) + 1, Math.round(n.start + n.duration)) }));
  let omitted = 0;
  const steps = Array.from({ length: 16 }, (_, step) => {
    const active = [...new Set(rounded.filter(n => n.start <= step && n.end > step).map(n => n.midi))].sort((a, b) => b - a);
    omitted += Math.max(0, active.length - 5);
    const chosen = active.slice(0, 5), mask = (1 << chosen.length) - 1;
    const root = chosen[0] ?? 60;
    const pitches = [...chosen];
    // Fill unused lanes with nearby chord tones, available to quantum remix gates.
    for (const delta of [0, -12, 7, 4, 12, -5, -8, 19, -24, 24]) {
      if (pitches.length >= 5) break;
      const pitch = Math.min(127, Math.max(0, root + delta));
      if (!pitches.includes(pitch)) pitches.push(pitch);
      if (pitches.length === 5) break;
    }
    for (let p = 0; pitches.length < 5; p++) if (!pitches.includes(p)) pitches.push(p);
    return { pitches, mask };
  });
  return { steps, omitted, quantized: notes.filter(n => Math.abs(n.start - Math.round(n.start)) > 1e-6 || Math.abs(n.duration - Math.round(n.duration)) > 1e-6).length };
}

/** Public-domain melodies, newly entered and arranged here; not third-party recordings. */
export function demoScore(kind = 'ode') {
  const melody = kind === 'twinkle'
    ? [[60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2], [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2]]
    : [[64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1], [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2]];
  let start = 0;
  const notes = melody.map(([midi, duration]) => { const n = { midi, start, duration, velocity: 0.8 }; start += duration; return n; });
  // A sparse left-hand accompaniment gives the A/B comparison a piano texture.
  [48, 43, 45, 43].forEach((midi, i) => notes.push({ midi, start: i * 4, duration: 4, velocity: 0.45 }));
  return { title: kind === 'twinkle' ? 'きらきら星 · ピアノスケッチ' : '歓喜の歌 · ピアノスケッチ', bpm: 120, notes, warnings: ['原曲の旋律に、このアプリ独自の簡単な左手伴奏を付けた4小節の譜例です。'] };
}
