#!/usr/bin/env node
/**
 * Elite Dangerous Journal WebSocket Server
 * Tails the active journal file and Status.json, broadcasting events to
 * connected iCUE widget clients at ws://localhost:31337.
 *
 * Message format (matches elite-dangerous-journal-server convention):
 *   Journal events  → { type: 'NEW_EVENT',        payload: { event: '...', ... } }
 *   Status updates  → { type: 'NEW_STATUS_EVENT',  payload: { Flags: ..., Fuel: {...}, ... } }
 *
 * Usage:
 *   npm install
 *   npm start        (or: node server.js)
 */

'use strict';

const http = require('http');
const WS   = require('ws');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

/* ── Configuration ──────────────────────────────────────────────────────── */

const PORT         = 31337;
const JOURNAL_DIR  = path.join(
  os.homedir(),
  'Saved Games', 'Frontier Developments', 'Elite Dangerous'
);
const STATUS_FILE  = path.join(JOURNAL_DIR, 'Status.json');
const POLL_JOURNAL = 500;   // ms between journal tail polls
const POLL_STATUS  = 1000;  // ms between Status.json polls
const REPLAY_MAX   = 300;   // recent events replayed to each new connection

/* ── Server setup ───────────────────────────────────────────────────────── */

const httpServer = http.createServer();
const wss        = new WS.WebSocketServer({ server: httpServer });
const clients    = new Set();

function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload });
  for (const ws of clients) {
    if (ws.readyState === WS.WebSocket.OPEN) ws.send(msg);
  }
}

/* ── Journal tailing ────────────────────────────────────────────────────── */

let journalFile = null;  // absolute path of the file we're tailing
let journalPos  = 0;     // byte offset — next unread byte
const replayBuf = [];    // circular buffer of recent parsed events

const JOURNAL_RE = /^Journal\.\d{4}-\d{2}-\d{2}T\d{6}\.\d+\.log$/;

function findLatestJournalFile() {
  try {
    const files = fs.readdirSync(JOURNAL_DIR).filter(f => JOURNAL_RE.test(f)).sort();
    return files.length ? path.join(JOURNAL_DIR, files[files.length - 1]) : null;
  } catch {
    return null;
  }
}

function readFromOffset(filePath, offset) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size <= offset) return offset;

    const fd  = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(stat.size - offset);
    const n   = fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);

    buf.slice(0, n).toString('utf8').split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      try {
        const obj = JSON.parse(line);
        replayBuf.push(obj);
        if (replayBuf.length > REPLAY_MAX) replayBuf.shift();
        broadcast('NEW_EVENT', obj);
      } catch { /* skip malformed lines */ }
    });

    return stat.size;
  } catch {
    return offset;
  }
}

function loadReplayBuffer(filePath) {
  try {
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    replayBuf.length = 0;
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        replayBuf.push(JSON.parse(t));
        if (replayBuf.length > REPLAY_MAX) replayBuf.shift();
      } catch { /* skip */ }
    }
  } catch { /* file unreadable */ }
}

function tickJournal() {
  const latest = findLatestJournalFile();

  if (!latest) {
    // Journal dir exists but no journal yet — game hasn't been started
    return;
  }

  if (latest !== journalFile) {
    // New game session: load existing content for replay, then start tailing end
    console.log(`[journal] Watching: ${path.basename(latest)}`);
    journalFile = latest;
    loadReplayBuffer(latest);
    journalPos = fs.statSync(latest).size;
    return;
  }

  // Same file: read any new lines written since last poll
  journalPos = readFromOffset(journalFile, journalPos);
}

/* ── Status.json polling ─────────────────────────────────────────────────── */

let lastStatusMtime = 0;
let lastStatus      = null;

function tickStatus() {
  try {
    const stat = fs.statSync(STATUS_FILE);
    if (stat.mtimeMs === lastStatusMtime) return;
    lastStatusMtime = stat.mtimeMs;
    const raw = fs.readFileSync(STATUS_FILE, 'utf8').trim();
    if (!raw) return;
    const parsed = JSON.parse(raw);
    lastStatus = parsed;
    broadcast('NEW_STATUS_EVENT', parsed);
  } catch { /* game not running or file locked */ }
}

/* ── WebSocket connections ──────────────────────────────────────────────── */

wss.on('connection', ws => {
  clients.add(ws);
  console.log(`[ws] Client connected  (${clients.size} total)`);

  // Replay recent journal events so the widget can reconstruct its state
  for (const event of replayBuf) {
    if (ws.readyState === WS.WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'NEW_EVENT', payload: event }));
    }
  }

  // Push current status immediately
  if (lastStatus && ws.readyState === WS.WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'NEW_STATUS_EVENT', payload: lastStatus }));
  }

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[ws] Client disconnected (${clients.size} total)`);
  });

  ws.on('error', () => clients.delete(ws));
});

/* ── Boot ───────────────────────────────────────────────────────────────── */

httpServer.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[error] Port ${PORT} already in use — is another journal server running?`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[server] Elite Dangerous Journal Server`);
  console.log(`[server] ws://localhost:${PORT}`);
  console.log(`[server] Journal dir: ${JOURNAL_DIR}`);

  if (!fs.existsSync(JOURNAL_DIR)) {
    console.warn(`[warn] Journal directory not found — is Elite Dangerous installed?`);
    console.warn(`[warn] Expected: ${JOURNAL_DIR}`);
  }

  // Start polling loops
  tickJournal();
  tickStatus();
  setInterval(tickJournal, POLL_JOURNAL);
  setInterval(tickStatus,  POLL_STATUS);
});

process.on('SIGINT',  () => { console.log('\n[server] Shutting down.'); process.exit(0); });
process.on('SIGTERM', () => { console.log('\n[server] Shutting down.'); process.exit(0); });
