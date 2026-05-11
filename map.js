const BASEMAP  = 'https://tiles.openfreemap.org/styles/liberty';
const DATA_URL = 'data.geojson';
const MAX_HEIGHT = 60000; // metres — visible at zoom ~8 with pitch

const METRIC_LABELS = {
  gap:                   'Renter–owner gap (%)',
  total:                 'Shelter cost — all tenures (%)',
  renter:                'Shelter cost — renter (%)',
  owner:                 'Shelter cost — owner (%)',
  housing_avg_cost: 'Avg absorbed unit cost ($)',
};

// Metrics stored as standalone properties (not prefixed by group)
const STANDALONE_METRICS = new Set(['housing_avg_cost']);

const COLORS = ['#ffffcc','#ffeda0','#fed976','#feb24c','#fd8d3c','#fc4e2a','#e31a1c','#bd0026','#800026'];

let currentGroup        = 'total';
let currentColorMetric  = 'gap';
let currentHeightMetric = 'renter';
let geojsonData         = null;
let highlightedUID      = null;

// --- helpers ---

function resolveKey(group, metric) {
  return STANDALONE_METRICS.has(metric) ? metric : `${group}_${metric}`;
}

function computeDomain(data, key) {
  const vals = data.features
    .map(f => f.properties[key])
    .filter(v => v != null && !isNaN(v));
  return [Math.min(...vals), Math.max(...vals)];
}

function colorStops(min, max) {
  const step = (max - min) / (COLORS.length - 1);
  return COLORS.flatMap((c, i) => [min + i * step, c]);
}

function fmt(v, metric) {
  if (v == null || isNaN(v) || v === '') return '—';
  if (metric && STANDALONE_METRICS.has(metric)) return '$' + Math.round(Number(v)).toLocaleString();
  return `${parseFloat(v).toFixed(1)}%`;
}

// --- map ---

const map = new maplibregl.Map({
  container: 'map',
  style: BASEMAP,
  center: [-73.6, 45.5],
  zoom: 8,
  pitch: 45,
  bearing: -10,
  antialias: true,
});

map.addControl(new maplibregl.NavigationControl(), 'top-right');

map.on('load', async () => {
  const res = await fetch(DATA_URL);
  geojsonData = await res.json();

  map.addSource('csds', { type: 'geojson', data: geojsonData });

  map.addLayer({
    id: 'csd-extrusion',
    type: 'fill-extrusion',
    source: 'csds',
    paint: buildExtrusionPaint(currentGroup, currentColorMetric, currentHeightMetric),
  }, firstSymbolLayerId());

  map.addLayer({
    id: 'csd-outline',
    type: 'line',
    source: 'csds',
    paint: { 'line-color': '#444', 'line-width': 0.8, 'line-opacity': 0.5 },
  });

  updateLegend();
  attachMapEvents();
});

function firstSymbolLayerId() {
  const layers = map.getStyle().layers;
  const hit = layers.find(l => l.type === 'symbol');
  return hit ? hit.id : undefined;
}

// --- paint ---

function buildExtrusionPaint(group, colorMetric, heightMetric) {
  const colorKey  = resolveKey(group, colorMetric);
  const heightKey = resolveKey(group, heightMetric);
  const [cmn, cmx] = computeDomain(geojsonData, colorKey);
  const [hmn, hmx] = computeDomain(geojsonData, heightKey);

  const normalColor = [
    'interpolate', ['linear'],
    ['coalesce', ['get', colorKey], cmn],
    ...colorStops(cmn, cmx),
  ];

  return {
    'fill-extrusion-color': highlightedUID
      ? ['case', ['==', ['get', 'CSDUID'], highlightedUID], normalColor, '#b0b8c1']
      : normalColor,
    'fill-extrusion-height': [
      'interpolate', ['linear'],
      ['coalesce', ['get', heightKey], hmn],
      hmn, 0,
      hmx, MAX_HEIGHT,
    ],
    'fill-extrusion-opacity': highlightedUID
      ? ['case', ['==', ['get', 'CSDUID'], highlightedUID], 0.9, 0.2]
      : 0.75,
  };
}

function updateLayer() {
  if (!map.getLayer('csd-extrusion')) return;
  const paint = buildExtrusionPaint(currentGroup, currentColorMetric, currentHeightMetric);
  Object.entries(paint).forEach(([prop, val]) => {
    map.setPaintProperty('csd-extrusion', prop, val);
  });
  updateLegend();
}

// --- legend ---

