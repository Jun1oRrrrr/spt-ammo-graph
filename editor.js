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
let originalMap = new Map();
let searchTerm = '';
let selectedTpl = null;
let dragState = null;
let panState = null;
let suppressChartClick = false;
let state = {
  editMode: 'damage',
  onlyEdited: false,
  logScale: false,
  showGrid: true,
  showPenBands: true,
  dragLock: false,
  zoomLocked: false,
  realismMode: 'off',
};
let ranges = { x: [0, 1], y: [0, 1] };
let svg = null;
let colorScale = {};
let serverAvailable = true;
let realismMap = { source: '', rows: [] };
let realismByTpl = new Map();
let realismDamageAnchorsByTpl = new Map();

const MARGIN = { top: 24, right: 64, bottom: 52, left: 58 };
const MAX_PEN = 120;
// 1 keeps the old linear Realism map; 0 pins every round back to its original penetration.
const GLOBAL_PEN_SQUASH = 0.5;
const GLOBAL_EXCLUDED_CALIBERS = new Set([
  'Caliber20x1mm',
  'Caliber30x29',
  'Caliber40x46',
  'Caliber40mmRU',
  'Caliber725',
  'Caliber127x99',
  'Caliber127x108',
  'Caliber23x75',
]);
const GLOBAL_EXCLUDED_TPLS = new Set([
  '5996f6d686f77467977ba6cc', // MON-50 Shrapnel
]);

function isExcludedFromGlobal(row) {
  return GLOBAL_EXCLUDED_CALIBERS.has(row.caliber)
    || GLOBAL_EXCLUDED_TPLS.has(row.tpl);
}

