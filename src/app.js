import { bitString, marginals } from './quantum.js';
import { SCALES, applyRemix, encoding, fromScore, hasAngle, isPair, occupied, pitchesAt, preset, putGate, validateProject } from './project.js';
import { previewSequence, recordLoop } from './sequencer.js';
import { demoScore, noteName, parseMusicXML } from './musicxml.js';
import { loadProject, saveProject } from './storage.js';
import { Player } from './audio.js';

const $ = selector => document.querySelector(selector);
const colors = ['#99b888', '#b3c798', '#d5bd98', '#b4a6ce', '#94b9bd'];
const gates = [
  ['H', 'H', '重ね合わせ', 'この拍を、半々に', 'Hでこの拍の0と1が半々に。直後に測定し、その結果を次の列へ渡します。'],
  ['X', 'X', '反転', '音と休符を入れかえる', 'この列に入ってきた0と1を反転します。'],
  ['INT', '∿', '干渉', 'H → Rz → H を1列に', '1列の中でH → Rz → H。角度によって音が残る確率を変え、その後に測定します。'],
  ['PAIR', '∞', '量子デュエット', 'H → CNOT を1列に', '同じ列の2本をクリック。H → CNOTを測定前に実行し、2音の相関をつくります。'],
  ['CNOT', '⊕', '条件付き反転', '制御が1のとき反転', '制御→標的の順にクリック。測定済みの入力では条件付き反転になり、単独でもつれは生みません。'],
  ['RZ', 'Rz', '位相だけ', 'この測定では音は不変', 'Rz単体の直後に測定しても発音確率は変わりません。位相を音に変えるには∿を使おう。'],
  ['erase', '⌫', '消しゴム', '効果を取り除く', 'ゲートをクリックして削除。楽譜モードのXによる音の準備は残ります。'],
];
const blankOutcomes = () => Array(16).fill(null);
let project = fromScore(demoScore()), activeBar = 0, activeCol = 0, selected = 'INT', angle = 60, pending = null;
let history = [], future = [], outcomes = blankOutcomes(), playingStep = -1;
let previews = previewSequence(project), encoded = encoding(project);
let saveTimer, toastTimer, ready = false, dirty = false, saveQueue = Promise.resolve(), revision = 0;
let starting = false, playbackRequest = 0, scoreImportRequest = 0, editRevision = 0;
const player = new Player();
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const percent = n => `${Math.round(n * 100)}%`;
function notify(text) {
  $('#toast').textContent = text; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function queueSave() {
  if (!ready) return;
  dirty = true; revision++; $('#save-state').textContent = '保存待ち…';
  clearTimeout(saveTimer); saveTimer = setTimeout(persist, 350);
}
function persist() {
  clearTimeout(saveTimer);
  const snapshot = structuredClone(project), savedRevision = revision;
  saveQueue = saveQueue.catch(() => {}).then(() => saveProject(snapshot)).then(() => {
    if (savedRevision === revision) { dirty = false; $('#save-state').textContent = 'このブラウザに保存済み'; }
  }).catch(() => { $('#save-state').textContent = '自動保存できません · JSON保存をご利用ください'; });
}
function stop() {
  playbackRequest++; starting = false; player.stop(); playingStep = -1;
  $('#play').innerHTML = '<span>▶</span> 量子で再生'; $('#play').setAttribute('aria-label', '再生');
  $('#playback-mode').textContent = project.source ? '同じ音色・テンポで聴き比べ' : '手描きモード';
  for (const id of ['listen-original', 'listen-quantum', 'listen-compare']) $(`#${id}`).classList.remove('listening');
  renderTabs(); renderResults(); renderScore(); highlightRoll();
}
function recompute() { previews = previewSequence(project); encoded = encoding(project); }
function change(mutator, invalidate = true) {
  stop(); editRevision++;
  history.push(structuredClone(project)); if (history.length > 60) history.shift(); future = [];
  mutator(project);
  if (invalidate) { project.recording = null; outcomes = blankOutcomes(); }
  pending = null; recompute(); render(); queueSave();
}
function restore(direction) {
  const from = direction === 'undo' ? history : future, to = direction === 'undo' ? future : history;
  if (!from.length) return;
  stop(); editRevision++; to.push(structuredClone(project)); project = from.pop(); outcomes = project.recording ? [...project.recording] : blankOutcomes();
  pending = null; recompute(); render(); queueSave();
}
function renderSource() {
  $('#source-title').textContent = project.source?.title || '手描きの量子スケッチ';
  for (const id of ['listen-original', 'listen-compare', 'detach-source']) $(`#${id}`).disabled = !project.source;
  document.querySelectorAll('[data-remix], #remix-amount').forEach(el => { el.disabled = !project.source; });
  if (!project.source) {
    $('#piano-roll').innerHTML = '<p class="empty-roll">上の曲名、または「楽譜を読み込む」から、<br>原曲との聴き比べを始められます。</p>';
    $('#conversion-summary').textContent = '手描きモード：測定結果を次の列へ引き継ぐ';
    $('#conversion-detail').textContent = '小節頭で |00000⟩ にリセット。各列でゲートを適用→同時測定→発音し、測定で確定した状態を次の列へ渡します。';
    return;
  }
  const notes = project.source.notes, min = Math.min(...notes.map(n => n.midi)), max = Math.max(min + 12, ...notes.map(n => n.midi));
  let svg = '<svg viewBox="0 0 800 126" role="img" aria-label="原曲16拍の音高と長さ。横軸は拍、縦軸は音高。"><rect id="roll-cursor" x="32" y="18" width="47" height="97" fill="#d9eace" opacity="0"/>';
  for (let i = 0; i <= 16; i++) svg += `<line x1="${32 + i * 47}" x2="${32 + i * 47}" y1="20" y2="114" stroke="${i % 4 === 0 ? '#cad4c1' : '#e6ebdf'}"/><text x="${35 + i * 47}" y="12" font-size="8" fill="#829273">${i < 16 ? i % 4 === 0 ? `BAR ${i / 4 + 1}` : '·' : ''}</text>`;
  for (let pitch = min; pitch <= max; pitch++) if (pitch % 12 === 0 || pitch === max) {
    const y = 100 - (pitch - min) / (max - min) * 73;
    svg += `<text x="0" y="${y + 3}" font-size="8" fill="#7c8d73">${noteName(pitch)}</text><line x1="32" x2="784" y1="${y}" y2="${y}" stroke="#e6ebdf"/>`;
  }
  for (const n of notes) svg += `<rect x="${32 + n.start * 47}" y="${96 - (n.midi - min) / (max - min) * 73}" width="${Math.max(2, n.duration * 47 - 2)}" height="7" rx="2" fill="${n.midi < 60 ? '#9aaf86' : '#a59bbc'}"><title>${noteName(n.midi)} · ${n.start + 1}拍目 · ${n.duration}拍</title></rect>`;
  $('#piano-roll').innerHTML = svg + '</svg>';
  const preparationCount = encoded.steps.reduce((sum, s) => sum + bitString(s.mask).split('1').length - 1, 0);
  $('#conversion-summary').textContent = `${notes.length}音 → 16列・X準備ゲート${preparationCount}個 → 毎拍リミックス`;
  $('#conversion-detail').textContent = `原曲の音高とタイミングを保存。量子版は1拍へ丸め（${encoded.quantized}音が対象）、毎拍弾き直します。5音を超える部分は高音優先で省略（延べ${encoded.omitted}音・拍）。各列のq0〜q4は高音順で、空き線にはハーモニー候補を補います。「変換のみ」を量子効果なしの基準として聴けます。${project.source.warnings.join(' ')}`;
}
function highlightRoll() {
  const cursor = $('#roll-cursor');
  if (cursor) { cursor.setAttribute('x', String(32 + Math.max(0, playingStep) * 47)); cursor.setAttribute('opacity', playingStep < 0 ? '0' : '0.65'); }
}
function renderTools() {
  $('#gate-tools').innerHTML = gates.map(([id, symbol, name, subtitle], i) => `<button class="gate-tool ${selected === id ? 'selected' : ''}" data-gate="${id}" aria-pressed="${selected === id}" aria-label="${id === 'erase' ? '消しゴム' : id + ' ' + name}"><span class="gate-symbol">${symbol}</span><span><strong>${name}</strong><small>${subtitle}</small></span><span class="key">${i + 1}</span></button>`).join('');
  $('#angle-control').hidden = !['RZ', 'INT'].includes(selected);
  $('#angle').value = angle; $('#angle-label').textContent = `${angle}°`;
  $('#tool-hint').textContent = pending ? `q${pending.q} を選択中。同じ列の標的をクリック（Escで取消）。` : gates.find(g => g[0] === selected)[4];
}
function renderTabs() {
  $('#bar-tabs').innerHTML = project.bars.map((_, i) => `<button id="tab-${i}" class="bar-tab ${Math.floor(playingStep / 4) === i ? 'playing' : ''}" role="tab" aria-selected="${activeBar === i}" aria-controls="score" tabindex="${activeBar === i ? 0 : -1}" data-bar="${i}">${String(i + 1).padStart(2, '0')} 小節</button>`).join('');
  $('#column-tabs').innerHTML = Array.from({ length: 4 }, (_, col) => `<button data-beat="${col}" aria-pressed="${col === activeCol}">${col + 1}拍目 <small>ゲート → M</small></button>`).join('');
  $('#score').setAttribute('aria-labelledby', `tab-${activeBar}`);
  $('#bar-caption').textContent = `BAR ${String(activeBar + 1).padStart(2, '0')} / BEAT ${activeCol + 1}`;
}
function renderScore() {
  const bar = project.bars[activeBar], width = Math.max(480, $('#score').clientWidth), track = (width - 72) / 4;
  let svg = `<svg viewBox="0 0 ${width} 310" aria-hidden="true">`;
  for (let q = 0; q < 5; q++) svg += `<line class="wire" x1="64" x2="${width - 3}" y1="${56 + q * 48}" y2="${56 + q * 48}"/>`;
  for (let col = 0; col < 4; col++) {
    const x = 72 + track * (col + 1) - 7;
    svg += `<line class="measurement-line" x1="${x}" x2="${x}" y1="26" y2="279"/><text class="measurement-marker" x="${x}" y="294" text-anchor="middle">M</text>`;
  }
  for (const g of bar) if (isPair(g)) svg += `<line class="cnot-wire" x1="${64 + track * (g.col + 0.5)}" x2="${64 + track * (g.col + 0.5)}" y1="${56 + g.q * 48}" y2="${56 + g.target * 48}"/>`;
  let html = svg + '</svg><div class="step-labels"><span>QUBIT</span><span>1拍</span><span>2拍</span><span>3拍</span><span>4拍</span></div>';
  for (let q = 0; q < 5; q++) {
    html += `<div class="score-row" style="top:${38 + q * 48}px"><span class="note-name"><i class="note-dot" style="background:${colors[q]}"></i>${project.source ? `q${q}` : SCALES[project.scale].notes[q]}${project.source ? '' : `<small>q${q}</small>`}</span>`;
    for (let col = 0; col < 4; col++) {
      const step = activeBar * 4 + col, pitches = pitchesAt(project, step, encoded);
      const g = bar.find(g => g.col === col && (g.q === q || (isPair(g) && g.target === q)));
      const crossing = !g && bar.some(g => g.col === col && occupied(g).includes(q));
      const symbol = g ? isPair(g) ? g.q === q ? g.type === 'PAIR' ? 'H●' : '●' : '⊕' : g.type === 'RZ' ? 'Rz' : g.type === 'INT' ? '∿' : g.type : crossing ? '·' : '+';
      const cls = g ? `${g.type} ${isPair(g) ? g.q === q ? 'control' : 'target' : ''}` : 'empty';
      const isPending = pending?.q === q && pending.col === col;
      const label = `q${q} 列${col + 1}${g ? ' ' + g.type + (hasAngle(g) ? ' ' + Math.round(g.angle * 180 / Math.PI) + '度' : '') : crossing ? ' 接続線' : ' 空き'}${project.source ? ' ' + noteName(pitches[q]) : ''}`;
      const prep = encoded && (encoded.steps[step].mask & (1 << q));
      html += `<div class="cell-group ${col === activeCol ? 'selected-column' : ''} ${step === playingStep ? 'playing-column' : ''}">${prep ? '<span class="preparation" title="元の音をXゲートで準備">X→</span>' : ''}<button class="cell ${cls} ${isPending ? 'pending' : ''}" data-q="${q}" data-col="${col}" aria-label="${label}" title="${label}">${symbol}${g && hasAngle(g) ? `<small>${Math.round(g.angle * 180 / Math.PI)}°</small>` : ''}</button>${project.source ? `<span class="cell-pitch">${noteName(pitches[q])}</span>` : ''}</div>`;
    }
    html += '</div>';
  }
  $('#score').innerHTML = html;
  $('#state-rule').textContent = project.source ? 'X→ は元の音の準備。音名は各拍の割り当て。' : '小節頭で |00000⟩。測定結果を次の列へ。';
}
function renderState() {
  const step = activeBar * 4 + activeCol, probs = previews[step], marginal = marginals(probs), pitches = pitchesAt(project, step, encoded);
  $('#state-caption').textContent = `${activeBar + 1}小節・${activeCol + 1}拍目の理論確率${project.source ? '（元の音から準備）' : '（前の測定結果で平均）'}`;
  $('#marginals').innerHTML = marginal.map((p, q) => `<div class="prob-row"><span>${noteName(pitches[q])}</span><div class="prob-track" role="meter" aria-label="q${q} ${noteName(pitches[q])} が鳴る確率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><div class="prob-fill" style="width:${p * 100}%;background:${colors[q]}"></div></div><span class="prob-value">${percent(p)}</span></div>`).join('');
  const top = probs.map((p, i) => ({ p, i })).filter(x => x.p > 1e-10).sort((a, b) => b.p - a.p).slice(0, 6);
  $('#distribution').innerHTML = top.map(({ p, i }) => `<div class="distribution-row"><code>${bitString(i)}</code><div class="distribution-bar"><i style="width:${p * 100}%"></i></div><span>${percent(p)}</span></div>`).join('');
  const types = project.bars[activeBar].filter(g => g.col === activeCol).map(g => g.type);
  const insight = types.includes('RZ') ? ['測定すると、位相は聴こえない。', 'Rzの直後に測定するだけでは確率は不変です。∿ゲートなら、1列内で干渉を起こしてから測れます。'] : types.includes('PAIR') ? ['測る前の、一瞬のもつれ。', 'PAIRはHとCNOTを1列で実行。2つの音に相関が生まれます。測定後は確定した0と1になります。'] : types.includes('INT') ? ['1拍の中で、干渉する。', '∿はH → Rz → Hの複合ゲート。角度0°なら元の音、180°なら反転。測る前の干渉が音を変えます。'] : ['毎拍、音楽が動きだす。', '各列でゲートを実行した直後に測定します。1小節に4回、4小節で16回の音の選択が生まれます。'];
  $('#insight-title').textContent = insight[0]; $('#insight-text').textContent = insight[1];
}
function renderResults() {
  $('#results').innerHTML = outcomes.map((index, step) => {
    const notes = index === null ? '未測定' : pitchesAt(project, step, encoded).filter((_, q) => index & (1 << q)).map(noteName).join(' · ') || '休符';
    return `<button data-result="${step}" class="result ${playingStep === step ? 'active' : ''}" style="--bar-duration:${60 / project.bpm}s" aria-label="${Math.floor(step / 4) + 1}小節 ${step % 4 + 1}拍の測定結果"><span>${Math.floor(step / 4) + 1}.${step % 4 + 1}</span><strong>${index === null ? '·····' : bitString(index)}</strong><small title="${escape(notes)}">${escape(notes)}</small></button>`;
  }).join('');
  $('#mode-label').innerHTML = project.recording ? '<i class="dot"></i> FIXED · 16拍の結果を再現。' : '<i class="dot"></i> LIVE · 毎拍、測定。毎ループ、変化。';
  $('#freeze').textContent = project.recording ? '◆ 固定を解除' : '◇ 演奏を固定';
  $('#freeze').setAttribute('aria-pressed', String(Boolean(project.recording)));
}
function render() {
  $('#project-title').value = project.title;
  for (const key of ['bpm', 'scale', 'style', 'voice', 'volume']) $(`#${key}`).value = project[key];
  $('#scale').disabled = Boolean(project.source); $('#scale').title = project.source ? '楽譜の音高を使用しています。各セルの音名をご覧ください。' : '';
  $('#undo').disabled = !history.length; $('#redo').disabled = !future.length;
  renderSource(); renderTools(); renderTabs(); renderScore(); renderState(); renderResults();
}
function selectTool(tool) { selected = tool; pending = null; renderTools(); renderScore(); }
function selectStep(step) { activeBar = Math.floor(step / 4); activeCol = step % 4; pending = null; renderTabs(); renderScore(); renderState(); renderTools(); }
$('#gate-tools').addEventListener('click', e => { const el = e.target.closest('[data-gate]'); if (el) selectTool(el.dataset.gate); });
$('#bar-tabs').addEventListener('click', e => { const el = e.target.closest('[data-bar]'); if (el) selectStep(Number(el.dataset.bar) * 4 + activeCol); });
$('#column-tabs').addEventListener('click', e => { const el = e.target.closest('[data-beat]'); if (el) selectStep(activeBar * 4 + Number(el.dataset.beat)); });
$('#results').addEventListener('click', e => { const el = e.target.closest('[data-result]'); if (el) selectStep(Number(el.dataset.result)); });
$('#bar-tabs').addEventListener('keydown', e => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); const bar = e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (activeBar + (e.key === 'ArrowRight' ? 1 : 3)) % 4;
  selectStep(bar * 4 + activeCol); $(`#tab-${activeBar}`).focus();
});
$('#score').addEventListener('click', e => {
  const cell = e.target.closest('[data-q]'); if (!cell) return;
  const q = Number(cell.dataset.q), col = Number(cell.dataset.col); activeCol = col;
  if (selected === 'erase') {
    if (project.bars[activeBar].some(g => g.col === col && occupied(g).includes(q))) change(p => { p.bars[activeBar] = p.bars[activeBar].filter(g => g.col !== col || !occupied(g).includes(q)); });
    else { renderTabs(); renderState(); }
    return;
  }
  if (['CNOT', 'PAIR'].includes(selected)) {
    if (!pending || pending.col !== col) { pending = { q, col }; renderTools(); renderTabs(); renderScore(); renderState(); return; }
    if (pending.q === q) { pending = null; renderTools(); renderScore(); return; }
    const gate = { type: selected, q: pending.q, target: q, col };
    change(p => { p.bars[activeBar] = putGate(p.bars[activeBar], gate); });
  } else change(p => { p.bars[activeBar] = putGate(p.bars[activeBar], { type: selected, q, col, ...(['RZ', 'INT'].includes(selected) ? { angle: angle * Math.PI / 180 } : {}) }); });
  $(`[data-q="${q}"][data-col="${col}"]`)?.focus({ preventScroll: true });
});
$('#angle').addEventListener('input', e => { angle = Number(e.target.value); $('#angle-label').textContent = `${angle}°`; });
$('#project-title').addEventListener('change', e => { const value = e.target.value.trim() || '名前のない量子スケッチ'; change(p => { p.title = value; }, false); });
for (const key of ['bpm', 'scale', 'style', 'voice']) $(`#${key}`).addEventListener('change', e => {
  const value = key === 'bpm' ? Math.round(Math.max(40, Math.min(180, Number(e.target.value) || 120))) : e.target.value;
  change(p => { p[key] = value; }, false);
});
$('#volume').addEventListener('input', e => { project.volume = Number(e.target.value); player.setVolume(project.volume); queueSave(); });
$('#undo').addEventListener('click', () => restore('undo')); $('#redo').addEventListener('click', () => restore('redo'));
$('#clear-bar').addEventListener('click', () => { if (project.bars[activeBar].length) change(p => { p.bars[activeBar] = []; }); });
function replaceProject(next) { change(p => Object.assign(p, next), false); outcomes = project.recording ? [...project.recording] : blankOutcomes(); selectStep(0); renderResults(); }
document.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => { replaceProject(preset(el.dataset.preset)); notify('毎拍測定のプリセットを開きました。元に戻せます。'); }));
document.querySelectorAll('[data-demo]').forEach(el => el.addEventListener('click', () => { replaceProject(fromScore(demoScore(el.dataset.demo))); notify('まずAの原曲、次にBの量子版を聴いてみよう。'); }));
$('#detach-source').addEventListener('click', () => { replaceProject(preset('blank')); notify('空の手描きモードを開きました。元に戻せます。'); });
document.querySelectorAll('[data-remix]').forEach(el => el.addEventListener('click', () => {
  if (!project.source) return;
  change(p => applyRemix(p, el.dataset.remix, Number($('#remix-amount').value)));
  notify(el.dataset.remix === 'faithful' ? '量子効果なし。X準備だけの1拍グリッド演奏です。' : '16列のゲートを更新しました。Bで聴いてみよう。');
}));
$('#remix-amount').addEventListener('input', e => { $('#remix-label').textContent = `${e.target.value}°`; });
$('#remix-amount').addEventListener('change', e => { const degrees = Number(e.target.value); change(p => applyRemix(p, 'gentle', degrees)); });
$('#score-import').addEventListener('click', () => $('#score-file').click());
$('#score-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const request = ++scoreImportRequest, beforeEdit = editRevision;
  try {
    if (!/\.(xml|musicxml)$/i.test(file.name)) throw new Error('非圧縮の .musicxml / .xml を選んでください。PDF・画像・MXLは未対応です。');
    if (file.size > 2_000_000) throw new Error('楽譜は2MB以下にしてください。');
    const text = await file.text(), score = parseMusicXML(text, file.name.replace(/\.[^.]+$/, ''));
    if (request !== scoreImportRequest || beforeEdit !== editRevision) { notify('読込中に編集されたため、取り込みを取り消しました。'); return; }
    replaceProject(fromScore(score)); notify('楽譜を16列に変換しました。A / Bで聴き比べできます。');
  } catch (error) { notify(error.message); }
});
async function startPlayback(mode = 'quantum') {
  if (!ready || (mode !== 'quantum' && !project.source)) return;
  stop(); const request = ++playbackRequest; starting = true;
  try {
    await player.start(structuredClone(project), ({ step, index, mode: soundingMode }) => {
      playingStep = step; activeBar = Math.floor(step / 4); activeCol = step % 4;
      if (index !== null) outcomes[step] = index;
      pending = null;
      $('#playback-mode').textContent = soundingMode === 'original' ? 'A 原曲を再生中 · 量子測定なし' : 'B 量子版を再生中 · 毎拍測定';
      renderTabs(); renderScore(); renderState(); renderResults(); highlightRoll();
    }, mode);
    if (request !== playbackRequest || !player.playing) return;
    starting = false; $('#play').innerHTML = '<span>Ⅱ</span> 停止する'; $('#play').setAttribute('aria-label', '再生を停止');
    $(`#listen-${mode}`).classList.add('listening');
  } catch { stop(); notify('音声を開始できませんでした。もう一度、再生ボタンを押してください。'); }
}
function togglePlay() { if (player.playing || starting) stop(); else startPlayback('quantum'); }
$('#play').addEventListener('click', togglePlay); $('#stop').addEventListener('click', stop);
for (const mode of ['original', 'quantum', 'compare']) $(`#listen-${mode}`).addEventListener('click', () => startPlayback(mode));
$('#measure').addEventListener('click', () => {
  stop(); outcomes = project.recording ? [...project.recording] : recordLoop(project); renderResults();
  notify(project.recording ? '固定した16拍を表示しました。' : '16列を順に測定しました。各カードから、その拍の確率を見られます。');
});
$('#freeze').addEventListener('click', () => {
  change(p => { p.recording = p.recording ? null : recordLoop(p); }, false);
  outcomes = project.recording ? [...project.recording] : blankOutcomes(); renderResults();
  notify(project.recording ? '新しく測定した16拍を固定しました。' : 'ライブ演奏に戻りました。');
});
$('#save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'quantum-beat.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('楽譜とゲートをJSONに保存しました。↑から読み込めます。');
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  const beforeEdit = editRevision;
  try {
    if (file.size > 500_000) throw new Error('プロジェクトは500KB以下にしてください。');
    const input = JSON.parse(await file.text()), imported = validateProject(input);
    if (beforeEdit !== editRevision) { notify('読込中の編集を優先し、取り込みを取り消しました。'); return; }
    replaceProject(imported);
    notify(input.version === 1 ? '旧作品を毎列測定に移行しました。以前の固定演奏は解除しました。' : '楽譜とゲートを読み込みました。');
  } catch (error) { notify(error instanceof SyntaxError ? 'JSONファイルを読み込めませんでした。' : error.message); }
});
$('#help').addEventListener('click', () => $('#help-dialog').showModal());
$('#close-help').addEventListener('click', () => $('#help-dialog').close());
$('#start-creating').addEventListener('click', () => $('#help-dialog').close());
$('#help-dialog').addEventListener('click', e => { if (e.target === $('#help-dialog')) { const r = e.target.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close(); } });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { pending = null; renderTools(); renderScore(); }
  if (e.target.closest('input,select,textarea,button,a') || $('#help-dialog').open || !ready) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); restore(e.shiftKey ? 'redo' : 'undo'); }
  if (!e.ctrlKey && !e.metaKey && gates[Number(e.key) - 1]) selectTool(gates[Number(e.key) - 1][0]);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) { if (player.playing || starting) stop(); if (dirty) persist(); } });
window.addEventListener('beforeunload', e => { if (dirty) { persist(); e.preventDefault(); e.returnValue = ''; } });
new ResizeObserver(() => renderScore()).observe($('#score'));
async function init() {
  $('#studio').inert = true; render();
  try {
    const loaded = await Promise.race([loadProject(), new Promise((_, reject) => setTimeout(() => reject(new Error('Storage timeout')), 2500))]);
    if (loaded) { project = loaded; outcomes = project.recording ? [...project.recording] : blankOutcomes(); recompute(); }
    $('#save-state').textContent = loaded ? 'このブラウザに保存済み' : 'ブラウザ内で自動保存';
  } catch { $('#save-state').textContent = '自動保存を利用できません · JSON保存が可能'; }
  ready = true; $('#studio').inert = false; render();
}
init();
