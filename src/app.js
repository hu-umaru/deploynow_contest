import { bitString, marginals, probabilities, sample, simulate } from './quantum.js';
import { SCALES, occupied, preset, putGate, validateProject } from './project.js';
import { loadProject, saveProject } from './storage.js';
import { Player } from './audio.js';

const $ = selector => document.querySelector(selector);
const colors = ['#99b888', '#b3c798', '#d5bd98', '#b4a6ce', '#94b9bd'];
const gates = [
  ['H', 'H', '重ね合わせ', '可能性をひらく', 'H を置くと、音が鳴る可能性が広がります。'],
  ['X', 'X', '反転', '0 と 1 を入れかえる', 'X は音のオン・オフを反転させます。'],
  ['RZ', 'Rz', '位相', '干渉をデザインする', 'H → Rz → H と置くと、位相の違いが音の確率に変わります。'],
  ['CNOT', '⊕', 'もつれ', 'ふたつの音をつなぐ', '制御ビット、同じ列の標的ビットの順にクリック。重ね合わせと組み合わせてもつれを作ろう。'],
  ['erase', '⌫', '消しゴム', 'もう一度、自由に', '消したいゲートをクリック。CNOTはつながりごと消えます。'],
];
let project = preset(), activeBar = 0, selected = 'H', angle = 90, pending = null;
let history = [], future = [], outcomes = [null, null, null, null], playingBar = -1;
let saveTimer, toastTimer, ready = false, dirty = false, saveQueue = Promise.resolve(), revision = 0;
let starting = false, playbackRequest = 0;
const player = new Player();
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const percent = n => `${Math.round(n * 100)}%`;
function notify(text) {
  $('#toast').textContent = text; $('#toast').classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3600);
}
function queueSave() {
  if (!ready) return;
  dirty = true; revision++;
  $('#save-state').textContent = '保存待ち…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 350);
}
function persist() {
  clearTimeout(saveTimer);
  const snapshot = structuredClone(project), savedRevision = revision;
  saveQueue = saveQueue.catch(() => {}).then(() => saveProject(snapshot)).then(() => {
    if (savedRevision === revision) { dirty = false; $('#save-state').textContent = 'このブラウザに保存済み'; }
  }).catch(() => {
    $('#save-state').textContent = '自動保存できません · JSON保存をご利用ください';
  });
}
function stop() {
  playbackRequest++; starting = false; player.stop(); playingBar = -1;
  $('#play').innerHTML = '<span>▶</span> 再生する'; $('#play').setAttribute('aria-label', '再生');
  renderTabs(); renderResults();
}
function change(mutator, invalidate = true) {
  stop();
  history.push(structuredClone(project)); if (history.length > 60) history.shift(); future = [];
  mutator(project);
  if (invalidate) { project.recording = null; outcomes = [null, null, null, null]; }
  pending = null; render(); queueSave();
}
function restore(direction) {
  const from = direction === 'undo' ? history : future, to = direction === 'undo' ? future : history;
  if (!from.length) return;
  stop(); to.push(structuredClone(project)); project = from.pop(); outcomes = project.recording ? [...project.recording] : [null, null, null, null];
  pending = null; render(); queueSave();
}
function renderTools() {
  $('#gate-tools').innerHTML = gates.map(([id, symbol, name, subtitle], i) => `<button class="gate-tool ${selected === id ? 'selected' : ''}" data-gate="${id}" aria-pressed="${selected === id}" aria-label="${id === 'erase' ? '消しゴム' : id + ' ' + name}"><span class="gate-symbol">${symbol}</span><span><strong>${name}</strong><small>${subtitle}</small></span><span class="key">${i + 1}</span></button>`).join('');
  $('#angle-control').hidden = selected !== 'RZ';
  $('#tool-hint').textContent = pending ? `q${pending.q} を選択中。同じ列の標的をクリック（Escで取消）。` : gates.find(g => g[0] === selected)[4];
}
function renderTabs() {
  $('#bar-tabs').innerHTML = project.bars.map((_, i) => `<button id="tab-${i}" class="bar-tab ${playingBar === i ? 'playing' : ''}" role="tab" aria-selected="${activeBar === i}" aria-controls="score" tabindex="${activeBar === i ? 0 : -1}" data-bar="${i}">${String(i + 1).padStart(2, '0')} 小節</button>`).join('');
  $('#score').setAttribute('aria-labelledby', `tab-${activeBar}`);
  $('#bar-caption').textContent = `BAR ${String(activeBar + 1).padStart(2, '0')}`;
}
function renderScore() {
  const bar = project.bars[activeBar];
  // The SVG uses CSS-matched coordinates from a normalized width of 1000.
  const width = Math.max(420, $('#score').clientWidth), track = (width - 122) / 4;
  let svg = `<svg viewBox="0 0 ${width} 284" aria-hidden="true">`;
  for (let q = 0; q < 5; q++) svg += `<line class="wire" x1="64" x2="${width - 19}" y1="${48 + q * 48}" y2="${48 + q * 48}"/>`;
  for (const g of bar) if (g.type === 'CNOT') svg += `<line class="cnot-wire" x1="${72 + track * (g.col + 0.5)}" x2="${72 + track * (g.col + 0.5)}" y1="${48 + g.q * 48}" y2="${48 + g.target * 48}"/>`;
  svg += '</svg>';
  let html = svg + '<div class="step-labels"><span>QUBIT / NOTE</span><span>01</span><span>02</span><span>03</span><span>04</span><span>測定</span></div>';
  for (let q = 0; q < 5; q++) {
    html += `<div class="score-row" style="top:${30 + q * 48}px"><span class="note-name"><i class="note-dot" style="background:${colors[q]}"></i>${SCALES[project.scale].notes[q]}<small>q${q}</small></span>`;
    for (let col = 0; col < 4; col++) {
      const g = bar.find(g => g.col === col && (g.q === q || (g.type === 'CNOT' && g.target === q)));
      const crossing = !g && bar.some(g => g.col === col && occupied(g).includes(q));
      const symbol = g ? g.type === 'CNOT' ? g.q === q ? '●' : '⊕' : g.type === 'RZ' ? 'Rz' : g.type : crossing ? '·' : '+';
      const cls = g ? `${g.type} ${g.type === 'CNOT' ? g.q === q ? 'control' : 'target' : ''}` : 'empty';
      const isPending = pending?.q === q && pending.col === col;
      const label = `q${q} 列${col + 1}${g ? ' ' + g.type + (g.type === 'RZ' ? ' ' + Math.round(g.angle * 180 / Math.PI) + '度' : '') : crossing ? ' CNOT接続線' : ' 空き'}`;
      html += `<button class="cell ${cls} ${isPending ? 'pending' : ''}" data-q="${q}" data-col="${col}" aria-label="${label}" title="${label}">${symbol}${g?.type === 'RZ' ? `<small>${Math.round(g.angle * 180 / Math.PI)}°</small>` : ''}</button>`;
    }
    html += '<span class="readout" title="小節の回路を適用後に測定">M</span></div>';
  }
  $('#score').innerHTML = html;
}
function renderState() {
  const state = simulate(project.bars[activeBar]), probs = probabilities(state), marginal = marginals(probs);
  $('#marginals').innerHTML = marginal.map((p, q) => `<div class="prob-row"><span>${SCALES[project.scale].notes[q]}</span><div class="prob-track" role="meter" aria-label="${SCALES[project.scale].notes[q]} が鳴る確率" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p * 100)}"><div class="prob-fill" style="width:${p * 100}%;background:${colors[q]}"></div></div><span class="prob-value">${percent(p)}</span></div>`).join('');
  const top = probs.map((p, i) => ({ p, i })).filter(x => x.p > 1e-10).sort((a, b) => b.p - a.p).slice(0, 6);
  $('#distribution').innerHTML = top.map(({ p, i }) => `<div class="distribution-row"><code>${bitString(i)}</code><div class="distribution-bar"><i style="width:${p * 100}%"></i></div><span>${percent(p)}</span><div class="phase" title="振幅の位相 ${Math.round(Math.atan2(state.im[i], state.re[i]) * 180 / Math.PI)}°" aria-label="振幅の位相"><i style="transform:rotate(${-Math.atan2(state.im[i], state.re[i])}rad)"></i></div></div>`).join('');
  const types = project.bars[activeBar].map(g => g.type);
  const insight = types.includes('RZ') ? ['位相が、音の確率に変わる。', 'Rzだけでは測定確率は変わりません。前後にHを置くと、干渉を通じて音の鳴りやすさが変わります。'] : types.includes('CNOT') ? ['一緒に鳴る、という可能性。', 'HとCNOTを組み合わせると、音同士にもつれを作れます。各音の確率だけでなく、組み合わせにも注目してみよう。'] : ['鳴らない時間も、音楽。', 'Hひとつで、鳴る・鳴らないが半分ずつに。Hをふたつ続けると、干渉で元に戻ります。'];
  $('#insight-title').textContent = insight[0]; $('#insight-text').textContent = insight[1];
}
function renderResults() {
  $('#results').innerHTML = outcomes.map((index, i) => {
    const notes = index === null ? 'まだ測定していません' : SCALES[project.scale].notes.filter((_, q) => index & (1 << q)).join(' · ') || '休符';
    return `<div class="result ${playingBar === i ? 'active' : ''}" style="--bar-duration:${240 / project.bpm}s"><span>BAR ${String(i + 1).padStart(2, '0')}</span><strong>${index === null ? '·····' : bitString(index)}</strong><small>${escape(notes)}</small></div>`;
  }).join('');
  $('#mode-label').innerHTML = project.recording ? '<i class="dot"></i> FIXED · この4小節を、もう一度。' : '<i class="dot"></i> LIVE · 毎ループ、新しい偶然。';
  $('#freeze').textContent = project.recording ? '◆ 固定を解除' : '◇ 演奏を固定';
  $('#freeze').setAttribute('aria-pressed', String(Boolean(project.recording)));
}
function render() {
  $('#project-title').value = project.title;
  for (const key of ['bpm', 'scale', 'style', 'voice', 'volume']) $(`#${key}`).value = project[key];
  $('#undo').disabled = !history.length; $('#redo').disabled = !future.length;
  renderTools(); renderTabs(); renderScore(); renderState(); renderResults();
}
function selectTool(tool) { selected = tool; pending = null; renderTools(); renderScore(); }
function selectBar(bar) { activeBar = bar; pending = null; renderTabs(); renderScore(); renderState(); renderTools(); }
$('#gate-tools').addEventListener('click', e => { const el = e.target.closest('[data-gate]'); if (el) selectTool(el.dataset.gate); });
$('#bar-tabs').addEventListener('click', e => { const el = e.target.closest('[data-bar]'); if (el) selectBar(Number(el.dataset.bar)); });
$('#bar-tabs').addEventListener('keydown', e => {
  if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault(); selectBar(e.key === 'Home' ? 0 : e.key === 'End' ? 3 : (activeBar + (e.key === 'ArrowRight' ? 1 : 3)) % 4); $(`#tab-${activeBar}`).focus();
});
$('#score').addEventListener('click', e => {
  const cell = e.target.closest('[data-q]'); if (!cell) return;
  const q = Number(cell.dataset.q), col = Number(cell.dataset.col);
  if (selected === 'erase') {
    if (project.bars[activeBar].some(g => g.col === col && occupied(g).includes(q))) change(p => { p.bars[activeBar] = p.bars[activeBar].filter(g => g.col !== col || !occupied(g).includes(q)); });
    return;
  }
  if (selected === 'CNOT') {
    if (!pending || pending.col !== col) { pending = { q, col }; renderTools(); renderScore(); return; }
    if (pending.q === q) { pending = null; renderTools(); renderScore(); return; }
    const gate = { type: 'CNOT', q: pending.q, target: q, col };
    change(p => { p.bars[activeBar] = putGate(p.bars[activeBar], gate); });
  } else change(p => { p.bars[activeBar] = putGate(p.bars[activeBar], { type: selected, q, col, ...(selected === 'RZ' ? { angle: angle * Math.PI / 180 } : {}) }); });
  // Return keyboard focus after the editor updates its cells.
  $(`[data-q="${q}"][data-col="${col}"]`)?.focus({ preventScroll: true });
});
$('#angle').addEventListener('input', e => { angle = Number(e.target.value); $('#angle-label').textContent = `${angle}°`; });
$('#project-title').addEventListener('change', e => { const value = e.target.value.trim() || '名前のない量子スケッチ'; change(p => { p.title = value; }, false); });
for (const key of ['bpm', 'scale', 'style', 'voice']) $(`#${key}`).addEventListener('change', e => {
  const value = key === 'bpm' ? Math.round(Math.max(40, Math.min(180, Number(e.target.value) || 96))) : e.target.value;
  change(p => { p[key] = value; }, false);
});
$('#volume').addEventListener('input', e => { project.volume = Number(e.target.value); player.setVolume(project.volume); queueSave(); });
$('#undo').addEventListener('click', () => restore('undo')); $('#redo').addEventListener('click', () => restore('redo'));
$('#clear-bar').addEventListener('click', () => { if (project.bars[activeBar].length) change(p => { p.bars[activeBar] = []; }); });
document.querySelectorAll('[data-preset]').forEach(el => el.addEventListener('click', () => { change(p => Object.assign(p, preset(el.dataset.preset))); activeBar = 0; render(); notify('プリセットを開きました。元に戻すこともできます。'); }));
async function togglePlay() {
  if (player.playing || starting) { stop(); return; }
  if (!ready) return;
  const request = ++playbackRequest; starting = true;
  try {
    await player.start(structuredClone(project), (bar, index) => {
      playingBar = bar; activeBar = bar; outcomes[bar] = index; pending = null;
      renderTabs(); renderScore(); renderState(); renderResults(); renderTools();
    });
    if (request !== playbackRequest || !player.playing) return;
    starting = false; $('#play').innerHTML = '<span>Ⅱ</span> 停止する'; $('#play').setAttribute('aria-label', '再生を停止');
  } catch { stop(); notify('音声を開始できませんでした。もう一度、再生ボタンを押してください。'); }
}
$('#play').addEventListener('click', togglePlay); $('#stop').addEventListener('click', stop);
$('#measure').addEventListener('click', () => {
  stop(); outcomes = project.recording ? [...project.recording] : project.bars.map(b => sample(probabilities(simulate(b)))); renderResults();
  notify(project.recording ? '固定した測定結果を表示しました。' : '4小節を測定しました。1の線の音が鳴ります。');
});
$('#freeze').addEventListener('click', () => {
  change(p => { p.recording = p.recording ? null : p.bars.map(b => sample(probabilities(simulate(b)))); }, false);
  outcomes = project.recording ? [...project.recording] : [null, null, null, null]; renderResults();
  notify(project.recording ? '新しく測定した4小節を固定しました。再生して聴いてみよう。' : 'ライブ演奏に戻りました。');
});
$('#save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'quantum-beat.json'; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('プロジェクトを書き出しました。↑ から読み込めます。');
});
$('#import').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    if (file.size > 100_000) throw new Error('ファイルが大きすぎます（上限100KB）。');
    const imported = validateProject(JSON.parse(await file.text()));
    change(p => Object.assign(p, imported), false); activeBar = 0; outcomes = project.recording ? [...project.recording] : [null, null, null, null]; render(); notify('作品を読み込みました。');
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
  // Prevent edits while loading so an old saved project cannot overwrite new work.
  $('#studio').inert = true; render();
  try {
    const loaded = await Promise.race([loadProject(), new Promise((_, reject) => setTimeout(() => reject(new Error('Storage timeout')), 2500))]);
    if (loaded) { project = loaded; outcomes = project.recording ? [...project.recording] : [null, null, null, null]; }
    $('#save-state').textContent = loaded ? 'このブラウザに保存済み' : 'ブラウザ内で自動保存';
  } catch { $('#save-state').textContent = '自動保存を利用できません · JSON保存が可能'; }
  ready = true; $('#studio').inert = false; render();
}
init();