function isEditable(row) {
  if (!row || !Number.isFinite(Number(row.damage)) || !Number.isFinite(Number(row.penetration))) return false;
  const p = Number(row.penetration);
  if (p > MAX_PEN) return false;
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

function originalValuesFor(row) {
  const stored = originalMap.get(row.tpl);
  if (stored && Number.isFinite(Number(stored.damagePerProjectile)) && Number.isFinite(Number(stored.penetration))) {
    const total = Number.isFinite(Number(stored.damage)) ? Number(stored.damage) : Number(stored.damagePerProjectile) * (Number(row.projectileCount) || 1);
    return {
      damage: total,
      damagePerProjectile: Number(stored.damagePerProjectile),
      penetration: Number(stored.penetration),
    };
  }
  return {
    damage: Number(row.damage),
    damagePerProjectile: Number(row.damagePerProjectile),
    penetration: Number(row.penetration),
  };
}

function originalDiffers(row) {
  const stored = originalMap.get(row.tpl);
  if (!stored || !row) return false;
  return Math.abs(Number(stored.damagePerProjectile) - Number(row.damagePerProjectile)) > 1e-6
    || Math.abs(Number(stored.penetration) - Number(row.penetration)) > 1e-6;
}

function readStoredOriginals() {
  try {
    const raw = localStorage.getItem('ammo_orig_map_v1');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    return Object.entries(parsed)
      .filter(([, o]) => o && Number.isFinite(Number(o.damagePerProjectile)) && Number.isFinite(Number(o.penetration)))
      .map(([tpl, o]) => [tpl, o]);
  } catch (err) {
    console.warn('stored originals not loaded', err);
    return [];
  }
}

function writeStoredOriginals() {
  try {
    localStorage.setItem('ammo_orig_map_v1', JSON.stringify(Object.fromEntries(originalMap)));
  } catch (err) {
    console.warn('originals not stored', err);
  }
}

function rememberOriginal(row) {
  if (!row || originalMap.has(row.tpl)) return;
  originalMap.set(row.tpl, {
    damage: Number(row.damage),
    damagePerProjectile: Number(row.damagePerProjectile),
    penetration: Number(row.penetration),
  });
  writeStoredOriginals();
}

async function loadOriginals(force = false) {
  const stored = readStoredOriginals();
  originalMap = new Map(stored);
  try {
    const response = await fetch(`originals.json${force ? `?t=${Date.now()}` : ''}`);
    if (!response.ok) return;
    const payload = await response.json();
    const seed = payload && payload.values;
    if (!seed || typeof seed !== 'object') return;
    const seedTpls = new Set(Object.keys(seed));
    originalMap = new Map();
    for (const [tpl, entry] of Object.entries(seed)) {
      if (!entry || !Number.isFinite(Number(entry.damagePerProjectile)) || !Number.isFinite(Number(entry.penetration))) continue;
      originalMap.set(tpl, {
        damage: Number(entry.damage),
        damagePerProjectile: Number(entry.damagePerProjectile),
        penetration: Number(entry.penetration),
      });
    }
    for (const [tpl, entry] of stored) {
      if (!seedTpls.has(tpl)) originalMap.set(tpl, entry);
    }
    writeStoredOriginals();
  } catch (err) {
    console.warn('originals snapshot not loaded', err);
  }
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
  if (state.realismMode && state.realismMode !== 'off') {
    for (const point of realismLayer(rows)) {
      pts.push({ x: point.x, y: point.y });
    }
  }
  if (!pts.length) {
    ranges = { x: [0, 300], y: [0, 100] };
    return;
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of pts) {
    const rawX = Number.isFinite(Number(r.x)) ? Number(r.x) : Number(axisValue(r, 'x'));
    const rawY = Number.isFinite(Number(r.y)) ? Number(r.y) : Number(axisValue(r, 'y'));
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) continue;
    const x = rawX;
    const y = rawY;
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

function realismModeName(mode) {
  const label = mode === 'caliber' ? '\u6309\u53e3\u5f84\u6620\u5c04' : mode === 'global' ? '\u5168\u5c40\u6620\u5c04' : '';
  return label;
}

function loadRealismMode() {
  try {
    const saved = localStorage.getItem('ammo_realism_mode');
    if (saved === 'caliber' || saved === 'global') state.realismMode = saved;
  } catch (err) {
    console.warn('realism mode not restored', err);
  }
}

function saveRealismMode() {
  try {
    localStorage.setItem('ammo_realism_mode', state.realismMode);
  } catch (err) {
    console.warn('realism mode not saved', err);
  }
}

function realismPoolRows() {
  // Keep ranges identical to the all-ammo mapping written into SPT,
  // even when the UI is filtered down to only a few calibers.
  return DATA.rows.filter((r) => realismByTpl.has(r.tpl));
}

function realismDamageAnchorRows() {
  return DATA.rows.filter((r) => realismDamageAnchorsByTpl.has(r.tpl));
}

function realismEntry(row) {
  return realismByTpl.get(row.tpl) || realismDamageAnchorsByTpl.get(row.tpl);
}

function realismTarget(row) {
  const orig = originalValuesFor(row);
  const damage = Number(orig.damagePerProjectile);
  const pen = Number(orig.penetration);
  return Number.isFinite(damage) && Number.isFinite(pen)
    ? { damagePerProjectile: damage, penetration: pen }
    : null;
}

function realismRanges(poolRows, metric = 'both') {
  if (!poolRows.length) return null;
  const includeDamage = metric === 'both' || metric === 'damage';
  const includePenetration = metric === 'both' || metric === 'penetration';
  let sourceDMin = Infinity;
  let sourceDMax = -Infinity;
  let sourcePMin = Infinity;
  let sourcePMax = -Infinity;
  let targetDMin = Infinity;
  let targetDMax = -Infinity;
  let targetPMin = Infinity;
  let targetPMax = -Infinity;
  for (const row of poolRows) {
    const entry = realismEntry(row);
    if (!entry) continue;
    const sourceDamage = Number(entry.damage);
    const sourcePen = Number(entry.penetration);
    const target = realismTarget(row);
    if (!target) continue;
    const targetDamage = target.damagePerProjectile;
    const targetPen = target.penetration;
    if (includeDamage && Number.isFinite(sourceDamage) && Number.isFinite(targetDamage)) {
      sourceDMin = Math.min(sourceDMin, sourceDamage);
      sourceDMax = Math.max(sourceDMax, sourceDamage);
      targetDMin = Math.min(targetDMin, targetDamage);
      targetDMax = Math.max(targetDMax, targetDamage);
    }
    if (includePenetration && Number.isFinite(sourcePen) && Number.isFinite(targetPen)) {
      sourcePMin = Math.min(sourcePMin, sourcePen);
      sourcePMax = Math.max(sourcePMax, sourcePen);
      targetPMin = Math.min(targetPMin, targetPen);
      targetPMax = Math.max(targetPMax, targetPen);
    }
  }
  if (includeDamage && !Number.isFinite(sourceDMin)) return null;
  if (includePenetration && !Number.isFinite(sourcePMin)) return null;
  return {
    sourceDamage: [sourceDMin, sourceDMax],
    sourcePenetration: [sourcePMin, sourcePMax],
    targetDamage: [targetDMin, targetDMax],
    targetPenetration: [targetPMin, targetPMax],
  };
}

function mapMetric(value, sourceRange, targetRange, fallback) {
  const sourceSpan = sourceRange[1] - sourceRange[0];
  if (!(sourceSpan > 0)) return Number.isFinite(fallback) ? fallback : targetRange[0];
  const t = (Number(value) - sourceRange[0]) / sourceSpan;
  const mapped = targetRange[0] + t * (targetRange[1] - targetRange[0]);
  return Math.max(targetRange[0], Math.min(targetRange[1], mapped));
}

function globalPenetration(mappedPen, targetPen) {
  if (!Number.isFinite(targetPen)) return mappedPen;
  return targetPen + (mappedPen - targetPen) * GLOBAL_PEN_SQUASH;
}

function realismLayer(shownRows) {
  const mode = state.realismMode;
  if (!mode || mode === 'off') return [];
  const pool = realismPoolRows();
  if (!pool.length) return [];
  const damageRanges = realismRanges([...pool, ...realismDamageAnchorRows()], 'damage');
  const penetrationRanges = realismRanges(pool, 'penetration');
  if (!damageRanges || !penetrationRanges) return [];
  const globalRanges = {
    sourceDamage: damageRanges.sourceDamage,
    sourcePenetration: penetrationRanges.sourcePenetration,
    targetDamage: damageRanges.targetDamage,
    targetPenetration: penetrationRanges.targetPenetration,
  };
  const perCaliberRanges = new Map();
  if (mode === 'caliber') {
    for (const caliber of new Set(pool.map((r) => r.caliber))) {
      perCaliberRanges.set(caliber, realismRanges(pool.filter((r) => r.caliber === caliber)));
    }
  }
  const points = [];
  for (const row of shownRows) {
    const entry = realismByTpl.get(row.tpl);
    if (!entry) continue;
    const ranges = mode === 'caliber'
      ? (perCaliberRanges.get(row.caliber) || globalRanges)
      : globalRanges;
    if (!ranges) continue;
    const target = realismTarget(row);
    const fallbackDamage = target ? target.damagePerProjectile : Number(row.damagePerProjectile);
    const fallbackPen = target ? target.penetration : Number(row.penetration);
    const mappedDamage = mapMetric(
      entry.damage,
      ranges.sourceDamage,
      ranges.targetDamage,
      fallbackDamage
    );
    const mappedPen = mapMetric(
      entry.penetration,
      ranges.sourcePenetration,
      ranges.targetPenetration,
      fallbackPen
    );
    if (!Number.isFinite(mappedDamage) || !Number.isFinite(mappedPen)) continue;
    const projectileCount = Number(row.projectileCount) || 1;
    const storedDamage = Math.round(mappedDamage * projectileCount) / projectileCount;
    const adjustedPen = mode === 'global'
      ? globalPenetration(mappedPen, target ? target.penetration : fallbackPen)
      : mappedPen;
    const storedPen = Math.round(adjustedPen);
    points.push({
      row,
      entry,
      x: storedDamage,
      y: storedPen,
    });
  }
  return points;
}

function syncRealismControls() {
  const el = document.getElementById('realismMode');
  if (!el) return;
  el.querySelectorAll('button').forEach((button) => {
    const active = button.dataset.realism === state.realismMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

async function loadRealismMap(force = false) {
  try {
    const response = await fetch(`realism_map.json${force ? `?t=${Date.now()}` : ''}`);
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.rows)) return;
    realismMap = payload;
    realismByTpl = new Map(
      payload.rows
        .filter((row) => !isExcludedFromGlobal(row))
        .map((row) => [row.tpl, row])
    );
    realismDamageAnchorsByTpl = new Map(
      (Array.isArray(payload.damageAnchors) ? payload.damageAnchors : [])
        .map((row) => [row.tpl, row])
    );
  } catch (err) {
    console.warn('realism map not loaded', err);
  }
}

function drawChart() {
  const wrap = document.getElementById('chartWrap');
  const width = Math.max(wrap.clientWidth, 300);
  const height = Math.max(wrap.clientHeight, 280);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;
  const rows = filteredRows();
  if (!state.dragLock && !state.zoomLocked) setRangeForRows(rows);
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
  html += `<defs><clipPath id=plotClip><rect x=${MARGIN.left} y=${MARGIN.top} width=${innerW} height=${innerH}></rect></clipPath></defs>`;
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
  const realismPoints = realismLayer(shownRows);
  for (const point of realismPoints) {
    const px = xScale(point.x);
    const py = yScale(point.y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) continue;
    const size = 3.4;
    const short = point.entry.short || point.entry.name || point.row.short;
    html += `<rect x="${px - size}" y="${py - size}" width="${size * 2}" height="${size * 2}" transform="rotate(45 ${px} ${py})" fill="#7dd3fc" fill-opacity="0.82" stroke="#0e1117" stroke-width="1" pointer-events="visiblePainted">
      <title>${escapeHtml(short)} | Realism ${point.entry.damage}/${point.entry.penetration} | ${realismModeName(state.realismMode)} ${Number(point.x.toFixed(2))}/${Number(point.y.toFixed(2))}</title>
    </rect>`;
  }
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
    const color = colorScale[r.caliber] || '#888';
    const selected = r.tpl === selectedTpl;
    const radius = edited ? 6.5 : selected ? 7.5 : 5;
    if (edited) {
      html += `<circle cx="${px}" cy="${py}" r="${radius + 2.4}" fill="none" stroke="#fbbf24" stroke-width="1.2" opacity="0.8"></circle>`;
    }
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
  svg.querySelectorAll('circle, line, rect').forEach((el) => el.setAttribute('clip-path', 'url(#plotClip)'));
  svg.__xScale = {
    fn: xScale,
    invert: state.logScale ? invertLog(ranges.x, innerW, MARGIN.left) : invertLinear(ranges.x, innerW, MARGIN.left),
  };
  svg.__yScale = {
    fn: yScale,
    invert: state.logScale ? invertLog(ranges.y, innerH, height - MARGIN.bottom, true) : invertLinear(ranges.y, innerH, height - MARGIN.bottom, true),
  };
  svg.__rows = shownRows;
  svg.__innerW = innerW;
  svg.__innerH = innerH;

  document.getElementById('modeTitle').textContent = state.editMode === null ? '拖拽已关闭' : state.editMode === 'damage' ? '威力' : state.editMode === 'pen' ? '穿透' : '双向';
  document.getElementById('selectionInfo').textContent = selectedTpl ? `已选 ${editedName(selectedTpl)}` : '未选中';
  renderPointPanel();
  updateLegend();
}

function editedName(tpl) {
  const row = DATA.rows.find((r) => r.tpl === tpl);
  return row ? rowName(row) : tpl;
}

function updateLegend() {
  const legendRow = document.getElementById('legendRow');
  const active = allCalibers.filter((c) => currentCalibers.has(c));
  let html = active
    .map((c) => {
      const color = colorScale[c] || '#888';
      return `<span class="legend-chip"><span class="dot" style="background:${color}"></span>${friendlyCaliber(c)}</span>`;
    })
    .join('');
  if (state.realismMode && state.realismMode !== 'off') {
    html += `<span class="legend-chip realism"><span class="realism-mark"></span>Realism · ${realismModeName(state.realismMode)}</span>`;
  }
  legendRow.innerHTML = html || '<span class="muted">无口径显示</span>';
}

function renderCaliberChips() {
  const list = document.getElementById('caliberList');
  const term = document.getElementById('caliberSearch').value.trim().toLowerCase();
  const shown = allCalibers.filter((c) => friendlyCaliber(c).toLowerCase().includes(term));
  list.innerHTML = shown
    .map((c) => `<span class="chip ${currentCalibers.has(c) ? 'on' : ''}" data-caliber="${c}"><span class="dot" style="background:${colorScale[c] || '#667'}"></span>${friendlyCaliber(c)}<span class="count">${DATA.rows.filter((r) => r.caliber === c).length}</span></span>`)
    .join('');
  const toggleBtn = document.getElementById('selectAllCalibersBtn');
  const allOn = allCalibersSelected();
  toggleBtn.classList.toggle('sel-active', allOn);
  toggleBtn.setAttribute('aria-pressed', String(allOn));
  toggleBtn.textContent = allOn ? '\u6e05\u7a7a' : '\u5168\u9009';
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
    const color = colorScale[r.caliber] || '#888';
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

function currentTotalDamage(row) {
  const edit = editedMap.get(row.tpl);
  const value = edit && edit.damage !== undefined ? edit.damage : row.damage;
  return Number(value);
}

function displayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '-';
  return Math.round(n * 10) / 10;
}

function realismDetailHtml(row) {
  const entry = realismByTpl.get(row.tpl);
  if (!entry) return '';
  const source = `伤害 ${displayNumber(entry.damage)} · 穿透 ${displayNumber(entry.penetration)}`;
  if (state.realismMode === 'off') {
    return `<div class="realism-note"><b>Realism 源值</b>${source}</div>`;
  }
  const point = realismLayer([row])[0];
  if (!point) return `<div class="realism-note"><b>Realism 源值</b>${source}</div>`;
  return `<div class="realism-note"><b>Realism ${realismModeName(state.realismMode)}</b>${source} → 映射 ${displayNumber(point.x)} / ${displayNumber(point.y)}</div>`;
}

function renderPointPanel() {
  const panel = document.getElementById('pointPanel');
  const row = DATA.rows.find((r) => r.tpl === selectedTpl);
  if (!row) {
    panel.classList.add('hidden');
    panel.innerHTML = '';
    return;
  }
  const edit = editedMap.get(row.tpl);
  const d = effectiveDamage(row);
  const p = effectivePenetration(row);
  const editable = isEditable(row);
  const color = colorScale[row.caliber] || '#888';
  const orig = originalValuesFor(row);
  const origDamage = Number(orig.damagePerProjectile);
  const origPen = Number(orig.penetration);
  const origTotal = Number(orig.damage);
  const showOrig = !!edit || originalDiffers(row);
  let statusClass = '';
  let statusText = '';
  if (edit) {
    statusClass = 'edited';
    statusText = '已修改';
  } else if (!editable) {
    statusClass = 'locked';
    statusText = '锁定';
  }
  panel.innerHTML = `
    <div class="pp-head">
      <div class="pp-title">
        <span class="pp-dot" style="background:${color}"></span>
        <h3>${escapeHtml(rowName(row))}</h3>
      </div>
      <button class="close-pp" type="button" title="取消选择">×</button>
    </div>
    <div class="pp-meta">${escapeHtml(friendlyCaliber(row.caliber))} · ${escapeHtml(row.tpl)}</div>
    <div class="pp-grid">
      <div class="pp-stat${edit ? ' edited' : ''}">
        <span>单发威力</span>
        ${editable
          ? `<input class="pp-input" type="number" data-edit-key="damagePerProjectile" min="1" step="0.1" value="${d.toFixed(1)}">`
          : `<b>${d.toFixed(1)}</b>`}
        <em>总伤害 ${Math.round(currentTotalDamage(row))}</em>
      </div>
      <div class="pp-stat${edit ? ' edited' : ''}">
        <span>穿透</span>
        ${editable
          ? `<input class="pp-input" type="number" data-edit-key="penetration" min="0" max="${MAX_PEN}" step="0.1" value="${p.toFixed(1)}">`
          : `<b>${p.toFixed(1)}</b>`}
        <em>${row.projectileCount} 弹片</em>
      </div>
    </div>
    <div class="pp-foot">
      <div class="pp-actions">
        ${statusText ? `<span class="pp-tag ${statusClass}">${statusText}</span>` : ''}
        ${editable ? `<button type="button" class="ghost small" data-action="reset-point" ${edit ? '' : 'disabled'}>重置散点</button>` : ''}
      </div>
      ${showOrig ? `<div class="pp-orig muted">原始值：总伤害 ${Math.round(origTotal)} · 单发威力 ${origDamage.toFixed(1)} · 穿透 ${origPen.toFixed(1)}</div>` : ''}
    </div>
    ${realismDetailHtml(row)}
  `;
  panel.classList.remove('hidden');
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
  const orig = originalValuesFor(row);
  const origDamage = Number(orig.damagePerProjectile);
  const origPen = Number(orig.penetration);
  const origTotal = Number(orig.damage);
  const showOrig = !!edit || originalDiffers(row);
  body.innerHTML = `
    <h3>${escapeHtml(rowName(row))}</h3>
    <div class="detail-meta">${escapeHtml(friendlyCaliber(row.caliber))} · ${row.tpl}</div>
    <dl class="kv-table">
      <dt>总伤害</dt><dd><b>${Math.round(currentTotalDamage(row))}</b></dd>
      <dt>弹片数</dt><dd>${row.projectileCount}</dd>
      <dt>单发威力</dt><dd>${editable
        ? `<input class="detail-input" type="number" data-edit-key="damagePerProjectile" min="1" step="0.1" value="${d.toFixed(1)}">`
        : `<b>${d.toFixed(1)}</b>`}${edit ? ' <span class="warn">已改</span>' : ''}</dd>
      <dt>穿透</dt><dd>${editable
        ? `<input class="detail-input" type="number" data-edit-key="penetration" min="0" max="${MAX_PEN}" step="0.1" value="${p.toFixed(1)}">`
        : `<b>${p.toFixed(1)}</b>`}${edit ? ' <span class="warn">已改</span>' : ''}</dd>
      ${showOrig ? `
        <dt>原始总伤害</dt><dd class="muted">${Math.round(origTotal)}</dd>
        <dt>原始单发威力</dt><dd class="muted">${origDamage.toFixed(1)}</dd>
        <dt>原始穿透</dt><dd class="muted">${origPen.toFixed(1)}</dd>
      ` : ''}
      ${editable ? '<dt>拖拽</dt><dd>可编辑</dd>' : '<dt>拖拽</dt><dd class="warn">锁定</dd>'}
    </dl>
    ${realismDetailHtml(row)}
    ${editable ? `
      <div class="detail-actions">
        <button type="button" class="ghost small" data-action="reset-point" ${edit ? '' : 'disabled'}>重置散点</button>
      </div>
    ` : ''}
  `;
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

function onNumericEditChange(event) {
  const input = event.target.closest('[data-edit-key]');
  if (!input || !selectedTpl) return;
  const row = DATA.rows.find((r) => r.tpl === selectedTpl);
  if (!row || !isEditable(row)) return;
  const raw = String(input.value).trim();
  const next = Number(raw);
  if (!Number.isFinite(next) || raw === '') {
    renderAll();
    return;
  }
  const opts = {};
  if (input.dataset.editKey === 'damagePerProjectile') {
    opts.damagePerProjectile = Math.max(1, next);
  } else if (input.dataset.editKey === 'penetration') {
    opts.penetration = Math.max(0, Math.min(MAX_PEN, next));
  } else {
    return;
  }
  const prevD = effectiveDamage(row);
  const prevP = effectivePenetration(row);
  setEdit(selectedTpl, opts);
  renderAll();
  const nextD = effectiveDamage(row);
  const nextP = effectivePenetration(row);
  if (nextD !== prevD || nextP !== prevP) {
    showToast(`${row.short}：${nextD.toFixed(1)} / ${nextP.toFixed(1)}`);
  }
}

function onNumericEditKeydown(event) {
  const input = event.target.closest('[data-edit-key]');
  if (!input || event.key !== 'Enter') return;
  event.preventDefault();
  input.blur();
}

function onEditPanelClick(event) {
  const btn = event.target.closest('[data-action="reset-point"]');
  if (!btn || !selectedTpl) return;
  const row = DATA.rows.find((r) => r.tpl === selectedTpl);
  if (!row) return;
  if (!editedMap.has(selectedTpl)) return;
  editedMap.delete(selectedTpl);
  renderAll();
  showToast(`${row.short} 已恢复原始数据`);
}

function setEdit(tpl, opts) {
  const row = DATA.rows.find((r) => r.tpl === tpl);
  if (!row || !isEditable(row)) return false;
  rememberOriginal(row);
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
  const pt = pointFromEvent(event);
  if (!pt) return;
  const bothButtons = (event.buttons & 3) === 3;
  if (bothButtons || (event.button === 2 && (event.buttons & 1)) || (event.button === 0 && (event.buttons & 2))) {
    beginPan(event, pt);
    return;
  }
  if (event.button !== 0) return;
  const row = findNearest(pt.mx, pt.my);
  if (!row) {
    selectedTpl = null;
    renderInspector();
    renderList();
    drawChart();
    return;
  }
  selectedTpl = row.tpl;
  if (isEditable(row) && state.editMode) {
    state.dragLock = true;
    dragState = {
      row,
      startX: pt.mx,
      startY: pt.my,
      editBefore: editedMap.has(row.tpl) ? { ...editedMap.get(row.tpl) } : null,
    };
    svg.classList.add('dragging');
    const hint = document.getElementById('dragHint');
    hint.classList.remove('hidden');
    hint.textContent = `拖动：${row.short}`;
  }
  renderInspector();
  renderList();
  drawChart();
}

function beginPan(event, pt) {
  let canceledDrag = false;
  if (dragState) {
    if (dragState.editBefore) editedMap.set(dragState.row.tpl, dragState.editBefore);
    else editedMap.delete(dragState.row.tpl);
    canceledDrag = true;
    dragState = null;
    svg.classList.remove('dragging');
    document.getElementById('dragHint').classList.add('hidden');
  }
  state.dragLock = false;
  panState = {
    pointerId: event.pointerId,
    startX: pt.mx,
    startY: pt.my,
    ranges: { x: ranges.x.slice(), y: ranges.y.slice() },
  };
  state.zoomLocked = true;
  svg.classList.add('panning');
  event.preventDefault();
  if (canceledDrag) renderAll();
}

function onPointerMove(event) {
  const pt = pointFromEvent(event);
  if (!pt) return;
  if (!panState && (event.buttons & 3) === 3) {
    beginPan(event, pt);
  }
  if (panState) {
    if (event.pointerId !== panState.pointerId || (event.buttons & 3) !== 3) {
      endPan();
      return;
    }
    const vb = svg.viewBox.baseVal;
    const innerW = Math.max(1, vb.width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(1, vb.height - MARGIN.top - MARGIN.bottom);
    const dx = pt.mx - panState.startX;
    const dy = pt.my - panState.startY;
    ranges = {
      x: panRangeByPixels(panState.ranges.x, dx, innerW, state.logScale, false),
      y: panRangeByPixels(panState.ranges.y, dy, innerH, state.logScale, true),
    };
    drawChart();
    return;
  }
  if (!dragState) return;
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
  let newX = currentDamage(row);
  let newY = currentPenetration(row);
  if (state.editMode === 'damage' || state.editMode === 'both') {
    newX = Math.max(1, x);
  }
  if (state.editMode === 'pen' || state.editMode === 'both') {
    newY = Math.max(0, Math.min(MAX_PEN, y));
  }
  const changed = setEdit(row.tpl, { damagePerProjectile: newX, penetration: newY });
  if (changed) renderChartAndStatus();
}

function onPointerUp(event) {
  if (panState && (event.button === 0 || event.button === 2)) {
    endPan();
  } else if (dragState) {
    state.dragLock = false;
    dragState = null;
    svg.classList.remove('dragging');
    document.getElementById('dragHint').classList.add('hidden');
    renderAll();
  }
  if (suppressChartClick && (event.buttons & 3) === 0) {
    setTimeout(() => {
      suppressChartClick = false;
    }, 0);
  }
}

function endPan() {
  if (!panState) return;
  panState = null;
  svg.classList.remove('panning');
  suppressChartClick = true;
}

// Y is drawn from the bottom up, so its inverse reads from bottom to top.
function invertLinear(range, innerLen, from, reverse = false) {
  return (px) => {
    const t = (reverse ? from - px : px - from) / (innerLen || 1);
    return range[0] + t * (range[1] - range[0]);
  };
}

function invertLog(range, innerLen, from, reverse = false) {
  return (px) => {
    const t = (reverse ? from - px : px - from) / (innerLen || 1);
    const lo = Math.log10(Math.max(range[0], 0.1));
    const hi = Math.log10(Math.max(range[1], 1));
    return Math.pow(10, lo + t * (hi - lo));
  };
}

function zoomAxisRange(range, anchor, factor, logarithmic) {
  const min = Number(range[0]);
  const max = Number(range[1]);
  const minSpan = 0.25;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return range.slice();
  const span = max - min;
  let nextFactor = Math.min(2, Math.max(0.5, factor));
  if (span * nextFactor < minSpan) nextFactor = Math.min(1, minSpan / span);
  if (logarithmic) {
    const lo = Math.log10(Math.max(min, 0.1));
    const hi = Math.log10(Math.max(max, 1));
    const anchorValue = Math.max(Number.isFinite(anchor) ? anchor : min, 0.1);
    const t = Math.max(0, Math.min(1, (Math.log10(anchorValue) - lo) / (hi - lo || 1)));
    const nextLogSpan = Math.max(Math.log10(1.05), (hi - lo) * nextFactor);
    const nextLo = Math.log10(anchorValue) - t * nextLogSpan;
    return [Math.pow(10, nextLo), Math.pow(10, nextLo + nextLogSpan)];
  }
  const t = Math.max(0, Math.min(1, (anchor - min) / (span || 1)));
  const nextSpan = span * nextFactor;
  let nextMin = anchor - t * nextSpan;
  let nextMax = nextMin + nextSpan;
  if (nextMin < 0) {
    nextMax -= nextMin;
    nextMin = 0;
  }
  return [nextMin, nextMax];
}

function panRangeByPixels(range, deltaPixels, innerLength, logarithmic, reverseAxis) {
  const min = Number(range[0]);
  const max = Number(range[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return range.slice();
  if (logarithmic) {
    const lo = Math.log10(Math.max(min, 0.1));
    const hi = Math.log10(Math.max(max, 1));
    const shift = (deltaPixels / (innerLength || 1)) * (hi - lo);
    const direction = reverseAxis ? 1 : -1;
    let nextLo = lo + shift * direction;
    let nextHi = hi + shift * direction;
    const lowerBound = Math.log10(0.1);
    if (nextLo < lowerBound) {
      const correction = lowerBound - nextLo;
      nextLo += correction;
      nextHi += correction;
    }
    return [Math.pow(10, nextLo), Math.pow(10, nextHi)];
  }
  const span = max - min;
  const shift = (deltaPixels / (innerLength || 1)) * span;
  const direction = reverseAxis ? 1 : -1;
  let nextMin = min + shift * direction;
  let nextMax = max + shift * direction;
  if (nextMin < 0) {
    const correction = -nextMin;
    nextMin += correction;
    nextMax += correction;
  }
  return [nextMin, nextMax];
}

function onWheelZoom(event) {
  if (!svg || state.dragLock) return;
  const pt = pointFromEvent(event);
  const vb = svg.viewBox.baseVal;
  if (!pt || pt.mx < MARGIN.left || pt.mx > vb.width - MARGIN.right
    || pt.my < MARGIN.top || pt.my > vb.height - MARGIN.bottom) return;
  if (!svg.__xScale || !svg.__yScale) return;
  event.preventDefault();
  const deltaUnit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
  const delta = Math.max(-120, Math.min(120, event.deltaY * deltaUnit));
  const factor = Math.exp(delta * 0.002);
  const anchorX = svg.__xScale.invert(pt.mx);
  const anchorY = svg.__yScale.invert(pt.my);
  ranges = {
    x: zoomAxisRange(ranges.x, anchorX, factor, state.logScale),
    y: zoomAxisRange(ranges.y, anchorY, factor, state.logScale),
  };
  state.zoomLocked = true;
  drawChart();
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
  currentCalibers = allCalibersSelected() ? new Set() : new Set(allCalibers);
  renderAll();
}

function allCalibersSelected() {
  return allCalibers.length > 0 && currentCalibers.size === allCalibers.length;
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
    source: DATA.source || 'SPT_Runtime/SPT_Data/database/templates/items.json',
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

function saveLocal() {
  try {
    const patch = editsToPatch();
    localStorage.setItem('ammo_edits_patch', JSON.stringify(patch));
    localStorage.setItem('ammo_edits_source', DATA.source);
    writeStoredOriginals();
    showToast('修改已保存到浏览器本地');
  } catch (err) {
    showToast(`保存失败：${err.message}`, 4000);
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem('ammo_edits_patch');
    if (!raw) return;
    const patch = JSON.parse(raw);
    if (!patch || !Array.isArray(patch.edits)) return;
    for (const edit of patch.edits) {
      const row = DATA.rows.find((r) => r.tpl === edit.tpl);
      if (!row) continue;
      rememberOriginal(row);
      const rawDamage = Number(edit.damagePerProjectile);
      const damagePerProjectile = Number.isFinite(rawDamage)
        ? rawDamage
        : Number(edit.damage) / (Number(row.projectileCount) || 1);
      editedMap.set(edit.tpl, {
        ...edit,
        name: edit.name || row.name,
        damagePerProjectile,
      });
    }
  } catch (err) {
    console.warn('local edits not loaded', err);
  }
}

function writeBackMessage() {
  const n = editedMap.size;
  if (n === 0) {
    showToast('没有可写入的修改');
    return;
  }
  const btn = document.getElementById('writeBackBtn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '写入中…';
  fetch('/api/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(editsToPatch()),
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const names = data.changes.length > 3 ? `${data.changes.length} 种弹药` : data.changes.map((c) => c.name).join('、');
      editedMap.clear();
      localStorage.removeItem('ammo_edits_patch');
      localStorage.removeItem('ammo_edits_source');
      writeStoredOriginals();
      try {
        await refreshChartData();
      } catch (refreshErr) {
        showToast(`已写入 items.json：${names}，但图表数据刷新失败：${refreshErr.message}`, 8000);
        return;
      }
      showToast(`已写入 items.json 并重建图表数据：${names}（快照 ${data.backupDir}）`, 6000);
    })
    .catch((err) => {
      serverAvailable = false;
      renderWriteBackHint(err.message);
    })
    .finally(() => {
      btn.disabled = false;
      btn.textContent = label;
    });
}

function renderWriteBackHint(errorMessage) {
  const box = document.getElementById('statusBox');
  if (errorMessage) {
    box.textContent = `写库失败：${errorMessage}`;
    box.classList.add('dirty');
  } else if (!serverAvailable) {
    box.textContent = '本地服务未运行，页面无法直接写库';
    box.classList.add('dirty');
  } else {
    renderStatus();
  }
}

async function checkServer() {
  try {
    const response = await fetch('/api/reload', { method: 'POST' });
    serverAvailable = response.ok;
  } catch (err) {
    serverAvailable = false;
  }
  if (serverAvailable) renderStatus();
  else renderWriteBackHint();
}

function currentRowForZoom() {
  return filteredRows();
}

function keyboardSelect(event) {
  if (event.target && event.target.closest && event.target.closest('input, textarea, select')) return;
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
  if (!state.editMode) return;
  event.preventDefault();
  const curDamage = currentDamage(row);
  const curPen = currentPenetration(row);
  const nextDamage = state.editMode === 'damage' || state.editMode === 'both'
    ? Number((curDamage + dx).toFixed(1))
    : curDamage;
  const nextPen = state.editMode === 'pen' || state.editMode === 'both'
    ? Math.max(0, Math.min(MAX_PEN, curPen + dy))
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
    const mode = btn.dataset.mode;
    state.editMode = state.editMode === mode ? null : mode;
    document.querySelectorAll('#editMode button').forEach((b) => {
      const active = b.dataset.mode === state.editMode;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
    drawChart();
  });

  document.getElementById('realismMode').addEventListener('click', (event) => {
    const btn = event.target.closest('button');
    if (!btn) return;
    state.realismMode = btn.dataset.realism || 'off';
    saveRealismMode();
    syncRealismControls();
    renderAll();
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
  svg.addEventListener('wheel', onWheelZoom, { passive: false });
  svg.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  svg.addEventListener('click', (event) => {
    if (suppressChartClick) {
      event.preventDefault();
      return;
    }
    const target = event.target.closest('circle');
    if (target && target.dataset.tpl) {
      selectedTpl = target.dataset.tpl;
      renderAll();
    }
  });
  document.getElementById('pointPanel').addEventListener('click', (event) => {
    if (!event.target.closest('.close-pp')) return;
    selectedTpl = null;
    renderAll();
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
  const saveEditsBtn = document.getElementById('saveEditsBtn');
  if (saveEditsBtn) saveEditsBtn.addEventListener('click', saveLocal);
  const writeBackBtn = document.getElementById('writeBackBtn');
  if (writeBackBtn) writeBackBtn.addEventListener('click', writeBackMessage);
  document.getElementById('resetViewBtn').addEventListener('click', () => {
    searchTerm = '';
    selectedTpl = null;
    document.getElementById('searchInput').value = '';
    currentCalibers = new Set(allCalibers);
    state.zoomLocked = false;
    renderAll();
  });
  document.getElementById('zoomResetBtn').addEventListener('click', () => {
    state.zoomLocked = false;
    setRangeForRows(filteredRows());
    drawChart();
  });
  const editPanel = document.getElementById('pointPanel');
  const detailPanel = document.getElementById('detailBody');
  for (const panel of [editPanel, detailPanel]) {
    panel.addEventListener('change', onNumericEditChange);
    panel.addEventListener('keydown', onNumericEditKeydown);
    panel.addEventListener('click', onEditPanelClick);
  }
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
  loadRealismMode();
  await Promise.all([loadOriginals(), loadRealismMap()]);
  buildData();
  if (document.getElementById('saveEditsBtn')) loadLocal();
  setupEventListeners();
  syncRealismControls();
  if (document.getElementById('writeBackBtn')) await checkServer();
  renderAll();
  if (!serverAvailable && document.getElementById('writeBackBtn')) renderWriteBackHint();
}

async function refreshChartData() {
  const response = await fetch(`data.json?t=${Date.now()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const next = await response.json();
  if (!next || !Array.isArray(next.rows)) throw new Error('data.json 格式异常');
  DATA = next;
  await Promise.all([loadOriginals(true), loadRealismMap(true)]);
  const sourceLine = document.getElementById('sourceLine');
  sourceLine.textContent = `${DATA.source || ''} · ${DATA.count || 0} 种弹药 · ${new Date(DATA.generated || Date.now()).toLocaleString()}`;
  buildData();
  if (document.getElementById('saveEditsBtn')) loadLocal();
  syncRealismControls();
  renderAll();
}

document.addEventListener('DOMContentLoaded', () => {
  svg = document.getElementById('chart');
  loadData();
  let chartResizeTimer = 0;
  const chartObserver = new ResizeObserver(() => {
    if (chartResizeTimer) return;
    chartResizeTimer = requestAnimationFrame(() => {
      chartResizeTimer = 0;
      drawChart();
    });
  });
  chartObserver.observe(document.getElementById('chartWrap'));
});
