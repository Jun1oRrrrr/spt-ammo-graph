const CALIBER_COLORS = new Map([
  ['Caliber9x18PM', '#ef4444'],
  ['Caliber9x19PARA', '#f97316'],
  ['Caliber762x25TT', '#eab308'],
  ['Caliber1143x23ACP', '#84cc16'],
  ['Caliber9x21', '#22c55e'],
  ['Caliber9x39', '#14b8a6'],
  ['Caliber9x33R', '#06b6d4'],
  ['Caliber46x30', '#0ea5e9'],
  ['Caliber57x28', '#6366f1'],
  ['Caliber127x33', '#8b5cf6'],
  ['Caliber545x39', '#d946ef'],
  ['Caliber556x45NATO', '#ec4899'],
  ['Caliber762x35', '#f43f5e'],
  ['Caliber762x39', '#fb923c'],
  ['Caliber366TKM', '#facc15'],
  ['Caliber762x51', '#a3e635'],
  ['Caliber762x54R', '#2dd4bf'],
  ['Caliber127x55', '#38bdf8'],
  ['Caliber68x51', '#818cf8'],
  ['Caliber86x70', '#c084fc'],
  ['Caliber127x108', '#e879f9'],
  ['Caliber127x99', '#f0abfc'],
  ['Caliber12g', '#60a5fa'],
  ['Caliber20g', '#34d399'],
  ['Caliber23x75', '#4ade80'],
  ['Caliber26x75', '#a78bfa'],
  ['Caliber30x29', '#f87171'],
  ['Caliber40x46', '#fb7185'],
  ['Caliber40mmRU', '#fbbf24'],
  ['Caliber20x1mm', '#94a3b8'],
  ['Caliber725', '#e2e8f0'],
  ['Caliber9x39', '#14b8a6'],
  ['Caliber762x25TT', '#eab308'],
]);

function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hashColor(str) {
  const palette = [
    '#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa',
    '#22d3ee', '#fb923c', '#a3e635', '#e879f9', '#4ade80',
    '#f87171', '#818cf8', '#facc15', '#2dd4bf', '#f43f5e',
    '#38bdf8', '#c084fc', '#4ade80', '#f0abfc', '#fb7185',
  ];
  return palette[hashCode(str) % palette.length];
}

function colorForCaliber(caliber) {
  return CALIBER_COLORS.get(caliber) || hashColor(caliber);
}

function friendlyCaliber(caliber) {
  return caliber.replace(/^Caliber/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/x/g, '×')
    .replace(/(\d+)×(\d+)/, '$1×$2');
}

let DATA = { rows: [], source: '' };
let currentCalibers = new Set();
let allCalibers = [];
let editedMap = new Map();
let searchTerm = '';
let selectedTpl = null;
let dragState = null;
let state = {
  editMode: 'damage',
  onlyEdited: false,
  logScale: false,
  showGrid: true,
  showPenBands: true,
};
let ranges = { x: [0, 1], y: [0, 1] };
let svg = null;
let colorScale = {};

const MARGIN = { top: 24, right: 64, bottom: 52, left: 58 };

function isEditable(row) {
  if (!row || !Number.isFinite(Number(row.damage)) || !Number.isFinite(Number(row.penetration))) return false;
  const p = Number(row.penetration);
  if (p > 60) return false;
  if (Number(row.damagePerProjectile) < 1 || Number(row.projectileCount) > 15) return false;
  return true;
}

function axisValue(row, key) {
  if (key === 'x') return Number(row.damagePerProjectile);
  return Number(row.penetration);
}

function editedValue(tpl, key) {
  const edit = editedMap.get(tpl);
  if (!edit) return null;
  if (key === 'x') return edit.damagePerProjectile;
  return edit.penetration;
}

function effectiveDamage(row) {
  const edit = editedMap.get(row.tpl);
  const value = edit && edit.damagePerProjectile !== undefined ? edit.damagePerProjectile : row.damagePerProjectile;
  return Number(value);
}

function effectivePenetration(row) {
  const edit = editedMap.get(row.tpl);
  const value = edit && edit.penetration !== undefined ? edit.penetration : row.penetration;
  return Number(value);
}

function currentDamage(row) {
  return editedMap.has(row.tpl) ? effectiveDamage(row) : Number(row.damagePerProjectile);
}