function updateLegend() {
  if (!geojsonData) return;

  const colorKey  = resolveKey(currentGroup, currentColorMetric);
  const heightKey = resolveKey(currentGroup, currentHeightMetric);
  const [cmn, cmx] = computeDomain(geojsonData, colorKey);
  const [hmn, hmx] = computeDomain(geojsonData, heightKey);

  document.getElementById('legend-color-title').textContent  = 'Colour: ' + METRIC_LABELS[currentColorMetric];
  document.getElementById('legend-height-title').textContent = 'Height: ' + METRIC_LABELS[currentHeightMetric];
  document.getElementById('legend-min').textContent          = fmt(cmn, currentColorMetric);
  document.getElementById('legend-max').textContent          = fmt(cmx, currentColorMetric);
  document.getElementById('height-legend-min').textContent   = fmt(hmn, currentHeightMetric);
  document.getElementById('height-legend-max').textContent   = fmt(hmx, currentHeightMetric);
}

// --- sidebar ---

function buildSidebar(props) {
  const groups = [
    { key: 'total',        label: 'Total' },
    { key: 'immigrant',    label: 'Immigrant' },
    { key: 'nonimmigrant', label: 'Non-immigrant' },
  ];

  const metrics = [
    { key: 'total',  label: 'All tenures' },
    { key: 'owner',  label: 'Owner' },
    { key: 'renter', label: 'Renter' },
    { key: 'gap',    label: 'Renter–owner gap' },
  ];

  let html = `
    <div class="zone-name">${props.CSDNAME}</div>
    <div class="zone-meta">CSD ${props.CSDUID} · ${props.CSDTYPE}</div>
  `;

  for (const g of groups) {
    html += `<div class="stat-section-title">Shelter cost % of income — ${g.label}</div>`;
    for (const m of metrics) {
      const val = props[`${g.key}_${m.key}`];
      html += `<div class="stat-row"><span>${m.label}</span><span>${fmt(val)}</span></div>`;
    }
  }

  html += `<div class="stat-section-title">Absorbed housing units (2025)</div>`;
  html += `<div class="stat-row"><span>Avg unit cost</span><span>${fmt(props.housing_avg_cost, 'housing_avg_cost')}</span></div>`;

  return html;
}

// --- interactions ---

function attachMapEvents() {
  map.on('click', 'csd-extrusion', e => {
    const props = e.features[0].properties;
    document.getElementById('zone-info').innerHTML = buildSidebar(props);
  });

  map.on('mouseenter', 'csd-extrusion', () => {
    map.getCanvas().style.cursor = 'pointer';
  });

  map.on('mouseleave', 'csd-extrusion', () => {
    map.getCanvas().style.cursor = '';
  });
}

// --- search ---

function geomCenter(geometry) {
  const coords = [];
  function collect(arr) {
    if (typeof arr[0] === 'number') { coords.push(arr); return; }
    arr.forEach(collect);
  }
  collect(geometry.coordinates);
  const lngs = coords.map(c => c[0]);
  const lats = coords.map(c => c[1]);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

function searchCSD(query) {
  const msg = document.getElementById('search-msg');
  if (!geojsonData || !query.trim()) return;
  const q = query.trim().toLowerCase();
  const feature = geojsonData.features.find(
    f => f.properties.CSDNAME.toLowerCase().includes(q)
  );
  if (!feature) {
    msg.textContent = 'No CSD found.';
    return;
  }
  msg.textContent = '';
  highlightedUID = String(feature.properties.CSDUID);
  updateLayer();
  document.getElementById('zone-info').innerHTML = buildSidebar(feature.properties);
  const center = geomCenter(feature.geometry);
  map.flyTo({ center, zoom: 10, duration: 1000 });
}

function clearSearch() {
  highlightedUID = null;
  document.getElementById('csd-search').value = '';
  document.getElementById('search-clear').style.display = 'none';
  document.getElementById('search-msg').textContent = '';
  updateLayer();
}

// --- controls ---

document.getElementById('group-select').addEventListener('change', e => {
  currentGroup = e.target.value;
  updateLayer();
});

document.getElementById('color-metric-select').addEventListener('change', e => {
  currentColorMetric = e.target.value;
  updateLayer();
});

document.getElementById('height-metric-select').addEventListener('change', e => {
  currentHeightMetric = e.target.value;
  updateLayer();
});

document.getElementById('csd-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') searchCSD(e.target.value);
  if (e.key === 'Escape') clearSearch();
});

document.getElementById('csd-search').addEventListener('input', e => {
  document.getElementById('search-clear').style.display = e.target.value ? 'block' : 'none';
  if (!e.target.value) clearSearch();
});

document.getElementById('search-clear').addEventListener('click', clearSearch);
