/* ── Elite Dangerous HUD — Widget Logic ─────────────────────────────────── */

/* ── Constants ──────────────────────────────────────────────────────────── */

const RECONNECT_BASE  = 3000;
const RECONNECT_MAX   = 30000;

const FLAG = {
  DOCKED:       1 << 0,
  LANDED:       1 << 1,
  SHIELDS_UP:   1 << 3,
  SUPERCRUISE:  1 << 4,
  HARDPOINTS:   1 << 6,
  SILENT_RUN:   1 << 10,
  SCOOPING:     1 << 11,
  MASS_LOCKED:  1 << 16,
  FSD_CHARGING: 1 << 17,
  LOW_FUEL:     1 << 19,
  OVERHEATING:  1 << 20,
  IN_DANGER:    1 << 22,
  INTERDICTED:  1 << 23,
  FSD_JUMP:     1 << 30,
};

const SHIP_NAMES = {
  adder: 'Adder', anaconda: 'Anaconda', asp: 'Asp Explorer',
  asp_scout: 'Asp Scout', belugaliner: 'Beluga Liner',
  cobramkiii: 'Cobra Mk III', cobramkiv: 'Cobra Mk IV',
  cutter: 'Imperial Cutter', diamondbackxl: 'DBX',
  diamondback: 'Diamondback Scout', dolphin: 'Dolphin', eagle: 'Eagle',
  empire_courier: 'Imperial Courier', empire_eagle: 'Imperial Eagle',
  empire_trader: 'Imperial Clipper', federation_corvette: 'Federal Corvette',
  federation_dropship: 'Federal Dropship',
  federation_dropship_mkii: 'Federal Assault Ship',
  federation_gunship: 'Federal Gunship', ferdelance: 'Fer-de-Lance',
  hauler: 'Hauler', independant_trader: 'Keelback',
  krait_light: 'Krait Phantom', krait_mkii: 'Krait Mk II',
  mamba: 'Mamba', mandalay: 'Mandalay', orca: 'Orca',
  python: 'Python', python_nx: 'Python Mk II',
  sidewinder: 'Sidewinder', type6: 'Type-6', type7: 'Type-7',
  type8: 'Type-8', type9: 'Type-9 Heavy', type9_military: 'Type-10 Defender',
  typex: 'Alliance Chieftain', typex_2: 'Alliance Crusader',
  typex_3: 'Alliance Challenger', viper: 'Viper Mk III',
  viper_mkiv: 'Viper Mk IV', vulture: 'Vulture',
};

const GAME_MODES = { Open: 'OPEN', Solo: 'SOLO', Group: 'GROUP' };

const LEGAL_LABELS = {
  Clean: 'CLEAN', IllegalCargo: 'ILLEGAL CARGO', Speeding: 'SPEEDING',
  Wanted: 'WANTED', Hostile: 'HOSTILE', PassengerWanted: 'PSGR WANTED',
  Warrant: 'WARRANT',
};

const DANGEROUS_LEGAL = new Set(['Wanted', 'Hostile']);

/* ── State ──────────────────────────────────────────────────────────────── */