function currentPenetration(row) {
  return editedMap.has(row.tpl) ? effectivePenetration(row) : Number(row.penetration);
}

function rowName(row) {
  const edit = editedMap.get(row.tpl);
  if (!edit) return row.name;
  return edit.name || row.name;
}

function buildData() {
  if (!Array.isArray(DATA.rows)) return [];
  const calibers = new Set(DATA.rows.map((r) => r.caliber).filter(Boolean));
  allCalibers = [...calibers].sort((a, b) => friendlyCaliber(a).localeCompare(friendlyCaliber(b)));
  colorScale = {};
  allCalibers.forEach((c, i) => {
    colorScale[c] = colorForCaliber(c);
  });
  if (currentCalibers.size === 0) {
    currentCalibers = new Set(allCalibers);
  } else {
    const next = new Set();
    for (const c of currentCalibers) if (calibers.has(c)) next.add(c);
    if (next.size === 0) next.add(allCalibers[0]);
    currentCalibers = next;
  }
}

function filteredRows() {
  const rows = DATA.rows.filter((r) => currentCalibers.has(r.caliber));
  const term = searchTerm.trim().toLowerCase();
  const shown = term
    ? rows.filter((r) => rowName(r).toLowerCase().includes(term) || r.tpl.toLowerCase().includes(term))
    : rows;
  return shown.filter((r) => !state.onlyEdited || editedMap.has(r.tpl));
}

function hasPointValue(row, key) {
  if (editedMap.has(row.tpl)) return true;
  if (key === 'x') return Number.isFinite(row.damagePerProjectile) && row.damagePerProjectile > 0;
  return Number.isFinite(row.penetration) && row.penetration >= 0;
}

function currentXLabel() {
  return '伤害';
}

function currentYLabel() {
  return '穿透';
}

