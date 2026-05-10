/* ── Elite Dangerous HUD — Widget Logic ─────────────────────────────────── */

/* ── Constants ──────────────────────────────────────────────────────────── */

const WS_URL          = 'ws://localhost:31337';
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

const GAME_MODES = {
  Open: 'OPEN', Solo: 'SOLO', Group: 'GROUP',
};

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

  // Status flags (from Status.json via journal server)
  flags: 0,

  // Ship
  shipName:     null,
  shipType:     null,
  shipIdent:    null,
  hullHealth:   1.0,
  shieldsUp:    true,
  maxJumpRange: 0,
  fuelCapacity: 8,
  cargoCapacity: 0,

  // Live data (from Status.json events)
  fuelMain:      0,
  fuelReservoir: 0,
  cargoUsed:     0,
  pips:          [2, 2, 2],
};

/* ── Helpers ────────────────────────────────────────────────────────────── */

function hasFlag(f) { return (state.flags & f) !== 0; }

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

/* ── WebSocket ──────────────────────────────────────────────────────────── */

function connect() {
  state.wsStatus = 'connecting';
  renderOverlays();

  try {
    const ws = new WebSocket(WS_URL);
    state.ws = ws;

    ws.onopen = () => {
      state.wsStatus = 'connected';
      state.reconnectDelay = RECONNECT_BASE;
      renderOverlays();
    };

    ws.onmessage = (ev) => {
      try { handleMessage(JSON.parse(ev.data)); }
      catch (e) { /* malformed frame — ignore */ }
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
  // elite-dangerous-journal-server emits:
  //   { type: 'NEW_EVENT',        payload: { event: '...', ... } }
  //   { type: 'NEW_STATUS_EVENT', payload: { Flags: ..., Fuel: {...}, ... } }
  // Some servers send bare journal objects — handle both shapes.
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
  if (p.Flags     !== undefined) state.flags        = p.Flags;
  if (p.Fuel) {
    if (p.Fuel.FuelMain      !== undefined) state.fuelMain      = p.Fuel.FuelMain;
    if (p.Fuel.FuelReservoir !== undefined) state.fuelReservoir = p.Fuel.FuelReservoir;
  }
  if (p.Cargo     !== undefined) state.cargoUsed  = p.Cargo;
  if (p.Pips)                    state.pips        = p.Pips;
  if (p.LegalState)              state.legalState  = p.LegalState;

  // Mirror shield flag into state
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
      if (e.Ship)                    state.shipType   = e.Ship_Localised || resolveShipType(e.Ship);
      if (e.ShipName)                state.shipName   = e.ShipName;
      if (e.ShipIdent)               state.shipIdent  = e.ShipIdent;
      break;

    case 'Location':
      if (e.StarSystem) state.starSystem = e.StarSystem;
      if (e.Body)       state.body       = e.Body;
      state.station = e.Docked ? (e.StationName || null) : null;
      state.hadData = true;
      break;

    case 'FSDJump':
      if (e.StarSystem)       state.starSystem = e.StarSystem;
      if (e.Body)             state.body       = e.Body;
      if (e.FuelLevel !== undefined) state.fuelMain = e.FuelLevel;
      state.station    = null;
      state.hadData    = true;
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
      break;

    case 'Undocked':
      state.station = null;
      break;

    case 'Loadout':
      state.shipType     = e.Ship_Localised || resolveShipType(e.Ship) || state.shipType;
      if (e.ShipName)              state.shipName     = e.ShipName;
      if (e.ShipIdent)             state.shipIdent    = e.ShipIdent;
      if (e.MaxJumpRange)          state.maxJumpRange = e.MaxJumpRange;
      if (e.FuelCapacity?.Main)    state.fuelCapacity = e.FuelCapacity.Main;
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

    case 'Cargo':
      if (e.Count !== undefined) state.cargoUsed = e.Count;
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

    case 'Statistics':
    case 'Progress':
    case 'Rank':
    case 'Reputation':
    case 'SquadronStartup':
    case 'Fileheader':
    case 'ClearSavedGame':
      break; // not needed for current panels
  }

  renderHUD();
}

/* ── Overlay rendering ──────────────────────────────────────────────────── */

function renderOverlays() {
  const connected  = state.wsStatus === 'connected';
  const connecting = state.wsStatus === 'connecting';
  const hasData    = state.hadData;

  // Full-screen connecting splash: shown until first meaningful data arrives
  show('overlay-connecting', !hasData);

  // Retained-data signal-lost overlay: shown when data is known but link is down
  show('overlay-lost', hasData && !connected);

  // Main HUD: visible once we have data
  show('hud-root', hasData);

  if (!hasData) {
    const msgs = {
      connecting:   'CONNECTING TO GALNET',
      connected:    'AWAITING COMMANDER DATA',
      disconnected: 'GALNET OFFLINE — RETRYING',
    };
    setText('connecting-msg', msgs[state.wsStatus] || 'CONNECTING TO GALNET');
  }
}

/* ── HUD rendering ──────────────────────────────────────────────────────── */

function renderHUD() {
  if (!state.hadData) return;

  /* ── Header ── */
  setText('h-name', state.commander ? 'CMDR ' + state.commander : 'CMDR');
  setText('h-mode', GAME_MODES[state.gameMode] || (state.gameMode || 'OPEN').toUpperCase());

  const legal       = state.legalState || 'Clean';
  const legalLabel  = LEGAL_LABELS[legal] || legal.toUpperCase();
  const isWanted    = DANGEROUS_LEGAL.has(legal);
  setText('h-legal', legalLabel);
  setClasses('h-legal', { 'is-wanted': isWanted });

  setText('h-credits', formatCredits(state.credits));

  /* ── Location ── */
  setText('p-system', state.starSystem || '—');
  setText('p-body',   state.body       || '');

  const stationVisible = !!state.station;
  show('p-station', stationVisible);
  if (stationVisible) setText('p-station', state.station);

  const docked     = hasFlag(FLAG.DOCKED)     || !!state.station;
  const landed     = hasFlag(FLAG.LANDED);
  const sc         = hasFlag(FLAG.SUPERCRUISE);
  const fsdJump    = hasFlag(FLAG.FSD_JUMP);
  const interdicted = hasFlag(FLAG.INTERDICTED);

  setClasses('flag-docked', { active: docked && !landed && !fsdJump });
  setClasses('flag-landed', { active: landed });
  setClasses('flag-sc',     { active: sc && !fsdJump && !docked });
  setClasses('flag-jump',   { active: fsdJump });
  setClasses('flag-intrdc', { active: interdicted, 'active-danger': interdicted });

  /* ── Ship ── */
  const hasCustomName = state.shipName && state.shipName.trim() !== '';
  setText('p-ship-name',  hasCustomName ? state.shipName.toUpperCase()   : (state.shipType || '—').toUpperCase());
  setText('p-ship-type',  hasCustomName ? (state.shipType || '')          : '');
  setText('p-ship-ident', state.shipIdent ? '[' + state.shipIdent + ']'  : '');
  setText('p-jump',       state.maxJumpRange ? state.maxJumpRange.toFixed(2) + ' LY' : '—');
  setText('p-cargo-cap',  state.cargoCapacity > 0 ? state.cargoCapacity + ' T'        : '—');

  renderPips();

  /* ── Hull ── */
  const hullPct = Math.round((state.hullHealth || 0) * 100);
  setBar('bar-hull', hullPct);
  setText('v-hull', hullPct + '%');

  const hullDanger  = hullPct <= 25;
  const hullWarn    = hullPct > 25 && hullPct <= 60;
  setClasses('bar-hull', { 'bar-danger': hullDanger, 'bar-warning': hullWarn });
  setClasses('v-hull',   { 'is-danger': hullDanger, 'is-warning': hullWarn });

  /* ── Shields ── */
  const shUp = state.shieldsUp || hasFlag(FLAG.SHIELDS_UP);
  setBar('bar-shield', shUp ? 100 : 0);
  setClasses('bar-shield', { 'bar-shield': shUp });
  // Remove blue shield class when down so bar shows red-ish empty state
  if (!shUp) {
    const bs = $('bar-shield');
    if (bs) { bs.style.width = '0%'; }
  }
  setText('v-shields', shUp ? '▲ UP' : '▼ DOWN');
  setClasses('v-shields', { 'is-shields-up': shUp, 'is-shields-down': !shUp });

  /* ── Fuel ── */
  const fuelPct = state.fuelCapacity > 0
    ? (state.fuelMain / state.fuelCapacity) * 100
    : 0;
  setBar('bar-fuel', fuelPct);
  setText('v-fuel', state.fuelMain.toFixed(1) + ' T');

  const lowFuel = hasFlag(FLAG.LOW_FUEL) || fuelPct < 25;
  setClasses('bar-fuel', { 'bar-danger': lowFuel });
  setClasses('v-fuel',   { 'is-danger': lowFuel });
  setText('v-fuel-res', state.fuelReservoir.toFixed(2) + ' T RES');

  /* ── Cargo ── */
  const cargoPct = state.cargoCapacity > 0
    ? (state.cargoUsed / state.cargoCapacity) * 100
    : 0;
  setBar('bar-cargo', cargoPct);
  setText('v-cargo', state.cargoUsed + ' / ' + state.cargoCapacity + ' T');

  /* ── Status flags ── */
  const overheat    = hasFlag(FLAG.OVERHEATING);
  const hardpoints  = hasFlag(FLAG.HARDPOINTS);
  const silentRun   = hasFlag(FLAG.SILENT_RUN);
  const scooping    = hasFlag(FLAG.SCOOPING);
  const massLocked  = hasFlag(FLAG.MASS_LOCKED);
  const fsdCharging = hasFlag(FLAG.FSD_CHARGING);
  const inDanger    = hasFlag(FLAG.IN_DANGER) || interdicted;

  setClasses('sf-hardpoints', { active: hardpoints });
  setClasses('sf-silent',     { active: silentRun });
  setClasses('sf-scoop',      { active: scooping });
  setClasses('sf-mass',       { active: massLocked });
  setClasses('sf-charge',     { active: fsdCharging });
  setClasses('sf-danger',     { active: inDanger, 'active-danger': inDanger });
  setClasses('sf-overheat',   { active: overheat, 'active-danger': overheat });
}

function renderPips() {
  ['sys', 'eng', 'wep'].forEach((type, i) => {
    const track = $('pips-' + type);
    if (!track) return;
    const halfPips = state.pips[i] || 0; // 0–8 half-pips; 4 full segments max
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

/* ── Clock ──────────────────────────────────────────────────────────────── */

function tickClock() { setText('h-clock', utcTime()); }

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

function onIcueDataUpdated() {
  // No user-configurable properties in this widget — fixed ED theme.
  // Stub retained for iCUE event bridge requirement.
}

function onIcueInitialized() {
  onIcueDataUpdated();
}

// Bare assignment — intentional; see lifecycle reference.
icueEvents = {
  onDataUpdated:    onIcueDataUpdated,
  onICUEInitialized: onIcueInitialized,
};

// Support direct browser opening during development
if (typeof iCUE_initialized !== 'undefined' && iCUE_initialized) {
  onIcueInitialized();
} else {
  onIcueDataUpdated();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

renderOverlays();   // show connecting screen immediately
connect();          // open WebSocket
tickClock();        // populate clock without waiting for interval
setInterval(tickClock, 1000);