const state = {
  // Connection
  wsStatus:       'connecting',
  hadData:        false,
  reconnectDelay: RECONNECT_BASE,
  reconnectTimer: null,
  ws:             null,

  // Commander
  commander:  null,
  credits:    0,
  gameMode:   'Open',
  legalState: 'Clean',

  // Location
  starSystem: null,
  body:       null,
  station:    null,

  // Status flags
  flags: 0,

  // Ship
  shipName:      null,
  shipType:      null,
  shipIdent:     null,
  hullHealth:    1.0,
  shieldsUp:     true,
  maxJumpRange:  0,
  fuelCapacity:  8,
  cargoCapacity: 0,

  // Live (from Status.json)
  fuelMain:      0,
  fuelReservoir: 0,
  cargoUsed:     0,
  pips:          [2, 2, 2],

  // Navigation — NavRoute array: [{StarSystem, StarClass, ...}]
  route: [],

  // Cargo manifest — [{key, name, count, stolen, missionId}]
  manifest: [],

  // Missions — [{id, name, targetSystem, targetStation, reward, expiry}]
  missions: [],

  // Active tab
  activeTab: 'hud',
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

function hasFlag(f)     { return (state.flags & f) !== 0; }

function resolveShipType(raw) {
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
  return SHIP_NAMES[key] || raw;
}

function formatCredits(cr) {
  const n = Number(cr) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B CR';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M CR';
  if (n >= 1e3) return Math.round(n / 1e3) + 'K CR';
  return n.toLocaleString() + ' CR';
}

function utcTime() {
  const d = new Date();
  return d.getUTCHours().toString().padStart(2, '0') + ':' +
         d.getUTCMinutes().toString().padStart(2, '0') + ' UTC';
}

function formatCommodityName(raw) {
  if (!raw) return '—';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatTimeRemaining(expiryStr) {
  if (!expiryStr) return '';
  const ms = new Date(expiryStr) - Date.now();
  if (ms <= 0) return 'EXPIRED';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
  if (h > 0)   return h + 'h ' + m + 'm';
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? m + 'm ' + s + 's' : s + 's';
}

/* ── Cargo manifest helpers ─────────────────────────────────────────────── */

function manifestAdd(type, localised, count, stolen, missionId) {
  const key = (type || '').toLowerCase();
  const mid = missionId || null;
  const idx = state.manifest.findIndex(i => i.key === key && i.missionId === mid);
  if (idx >= 0) {
    state.manifest[idx].count += (count || 1);
  } else {
    state.manifest.push({
      key,
      name:      localised || formatCommodityName(type),
      count:     count || 1,
      stolen:    !!stolen,
      missionId: mid,
    });
  }
  state.manifest = state.manifest.filter(i => i.count > 0);
}

function manifestRemove(type, count, stolen, missionId) {
  const key = (type || '').toLowerCase();
  const mid = missionId || null;
  // Prefer an exact match on missionId, fall back to first key match
  let idx = state.manifest.findIndex(i => i.key === key && i.missionId === mid);
  if (idx < 0) idx = state.manifest.findIndex(i => i.key === key);
  if (idx >= 0) {
    state.manifest[idx].count = Math.max(0, state.manifest[idx].count - (count || 1));
    state.manifest = state.manifest.filter(i => i.count > 0);
  }
}

/* ── DOM utilities ──────────────────────────────────────────────────────── */

function $  (id)        { return document.getElementById(id); }
function setText(id, v) { const e = $(id); if (e) e.textContent = v; }
function show(id, on)   { const e = $(id); if (e) e.style.display = on ? '' : 'none'; }

function setBar(id, pct) {
  const e = $(id);
  if (!e) return;
  e.style.width = Math.max(0, Math.min(100, pct)) + '%';
}

function setClasses(id, map) {
  const e = $(id);
  if (!e) return;
  for (const [cls, on] of Object.entries(map)) {
    e.classList.toggle(cls, !!on);
  }
}

/* ── Tab switching ──────────────────────────────────────────────────────── */

function switchTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.tab-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.tab === tabId)
  );
  document.querySelectorAll('.tab-panel').forEach(panel =>
    panel.classList.toggle('active', panel.id === 'panel-' + tabId)
  );
  // Refresh content of newly visible tab
  if (tabId === 'nav')      renderNav();
  if (tabId === 'cargo')    renderCargo();
  if (tabId === 'missions') renderMissions();
}

/* ── WebSocket ──────────────────────────────────────────────────────────── */

function getWsUrl() {
  var port = getIcueProperty('journalPort');
  port = (port && String(port).trim()) ? String(port).trim() : '31337';
  return 'ws://localhost:' + port;
}

