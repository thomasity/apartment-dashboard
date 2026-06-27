const express = require('express');
const config  = require('../config');
const router  = express.Router();

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getPlants() { return config.get('plants') ?? []; }
function savePlants(p) { config.set('plants', p); }

router.get('/', (_req, res) => res.json(getPlants()));

router.post('/', (req, res) => {
  const { name, intervalDays } = req.body;
  if (!name?.trim() || !intervalDays) return res.status(400).json({ error: 'name and intervalDays required' });
  const plant = { id: genId(), name: name.trim(), intervalDays: Number(intervalDays), lastWatered: null };
  const plants = getPlants();
  plants.push(plant);
  savePlants(plants);
  res.json(plant);
});

router.put('/:id', (req, res) => {
  const plants = getPlants();
  const idx    = plants.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Plant not found' });
  plants[idx] = { ...plants[idx], ...req.body };
  savePlants(plants);
  res.json(plants[idx]);
});

router.delete('/:id', (req, res) => {
  savePlants(getPlants().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

module.exports = router;