function setRangeForRows(rows) {
  const pts = rows.filter((r) => hasPointValue(r, 'x') && hasPointValue(r, 'y'));
  if (!pts.length) {
    ranges = { x: [0, 300], y: [0, 100] };
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of pts) {
    const x = Number(axisValue(r, 'x'));
    const y = Number(axisValue(r, 'y'));
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  if (minX === maxX) maxX += 10;
  if (minY === maxY) maxY += 10;
  const padX = (maxX - minX) * 0.06 + 1;
  const padY = (maxY - minY) * 0.06 + 1;
  ranges = {
    x: [Math.max(0, minX - padX), maxX + padX],
    y: [Math.max(0, minY - padY), maxY + padY],
  };
}

function niceSteps(range) {
  const diff = range[1] - range[0];
  if (diff <= 0) return [];
  const rough = diff / 8;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  let step = mag;
  for (const m of [1, 2, 5, 10]) {
    if (rough <= mag * m) {
      step = mag * m;
      break;
    }
  }
  const result = [];
  const start = Math.ceil(range[0] / step) * step;
  for (let v = start; v <= range[1] + step * 0.001; v += step) {
    result.push(Math.round(v * 1000) / 1000);
  }
  return result;
}

function drawChart() {
  const wrap = document.getElementById('chartWrap');
  const width = Math.max(wrap.clientWidth, 300);
  const height = Math.max(wrap.clientHeight, 280);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const rows = filteredRows();
  setRangeForRows(rows);
  const [minX, maxX] = ranges.x;
  const [minY, maxY] = ranges.y;

  const xScale = state.logScale ? (v) => {
    if (v <= 0) return MARGIN.left;
    const lo = Math.log10(Math.max(minX, 0.1));
    const hi = Math.log10(Math.max(maxX, 1));
    const t = (Math.log10(v) - lo) / (hi - lo || 1);
    return MARGIN.left + Math.max(0, Math.min(1, t)) * innerW;
  } : (v) => MARGIN.left + ((v - minX) / (maxX - minX || 1)) * innerW;
  const yScale = state.logScale ? (v) => {
    if (v < 0) return height - MARGIN.bottom;
    const lo = Math.log10(Math.max(minY, 0.1));
    const hi = Math.log10(Math.max(maxY, 1));
    const t = (Math.log10(Math.max(v, 0.1)) - lo) / (hi - lo || 1);
    return height - MARGIN.bottom - Math.max(0, Math.min(1, t)) * innerH;
  } : (v) => height - MARGIN.bottom - ((v - minY) / (maxY - minY || 1)) * innerH;

  let html = '';
  const gridColor = '#26303d';
  if (state.showGrid) {
    for (const v of niceSteps([minX, maxX])) {
      const x = xScale(v);
      if (!Number.isFinite(x)) continue;
      html += `<line x1="${x}" y1="${MARGIN.top}" x2="${x}" y2="${height - MARGIN.bottom}" stroke="${gridColor}" stroke-width="1"></line>`;
    }
    for (const v of niceSteps([minY, maxY])) {
      const y = yScale(v);
      if (!Number.isFinite(y)) continue;
      html += `<line x1="${MARGIN.left}" y1="${y}" x2="${width - MARGIN.right}" y2="${y}" stroke="${gridColor}" stroke-width="1"></line>`;
    }
  }

  if (state.showPenBands) {
    const bands = [
      { threshold: 10, label: 'Class I', color: '#64748b' },
      { threshold: 20, label: 'Class II', color: '#3b82f6' },
      { threshold: 30, label: 'Class III', color: '#6366f1' },
      { threshold: 40, label: 'Class IV', color: '#a855f7' },
      { threshold: 50, label: 'Class V', color: '#ec4899' },
      { threshold: 60, label: 'Class VI', color: '#ef4444' },
    ];
    let lastY = yScale(0);
    if (!Number.isFinite(lastY)) lastY = height - MARGIN.bottom;
    for (const band of bands) {
      const yy = yScale(band.threshold);
      if (!Number.isFinite(yy)) continue;
      const between = Math.min(lastY, yy);
      const span = Math.abs(yy - lastY);
      if (span < 0.5) continue;
      html += `<rect x="${MARGIN.left}" y="${between}" width="${innerW}" height="${span}" fill="${band.color}" fill-opacity="0.05"></rect>`;
      html += `<line x1="${MARGIN.left}" y1="${yy}" x2="${width - MARGIN.right}" y2="${yy}" stroke="${band.color}" stroke-width="1" stroke-dasharray="4 4" opacity="0.7"></line>`;
      html += `<text x="${width - MARGIN.right + 5}" y="${yy + 3}" fill="${band.color}" font-size="10">${band.label}</text>`;
      lastY = yy;
    }
  }

  const shownRows = rows;
  for (const r of shownRows) {
    const edit = editedMap.get(r.tpl);
    const x = effectiveDamage(r);
    const y = effectivePenetration(r);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!editedMap.has(r.tpl) && (!hasPointValue(r, 'x') || !hasPointValue(r, 'y'))) continue;
    const px = xScale(x);
    const py = yScale(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const edited = !!edit;
    const color = edited ? '#fbbf24' : (colorScale[r.caliber] || '#888');
    const selected = r.tpl === selectedTpl;
    const radius = edited ? 6.5 : selected ? 7.5 : 5;
    html += `<circle data-tpl="${r.tpl}" cx="${px}" cy="${py}" r="${radius}" fill="${color}" fill-opacity="${edited ? 0.9 : 0.75}" stroke="${selected ? '#ffffff' : color}" stroke-width="${selected ? 2 : 1.2}" data-edited="${edited ? '1' : '0'}"></circle>`;
  }

  html += `<line x1="${MARGIN.left}" y1="${height - MARGIN.bottom}" x2="${width - MARGIN.right}" y2="${height - MARGIN.bottom}" stroke="#7d8fa1" stroke-width="1.5"></line>`;
  html += `<line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${height - MARGIN.bottom}" stroke="#7d8fa1" stroke-width="1.5"></line>`;

  for (const v of niceSteps([minX, maxX])) {
    const x = xScale(v);
    if (!Number.isFinite(x)) continue;
    html += `<text x="${x}" y="${height - MARGIN.bottom + 18}" fill="#8b98a9" font-size="11" text-anchor="middle">${v}</text>`;
  }
  for (const v of niceSteps([minY, maxY])) {
    const y = yScale(v);
    if (!Number.isFinite(y)) continue;
    html += `<text x="${MARGIN.left - 8}" y="${y + 3}" fill="#8b98a9" font-size="11" text-anchor="end">${v}</text>`;
  }

  svg.innerHTML = html;
  svg.__xScale = {
    fn: xScale,
    invert: state.logScale ? invertLog(ranges.x, innerW, MARGIN.left) : invertLinear(ranges.x, innerW, MARGIN.left),
  };
  svg.__yScale = {
    fn: yScale,
    invert: state.logScale ? invertLog(ranges.y, innerH, height - MARGIN.bottom) : invertLinear(ranges.y, innerH, height - MARGIN.bottom),
  };
  svg.__rows = shownRows;
  svg.__innerW = innerW;
  svg.__innerH = innerH;

  document.getElementById('modeTitle').textContent = state.editMode === 'damage' ? '威力' : state.editMode === 'pen' ? '穿透' : '双向';
  document.getElementById('selectionInfo').textContent = selectedTpl ? `已选 ${editedName(selectedTpl)}` : '未选中';
  updateLegend();
}

function editedName(tpl) {
  const row = DATA.rows.find((r) => r.tpl === tpl);
  return row ? rowName(row) : tpl;
}

function updateLegend() {
  const legendRow = document.getElementById('legendRow');
  const active = allCalibers.filter((c) => currentCalibers.has(c));
  const html = active
    .map((c) => {
      const color = colorScale[c] || '#888';
      return `<span class="legend-chip"><span class="dot" style="background:${color}"></span>${friendlyCaliber(c)}</span>`;
    })
    .join('');
  legendRow.innerHTML = html || '<span class="muted">无口径显示</span>';
}

function renderCaliberChips() {
  const list = document.getElementById('caliberList');
  const term = document.getElementById('caliberSearch').value.trim().toLowerCase();
  const shown = allCalibers.filter((c) => friendlyCaliber(c).toLowerCase().includes(term));
  list.innerHTML = shown
    .map((c) => `<span class="chip ${currentCalibers.has(c) ? 'on' : ''}" data-caliber="${c}"><span class="dot" style="background:${colorScale[c] || '#667'}"></span>${friendlyCaliber(c)}<span class="count">${DATA.rows.filter((r) => r.caliber === c).length}</span></span>`)
    .join('');
}

function renderList() {
  const rows = filteredRows().slice();
  rows.sort((a, b) => {
    const ae = editedMap.has(a.tpl) ? 1 : 0;
    const be = editedMap.has(b.tpl) ? 1 : 0;
    return be - ae;
  });
  const el = document.getElementById('ammoList');
  if (!rows.length) {
    el.innerHTML = '<div class="empty-detail">没有匹配的弹药</div>';
    return;
  }
  const cap = state.onlyEdited ? rows.length : Math.min(rows.length, 400);
  el.innerHTML = rows.slice(0, cap).map((r) => {
    const edit = editedMap.get(r.tpl);
    const d = effectiveDamage(r);
    const p = effectivePenetration(r);
    const edited = !!edit;
    const color = edited ? '#fbbf24' : (colorScale[r.caliber] || '#888');
    return `<div class="ammo-row ${r.tpl === selectedTpl ? 'selected' : ''} ${edited ? 'edited' : ''}" data-tpl="${r.tpl}">
      <span class="row-color" style="background:${color}"></span>
      <span class="row-name">${escapeHtml(r.short)}</span>
      <span class="row-values">${Math.round(d)} / ${Math.round(p)}</span>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function renderInspector() {
  const row = DATA.rows.find((r) => r.tpl === selectedTpl);
  const block = document.getElementById('detailBlock');
  const empty = document.getElementById('detailEmpty');
  const body = document.getElementById('detailBody');
  if (!row) {
    empty.classList.remove('hidden');
    body.classList.add('hidden');
    return;
  }
  empty.classList.add('hidden');
  body.classList.remove('hidden');
  const edit = editedMap.get(row.tpl);
  const d = effectiveDamage(row);
  const p = effectivePenetration(row);
  const editable = isEditable(row);
  body.innerHTML = `
    <h3>${escapeHtml(rowName(row))}</h3>
    <div class="detail-meta">${escapeHtml(friendlyCaliber(row.caliber))} · ${row.tpl}</div>
    <dl class="kv-table">
      <dt>总伤害</dt><dd><b>${Math.round(row.damage)}</b></dd>
      <dt>弹片数</dt><dd>${row.projectileCount}</dd>
      <dt>单发威力</dt><dd><b>${d.toFixed(1)}</b>${edit ? ' <span class="warn">已改</span>' : ''}</dd>
      <dt>穿透</dt><dd><b>${p.toFixed(1)}</b>${edit ? ' <span class="warn">已改</span>' : ''}</dd>
      ${editable ? '<dt>拖拽</dt><dd>可编辑</dd>' : '<dt>拖拽</dt><dd class="warn">锁定</dd>'}
    </dl>`;
}

function renderStatus() {
  const box = document.getElementById('statusBox');
  const n = editedMap.size;
  if (n === 0) {
    box.textContent = '未修改';
    box.classList.remove('dirty');
  } else {
    box.textContent = `${n} 种弹药已修改`;
    box.classList.add('dirty');
  }
}

function renderAll() {
  renderCaliberChips();
  renderList();
  renderInspector();
  renderStatus();
  drawChart();
}

function renderChartAndStatus() {
  renderStatus();
  drawChart();
}

function showToast(message, ms = 2600) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toast.__timer);
  toast.__timer = setTimeout(() => toast.classList.add('hidden'), ms);
}

function setEdit(tpl, opts) {
  const row = DATA.rows.find((r) => r.tpl === tpl);
  if (!row || !isEditable(row)) return false;
  const edit = editedMap.get(tpl) || {};
  const origDamage = Number(row.damagePerProjectile);
  const origPen = Number(row.penetration);
  const storedDamage = edit.damagePerProjectile !== undefined ? Number(edit.damagePerProjectile) : origDamage;
  const storedPen = edit.penetration !== undefined ? Number(edit.penetration) : origPen;
  const nextDamage = opts.damagePerProjectile !== undefined ? Number(opts.damagePerProjectile) : storedDamage;
  const nextPen = opts.penetration !== undefined ? Number(opts.penetration) : storedPen;
  const changed = nextDamage !== origDamage || nextPen !== origPen;
  if (!changed) {
    editedMap.delete(tpl);
  } else {
    if (opts.damagePerProjectile !== undefined) {
      edit.damagePerProjectile = nextDamage;
      edit.damage = Number((nextDamage * row.projectileCount).toFixed(1));
    } else if (edit.damagePerProjectile === undefined) {
      edit.damagePerProjectile = origDamage;
      edit.damage = row.damage;
    }
    if (opts.penetration !== undefined) {
      edit.penetration = nextPen;
    } else if (edit.penetration === undefined) {
      edit.penetration = origPen;
    }
    if (!edit.name) edit.name = row.name;
    editedMap.set(tpl, edit);
  }
  return true;
}

function updateRow(tpl, x, y) {
  const row = DATA.rows.find((r) => r.tpl === tpl);
  if (!row || !isEditable(row)) return false;
  const changed = setEdit(tpl, {
    damagePerProjectile: Number(x),
    penetration: Number(y),
  });
  if (changed) showToast(`${row.short} → ${x.toFixed(1)} / ${y.toFixed(1)}`, 900);
  renderAll();
  return true;
}

function pointFromEvent(event) {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scaleX = vb.width / rect.width;
  const scaleY = vb.height / rect.height;
  const mx = (event.clientX - rect.left) * scaleX;
  const my = (event.clientY - rect.top) * scaleY;
  const xScale = svg.__xScale;
  const yScale = svg.__yScale;
  if (!xScale || !yScale) return null;
  return { mx, my, x: xScale.fn, y: yScale.fn };
}

function findNearest(mx, my, maxPx = 20) {
  const rows = svg.__rows || [];
  const xScale = svg.__xScale.fn;
  const yScale = svg.__yScale.fn;
  let best = null;
  let bestDist = Infinity;
  for (const r of rows) {
    const edit = editedMap.get(r.tpl);
    const x = effectiveDamage(r);
    const y = effectivePenetration(r);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (!editedMap.has(r.tpl) && (!hasPointValue(r, 'x') || !hasPointValue(r, 'y'))) continue;
    const px = xScale(x);
    const py = yScale(y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const dist = Math.hypot(px - mx, py - my);
    if (dist < bestDist) {
      bestDist = dist;
      best = r;
    }
  }
  return bestDist <= maxPx ? best : null;
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  const pt = pointFromEvent(event);
  if (!pt) return;
  const row = findNearest(pt.mx, pt.my);
  if (!row) {
    selectedTpl = null;
    renderInspector();
    renderList();
    drawChart();
    return;
  }
  selectedTpl = row.tpl;
  if (isEditable(row)) {
    dragState = { row, startX: pt.mx, startY: pt.my };
    svg.classList.add('dragging');
    const hint = document.getElementById('dragHint');
    hint.classList.remove('hidden');
    hint.textContent = `拖动：${row.short}`;
  }
  renderInspector();
  renderList();
  drawChart();
}

function onPointerMove(event) {
  if (!dragState) return;
  const pt = pointFromEvent(event);
  if (!pt) return;
  const row = dragState.row;
  if (selectedTpl !== row.tpl) {
    selectedTpl = row.tpl;
    renderInspector();
    renderList();
    drawChart();
  }
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const mx = (event.clientX - rect.left) * (vb.width / rect.width);
  const my = (event.clientY - rect.top) * (vb.height / rect.height);
  const inside = mx >= MARGIN.left && mx <= vb.width - MARGIN.right && my >= MARGIN.top && my <= vb.height - MARGIN.bottom;
  if (!inside) return;
  const x = svg.__xScale.invert(mx);
  const y = svg.__yScale.invert(my);
  let newX = Number(row.damagePerProjectile);
  let newY = Number(row.penetration);
  newX = currentDamage(row);
  newY = currentPenetration(row);
  if (state.editMode === 'damage' || state.editMode === 'both') {
    newX = Math.max(1, x);
  }
  if (state.editMode === 'pen' || state.editMode === 'both') {
    newY = Math.max(0, Math.min(60, Math.round(y)));
  }
  const changed = setEdit(row.tpl, { damagePerProjectile: newX, penetration: newY });
  if (changed) renderChartAndStatus();
}

function onPointerUp() {
  if (dragState) {
    dragState = null;
    svg.classList.remove('dragging');
    document.getElementById('dragHint').classList.add('hidden');
    renderAll();
  }
}

function invertLinear(range, innerLen, from) {
  return (px) => {
    const t = (px - from) / (innerLen || 1);
    return range[0] + t * (range[1] - range[0]);
  };
}

function invertLog(range, innerLen, from) {
  return (px) => {
    const t = (px - from) / (innerLen || 1);
    const lo = Math.log10(Math.max(range[0], 0.1));
    const hi = Math.log10(Math.max(range[1], 1));
    return Math.pow(10, lo + t * (hi - lo));
  };
}

function onSearchInput() {
  searchTerm = document.getElementById('searchInput').value;
  renderList();
}

function selectVisible() {
  const rows = filteredRows();
  currentCalibers = new Set(rows.map((r) => r.caliber));
  renderAll();
}

function selectAllCalibers() {
  currentCalibers = new Set(allCalibers);
  renderAll();
}

function toggleCaliber(c) {
  if (currentCalibers.has(c)) {
    if (currentCalibers.size > 1) currentCalibers.delete(c);
  } else {
    currentCalibers.add(c);
  }
  renderAll();
}

function clearAllEdits() {
  editedMap.clear();
  renderAll();
}

function editsToPatch() {
  const edits = [];
  for (const [tpl, edit] of editedMap) {
    const row = DATA.rows.find((r) => r.tpl === tpl);
    if (!row) continue;
    const damage = Number.isFinite(Number(edit.damage)) ? Number(edit.damage) : Number(row.damage);
    const penetration = Number.isFinite(Number(edit.penetration)) ? Number(edit.penetration) : Number(row.penetration);
    edits.push({ tpl, name: edit.name || row.name, damage, penetration });
  }
  edits.sort((a, b) => a.tpl.localeCompare(b.tpl));
  return {
    source: DATA.source || 'SPT ammo data snapshot',
    generated: new Date().toISOString(),
    edits,
  };
}

function downloadPatch() {
  const patch = editsToPatch();
  const blob = new Blob([JSON.stringify(patch, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ammo_edits.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('补丁已下载：ammo_edits.json');
}

function currentRowForZoom() {
  return filteredRows();
}

function keyboardSelect(event) {
  const row = DATA.rows.find((r) => r.tpl === selectedTpl);
  if (!row || !isEditable(row)) return;
  const step = event.shiftKey ? 5 : 1;
  let dx = 0;
  let dy = 0;
  if (event.key === 'ArrowLeft') dx = -step;
  else if (event.key === 'ArrowRight') dx = step;
  else if (event.key === 'ArrowUp') dy = step;
  else if (event.key === 'ArrowDown') dy = -step;
  else if (event.key === 'Delete' || event.key === 'Backspace') {
    editedMap.delete(row.tpl);
    renderAll();
    showToast(`已清除 ${row.short} 的修改`);
    return;
  } else {
    return;
  }
  event.preventDefault();
  const curDamage = currentDamage(row);
  const curPen = currentPenetration(row);
  const nextDamage = state.editMode === 'damage' || state.editMode === 'both'
    ? Number((curDamage + dx).toFixed(1))
    : curDamage;
  const nextPen = state.editMode === 'pen' || state.editMode === 'both'
    ? Math.max(0, Math.min(60, curPen + dy))
    : curPen;
  setEdit(row.tpl, { damagePerProjectile: nextDamage, penetration: nextPen });
  renderAll();
}

function setupEventListeners() {
  document.getElementById('searchInput').addEventListener('input', onSearchInput);
  document.getElementById('caliberSearch').addEventListener('input', renderCaliberChips);
  document.getElementById('clearCaliberBtn').addEventListener('click', () => {
    document.getElementById('caliberSearch').value = '';
    renderCaliberChips();
  });
  document.getElementById('caliberList').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (chip) toggleCaliber(chip.dataset.caliber);
  });
  document.getElementById('selectVisibleBtn').addEventListener('click', selectVisible);
  document.getElementById('selectAllCalibersBtn').addEventListener('click', selectAllCalibers);

  document.getElementById('editMode').addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.editMode = btn.dataset.mode;
    document.querySelectorAll('#editMode button').forEach((b) => b.classList.toggle('active', b === btn));
    drawChart();
  });

  document.getElementById('onlyEdited').addEventListener('change', (event) => {
    state.onlyEdited = event.target.checked;
    renderAll();
  });
  document.getElementById('logScale').addEventListener('change', (event) => {
    state.logScale = event.target.checked;
    drawChart();
  });
  document.getElementById('showGrid').addEventListener('change', (event) => {
    state.showGrid = event.target.checked;
    drawChart();
  });
  document.getElementById('showPenBands').addEventListener('change', (event) => {
    state.showPenBands = event.target.checked;
    drawChart();
  });

  svg.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('click', (event) => {
    const target = event.target.closest('circle');
    if (target && target.dataset.tpl) {
      selectedTpl = target.dataset.tpl;
      renderAll();
    }
  });
  window.addEventListener('resize', () => drawChart());
  window.addEventListener('keydown', keyboardSelect);

  document.getElementById('ammoList').addEventListener('click', (event) => {
    const rowEl = event.target.closest('.ammo-row');
    if (!rowEl) return;
    selectedTpl = rowEl.dataset.tpl;
    renderList();
    renderInspector();
    drawChart();
  });

  document.getElementById('clearEditsBtn').addEventListener('click', () => {
    clearAllEdits();
    showToast('页面修改已清空');
  });
  document.getElementById('downloadPatchBtn').addEventListener('click', downloadPatch);
  document.getElementById('resetViewBtn').addEventListener('click', () => {
    searchTerm = '';
    selectedTpl = null;
    document.getElementById('searchInput').value = '';
    selectAllCalibers();
  });
  document.getElementById('zoomResetBtn').addEventListener('click', () => {
    setRangeForRows(filteredRows());
    drawChart();
  });
}

async function loadData() {
  try {
    const response = await fetch('data.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    DATA = await response.json();
  } catch (err) {
    document.getElementById('statusBox').textContent = `数据读取失败：${err.message}`;
    return;
  }
  const sourceLine = document.getElementById('sourceLine');
  sourceLine.textContent = `${DATA.source || ''} · ${DATA.count || 0} 种弹药 · ${new Date(DATA.generated || Date.now()).toLocaleString()}`;
  buildData();
  setupEventListeners();
  renderAll();
}

document.addEventListener('DOMContentLoaded', () => {
  svg = document.getElementById('chart');
  loadData();
});
