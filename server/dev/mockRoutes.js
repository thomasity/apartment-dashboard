// Mock Express router — mounted before real routes when PROD=false.
// All POST/PUT control endpoints return { ok: true } so UI interactions work.

const express = require('express');
const router  = express.Router();
const mock    = require('./mockData');

const ok = (_req, res) => res.json({ ok: true });

// ── Lighting ──────────────────────────────────────────────────────────────────
router.get('/lighting/state',   (_req, res) => res.json(mock.lightingState));
router.get('/lighting/devices', (_req, res) => res.json(mock.devicesState));
router.get('/lighting/circadian', (_req, res) => res.json({ ...mock.circadianState, timeline: mock.circadianState.timeline }));
router.post('/lighting/set',       ok);
router.post('/lighting/power',     ok);
router.post('/lighting/pair',      ok);
router.post('/lighting/circadian', ok);
router.post('/lighting/devices/rename', ok);
router.post('/lighting/devices/remove', ok);

// ── Spotify ───────────────────────────────────────────────────────────────────
router.get('/spotify/now-playing', (_req, res) => res.json(mock.nowPlaying));
router.get('/spotify/devices',     (_req, res) => res.json(mock.spotifyDevices));
router.get('/spotify/playlists',   (_req, res) => res.json(mock.playlists));
router.get('/spotify/playlist/:id/tracks', (_req, res) => res.json(mock.playlistTracks));
router.post('/spotify/play',     ok);
router.post('/spotify/pause',    ok);
router.post('/spotify/next',     ok);
router.post('/spotify/previous', ok);
router.post('/spotify/seek',     ok);
router.post('/spotify/volume',   ok);
router.post('/spotify/shuffle',  ok);
router.post('/spotify/repeat',   ok);
router.post('/spotify/transfer', ok);

// ── Bluetooth ─────────────────────────────────────────────────────────────────
router.get('/bluetooth/devices', (_req, res) => res.json(mock.bluetoothDevices));
router.get('/bluetooth/scan',    (_req, res) => res.json([]));
router.post('/bluetooth/pair',       ok);
router.post('/bluetooth/connect',    ok);
router.post('/bluetooth/disconnect', ok);
router.delete('/bluetooth/device/:mac', ok);

// ── TV / Roku ─────────────────────────────────────────────────────────────────
router.get('/tv/status',       (_req, res) => res.json(mock.tvStatus));
router.get('/tv/apps',         (_req, res) => res.json(mock.tvApps));
router.get('/tv/icon/:appId',  (_req, res) => res.status(404).end());
router.post('/tv/keypress/:key',  ok);
router.post('/tv/launch/:appId',  ok);
router.post('/tv/type',           ok);

module.exports = router;