function connect() {
  state.wsStatus = 'connecting';
  renderOverlays();

  try {
    const ws = new WebSocket(getWsUrl());
    state.ws = ws;

    ws.onopen = () => {
      state.wsStatus = 'connected';
      state.reconnectDelay = RECONNECT_BASE;
      renderOverlays();
    };

    ws.onmessage = (ev) => {
      try { handleMessage(JSON.parse(ev.data)); }
      catch (_) { /* malformed frame — ignore */ }
    };

    ws.onclose = () => {
      state.ws = null;
      state.wsStatus = 'disconnected';
      renderOverlays();
      scheduleReconnect();
    };

    ws.onerror = () => { /* onclose fires after onerror */ };

  } catch (_) {
    state.wsStatus = 'disconnected';
    renderOverlays();
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = setTimeout(() => {
    state.reconnectDelay = Math.min(state.reconnectDelay * 1.5, RECONNECT_MAX);
    connect();
  }, state.reconnectDelay);
}

/* ── Message dispatch ───────────────────────────────────────────────────── */

function handleMessage(msg) {
  const type    = msg.type || '';
  const payload = msg.payload || msg;

  if (type === 'NEW_STATUS_EVENT' || type === 'STATUS_EVENT') {
    handleStatus(payload);
  } else {
    const ev = payload.event || '';
    if (ev) handleJournalEvent(ev, payload);
  }
}

/* ── Status.json handler ────────────────────────────────────────────────── */

function handleStatus(p) {
  if (p.Flags !== undefined) state.flags = p.Flags;
  if (p.Fuel) {
    if (p.Fuel.FuelMain      !== undefined) state.fuelMain      = p.Fuel.FuelMain;
    if (p.Fuel.FuelReservoir !== undefined) state.fuelReservoir = p.Fuel.FuelReservoir;
  }
  if (p.Cargo    !== undefined) state.cargoUsed = p.Cargo;
  if (p.Pips)                   state.pips      = p.Pips;
  if (p.LegalState)             state.legalState = p.LegalState;

  state.shieldsUp = hasFlag(FLAG.SHIELDS_UP);
  renderHUD();
}

/* ── Journal event handler ──────────────────────────────────────────────── */

function handleJournalEvent(ev, e) {
  switch (ev) {

    case 'Commander':
      if (e.Name) state.commander = e.Name;
      break;

    case 'LoadGame':
      if (e.Commander !== undefined) state.commander  = e.Commander;
      if (e.Credits   !== undefined) state.credits    = e.Credits;
      if (e.GameMode)                state.gameMode   = e.GameMode;
      if (e.Ship)     state.shipType  = e.Ship_Localised || resolveShipType(e.Ship);
      if (e.ShipName) state.shipName  = e.ShipName;
      if (e.ShipIdent) state.shipIdent = e.ShipIdent;
      break;

    case 'Location':
      if (e.StarSystem) state.starSystem = e.StarSystem;
      if (e.Body)       state.body       = e.Body;
      state.station = e.Docked ? (e.StationName || null) : null;
      state.hadData = true;
      renderNav();
      break;

    case 'FSDJump':
      if (e.StarSystem) state.starSystem = e.StarSystem;
      if (e.Body)       state.body       = e.Body;
      if (e.FuelLevel !== undefined) state.fuelMain = e.FuelLevel;
      state.station = null;
      state.hadData = true;
      // Advance route: trim all systems up to and including the one we jumped to
      if (state.route.length > 1) {
        const idx = state.route.findIndex(r => r.StarSystem === e.StarSystem);
        if (idx > 0)      state.route = state.route.slice(idx);
        else if (idx < 0) state.route = [];  // jumped off-route
      }
      renderNav();
      break;

    case 'NavRoute':
      state.route = (e.Route || []).slice(); // full plotted route
      renderNav();
      break;

    case 'NavRouteClear':
      state.route = [];
      renderNav();
      break;

    case 'SupercruiseEntry':
      state.flags |= FLAG.SUPERCRUISE;
      break;

    case 'SupercruiseExit':
      state.flags &= ~FLAG.SUPERCRUISE;
      if (e.Body) state.body = e.Body;
      break;

    case 'Docked':
      if (e.StarSystem) state.starSystem = e.StarSystem;
      state.station = e.StationName || null;
      renderNav();
      break;

    case 'Undocked':
      state.station = null;
      renderNav();
      break;

    case 'Loadout':
      state.shipType   = e.Ship_Localised || resolveShipType(e.Ship) || state.shipType;
      if (e.ShipName)                state.shipName     = e.ShipName;
      if (e.ShipIdent)               state.shipIdent    = e.ShipIdent;
      if (e.MaxJumpRange)            state.maxJumpRange = e.MaxJumpRange;
      if (e.FuelCapacity && e.FuelCapacity.Main) state.fuelCapacity = e.FuelCapacity.Main;
      if (e.CargoCapacity !== undefined) state.cargoCapacity = e.CargoCapacity;
      break;

    case 'HullDamage':
      if (e.Health !== undefined) state.hullHealth = e.Health;
      break;

    case 'ShieldState':
      if (e.ShieldsUp !== undefined) state.shieldsUp = e.ShieldsUp;
      break;

    case 'Died':
      state.hullHealth = 0;
      state.shieldsUp  = false;
      break;

    case 'Resurrect':
    case 'Respawn':
      state.hullHealth = 1.0;
      state.shieldsUp  = true;
      break;

    case 'RepairAll':
      state.hullHealth = 1.0;
      break;

    /* ── Cargo ── */

    case 'Cargo':
      if (e.Count !== undefined) state.cargoUsed = e.Count;
      if (Array.isArray(e.Inventory)) {
        state.manifest = e.Inventory.map(i => ({
          key:      (i.Name || '').toLowerCase(),
          name:     i.Name_Localised || formatCommodityName(i.Name),
          count:    i.Count || 0,
          stolen:   (i.Stolen || 0) > 0,
          missionId: i.MissionID || null,
        })).filter(i => i.count > 0);
        renderCargo();
      }
      break;

    case 'CollectCargo':
      manifestAdd(e.Type, e.Type_Localised, 1, e.Stolen, e.MissionID);
      renderCargo();
      break;

    case 'EjectCargo':
      manifestRemove(e.Type, e.Count || 1, false, e.MissionID);
      renderCargo();
      break;

    case 'MarketBuy':
      manifestAdd(e.Type, e.Type_Localised, e.Count, false, null);
      renderCargo();
      break;

    case 'MarketSell':
      manifestRemove(e.Type, e.Count, false, null);
      renderCargo();
      break;

    case 'FuelScoop':
      if (e.Total !== undefined) state.fuelMain = e.Total;
      break;

    case 'RefuelAll':
    case 'RefuelPartial':
      if (e.Amount !== undefined) {
        state.fuelMain = Math.min((state.fuelMain || 0) + e.Amount, state.fuelCapacity);
      }
      break;

    /* ── Missions ── */

    case 'MissionAccepted':
      state.missions.push({
        id:            e.MissionID,
        name:          e.LocalisedName || e.Name || '—',
        targetSystem:  e.DestinationSystem  || '',
        targetStation: e.DestinationStation || '',
        reward:        e.Reward || 0,
        expiry:        e.Expiry || null,
      });
      renderMissions();
      break;

    case 'MissionCompleted':
      // Mission cargo is removed by the game and a Cargo event follows
      state.missions = state.missions.filter(m => m.id !== e.MissionID);
      renderMissions();
      break;

    case 'MissionFailed':
    case 'MissionAbandoned':
      state.missions = state.missions.filter(m => m.id !== e.MissionID);
      renderMissions();
      break;

    case 'Statistics':
    case 'Progress':
    case 'Rank':
    case 'Reputation':
    case 'SquadronStartup':
    case 'Fileheader':
    case 'ClearSavedGame':
      break;
  }

  renderHUD();
}

/* ── Overlay rendering ──────────────────────────────────────────────────── */

function renderOverlays() {
  const connected = state.wsStatus === 'connected';
  const hasData   = state.hadData;

  show('overlay-connecting', !hasData);
  show('overlay-lost',       hasData && !connected);
  show('hud-root',           hasData);

  if (!hasData) {
    const msgs = {
      connecting:   'CONNECTING TO GALNET',
      connected:    'AWAITING COMMANDER DATA',
      disconnected: 'GALNET OFFLINE — RETRYING',
    };
    setText('connecting-msg', msgs[state.wsStatus] || 'CONNECTING TO GALNET');
  }
}

/* ── HUD tab rendering ──────────────────────────────────────────────────── */

function renderHUD() {
  if (!state.hadData) return;

  /* Header */
  setText('h-name',    state.commander ? 'CMDR ' + state.commander : 'CMDR');
  setText('h-mode',    GAME_MODES[state.gameMode] || (state.gameMode || 'OPEN').toUpperCase());

  const legal      = state.legalState || 'Clean';
  const legalLabel = LEGAL_LABELS[legal] || legal.toUpperCase();
  const isWanted   = DANGEROUS_LEGAL.has(legal);
  setText('h-legal', legalLabel);
  setClasses('h-legal', { 'is-wanted': isWanted });
  setText('h-credits', formatCredits(state.credits));

  /* Location */
  setText('p-system', state.starSystem || '—');
  setText('p-body',   state.body       || '');

  const stationVisible = !!state.station;
  show('p-station', stationVisible);
  if (stationVisible) setText('p-station', state.station);

  const docked     = hasFlag(FLAG.DOCKED) || !!state.station;
  const landed     = hasFlag(FLAG.LANDED);
  const sc         = hasFlag(FLAG.SUPERCRUISE);
  const fsdJump    = hasFlag(FLAG.FSD_JUMP);
  const interdicted = hasFlag(FLAG.INTERDICTED);

  setClasses('flag-docked', { active: docked && !landed && !fsdJump });
  setClasses('flag-landed', { active: landed });
  setClasses('flag-sc',     { active: sc && !fsdJump && !docked });
  setClasses('flag-jump',   { active: fsdJump });
  setClasses('flag-intrdc', { active: interdicted, 'active-danger': interdicted });

  /* Ship */
  const hasCustomName = state.shipName && state.shipName.trim() !== '';
  setText('p-ship-name',  hasCustomName ? state.shipName.toUpperCase() : (state.shipType || '—').toUpperCase());
  setText('p-ship-type',  hasCustomName ? (state.shipType || '') : '');
  setText('p-ship-ident', state.shipIdent ? '[' + state.shipIdent + ']' : '');
  setText('p-jump',       state.maxJumpRange ? state.maxJumpRange.toFixed(2) + ' LY' : '—');
  setText('p-cargo-cap',  state.cargoCapacity > 0 ? state.cargoCapacity + ' T' : '—');

  renderPips();

  /* Hull */
  const hullPct   = Math.round((state.hullHealth || 0) * 100);
  setBar('bar-hull', hullPct);
  setText('v-hull', hullPct + '%');
  setClasses('bar-hull', { 'bar-danger': hullPct <= 25, 'bar-warning': hullPct > 25 && hullPct <= 60 });
  setClasses('v-hull',   { 'is-danger':  hullPct <= 25, 'is-warning':  hullPct > 25 && hullPct <= 60 });

  /* Shields */
  const shUp = state.shieldsUp || hasFlag(FLAG.SHIELDS_UP);
  if (!shUp) { const bs = $('bar-shield'); if (bs) bs.style.width = '0%'; }
  else         setBar('bar-shield', 100);
  setClasses('bar-shield', { 'bar-shield': shUp });
  setText('v-shields', shUp ? '▲ UP' : '▼ DOWN');
  setClasses('v-shields', { 'is-shields-up': shUp, 'is-shields-down': !shUp });

  /* Fuel */
  const fuelPct = state.fuelCapacity > 0 ? (state.fuelMain / state.fuelCapacity) * 100 : 0;
  const lowFuel = hasFlag(FLAG.LOW_FUEL) || fuelPct < 25;
  setBar('bar-fuel', fuelPct);
  setText('v-fuel', state.fuelMain.toFixed(1) + ' T');
  setClasses('bar-fuel', { 'bar-danger': lowFuel });
  setClasses('v-fuel',   { 'is-danger': lowFuel });
  setText('v-fuel-res', state.fuelReservoir.toFixed(2) + ' T RES');

  /* Cargo */
  const cargoPct = state.cargoCapacity > 0 ? (state.cargoUsed / state.cargoCapacity) * 100 : 0;
  setBar('bar-cargo', cargoPct);
  setText('v-cargo', state.cargoUsed + ' / ' + state.cargoCapacity + ' T');

  /* Tactical flags */
  const interdictedNow = hasFlag(FLAG.INTERDICTED);
  setClasses('sf-hardpoints', { active: hasFlag(FLAG.HARDPOINTS) });
  setClasses('sf-silent',     { active: hasFlag(FLAG.SILENT_RUN) });
  setClasses('sf-scoop',      { active: hasFlag(FLAG.SCOOPING) });
  setClasses('sf-mass',       { active: hasFlag(FLAG.MASS_LOCKED) });
  setClasses('sf-charge',     { active: hasFlag(FLAG.FSD_CHARGING) });
  const inDanger = hasFlag(FLAG.IN_DANGER) || interdictedNow;
  setClasses('sf-danger',   { active: inDanger,              'active-danger': inDanger });
  setClasses('sf-overheat', { active: hasFlag(FLAG.OVERHEATING), 'active-danger': hasFlag(FLAG.OVERHEATING) });
}

function renderPips() {
  ['sys', 'eng', 'wep'].forEach((type, i) => {
    const track = $('pips-' + type);
    if (!track) return;
    const halfPips = state.pips[i] || 0;
    track.innerHTML = '';
    for (let seg = 0; seg < 4; seg++) {
      const dot = document.createElement('div');
      dot.className = 'pip-dot';
      const fullCount = Math.floor(halfPips / 2);
      const isHalf    = (halfPips % 2 === 1) && (seg === fullCount);
      if (seg < fullCount) dot.classList.add('pip-full');
      else if (isHalf)     dot.classList.add('pip-half');
      track.appendChild(dot);
    }
  });
}

/* ── NAV tab rendering ──────────────────────────────────────────────────── */

function renderNav() {
  if (state.activeTab !== 'nav' && !state.hadData) return;

  setText('nav-system',  state.starSystem || '—');
  setText('nav-body',    state.body       || '');
  const navStn = $('nav-station');
  if (navStn) {
    navStn.textContent  = state.station || '';
    navStn.style.display = state.station ? '' : 'none';
  }

  const route      = state.route;
  const routeList  = $('nav-route-list');
  const destEl     = $('nav-dest');
  const jumpsEl    = $('nav-jumps');
  const jumpLbl    = $('nav-jumps-label');

  const hasRoute = route && route.length > 1;

  if (jumpsEl)  jumpsEl.textContent  = hasRoute ? (route.length - 1) : '—';
  if (jumpLbl)  jumpLbl.textContent  = hasRoute && route.length - 1 === 1 ? 'JUMP' : 'JUMPS';
  if (destEl)   destEl.textContent   = hasRoute ? route[route.length - 1].StarSystem : '—';

  if (!routeList) return;

  if (!hasRoute) {
    routeList.innerHTML = '<li class="route-empty">NO ROUTE PLOTTED</li>';
    return;
  }

  routeList.innerHTML = route.map((sys, i) => {
    const isCurrent = i === 0;
    const isDest    = i === route.length - 1;
    const starBadge = sys.StarClass
      ? `<span class="route-star route-star-${sys.StarClass}">${sys.StarClass}</span>`
      : '';
    const tag = isCurrent
      ? '<span class="route-tag route-tag-here">HERE</span>'
      : isDest
        ? '<span class="route-tag route-tag-dest">DEST</span>'
        : '';
    return `<li class="route-item${isCurrent ? ' route-current' : isDest ? ' route-dest' : ''}">` +
           `<span class="route-num">${isCurrent ? '●' : i}</span>` +
           `<span class="route-sys">${sys.StarSystem}</span>` +
           `${starBadge}${tag}</li>`;
  }).join('');
}

/* ── CARGO tab rendering ────────────────────────────────────────────────── */

function renderCargo() {
  const summaryEl = $('cargo-summary');
  if (summaryEl) summaryEl.textContent = state.cargoUsed + ' / ' + state.cargoCapacity + ' T';

  const listEl = $('cargo-list');
  if (!listEl) return;

  const items = state.manifest;
  if (!items || items.length === 0) {
    listEl.innerHTML = '<div class="list-empty">CARGO HOLD EMPTY</div>';
    return;
  }

  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  listEl.innerHTML = sorted.map(item => {
    const tags = [];
    if (item.stolen)   tags.push('<span class="item-tag tag-stolen">STOLEN</span>');
    if (item.missionId) tags.push('<span class="item-tag tag-mission">MISSION</span>');
    return `<div class="cargo-item">` +
           `<span class="cargo-name">${item.name}</span>` +
           `<span class="cargo-tags">${tags.join('')}</span>` +
           `<span class="cargo-count">${item.count} T</span>` +
           `</div>`;
  }).join('');
}

/* ── MISSIONS tab rendering ─────────────────────────────────────────────── */

function renderMissions() {
  const count   = state.missions.length;
  const badge   = $('mission-badge');
  const countEl = $('mission-count');

  if (badge) {
    badge.textContent  = count || '';
    badge.style.display = count > 0 ? 'inline-flex' : 'none';
  }
  if (countEl) countEl.textContent = count;

  const listEl = $('mission-list');
  if (!listEl) return;

  if (count === 0) {
    listEl.innerHTML = '<div class="list-empty">NO ACTIVE MISSIONS</div>';
    return;
  }

  // Sort: soonest expiry first
  const sorted = [...state.missions].sort((a, b) => {
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return new Date(a.expiry) - new Date(b.expiry);
  });

  listEl.innerHTML = sorted.map(m => {
    const timeStr  = formatTimeRemaining(m.expiry);
    const expired  = timeStr === 'EXPIRED';
    const rewardStr = m.reward ? formatCredits(m.reward) : '';
    const dest = [m.targetSystem, m.targetStation].filter(Boolean).join(' · ');
    return `<div class="mission-card${expired ? ' mission-expired' : ''}">` +
           `<div class="mission-name">${m.name}</div>` +
           (dest ? `<div class="mission-dest">◆ ${dest}</div>` : '') +
           `<div class="mission-footer">` +
           (rewardStr ? `<span class="mission-reward">${rewardStr}</span>` : '') +
           (timeStr   ? `<span class="mission-time${expired ? ' expired' : ''}">⏱ ${timeStr}</span>` : '') +
           `</div></div>`;
  }).join('');
}

/* ── Clock & mission timer ──────────────────────────────────────────────── */

function tickClock() { setText('h-clock', utcTime()); }

function tickMissions() {
  if (state.activeTab === 'missions' && state.missions.length > 0) renderMissions();
}

/* ── iCUE integration ───────────────────────────────────────────────────── */

function getIcueProperty(name) {
  if (typeof window !== 'undefined' && Object.prototype.hasOwnProperty.call(window, name)) {
    const v = window[name];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  try {
    return Function('return typeof ' + name + ' !== "undefined" ? ' + name + ' : undefined')();
  } catch (_) { return undefined; }
}

function onIcueDataUpdated()  { /* fixed theme — no user properties */ }
function onIcueInitialized()  { onIcueDataUpdated(); }

// Bare assignment — intentional; required by iCUE event bridge
icueEvents = {
  onDataUpdated:     onIcueDataUpdated,
  onICUEInitialized: onIcueInitialized,
};

if (typeof iCUE_initialized !== 'undefined' && iCUE_initialized) {
  onIcueInitialized();
} else {
  onIcueDataUpdated();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

// Wire up tab buttons
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

renderOverlays();
connect();
tickClock();
setInterval(tickClock,    1000);
setInterval(tickMissions, 10000);  // refresh mission countdowns
