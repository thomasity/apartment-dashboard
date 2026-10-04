import express from 'express';
import * as config from '../config';
import { genId } from '../util';
import type { Plant } from '../types';

const router = express.Router();

function getPlants(): Plant[] { return config.get('plants') ?? []; }
function savePlants(plants: Plant[]): void { config.set('plants', plants); }

router.get('/', (_req, res) => res.json(getPlants()));

router.post('/', (req, res) => {
  const { name, intervalDays } = req.body as { name?: string; intervalDays?: number | string };
  if (!name?.trim() || !intervalDays) return res.status(400).json({ error: 'name and intervalDays required' });
  const plant: Plant = { id: genId(), name: name.trim(), intervalDays: Number(intervalDays), lastWatered: null };
  const plants = getPlants();
  plants.push(plant);
  savePlants(plants);
  res.json(plant);
});

router.put('/:id', (req, res) => {
  const plants = getPlants();
  const idx    = plants.findIndex((p) => p.id === req.params.id);
  const existing = plants[idx];
  if (!existing) return res.status(404).json({ error: 'Plant not found' });
  const updated: Plant = { ...existing, ...(req.body as Partial<Plant>) };
  plants[idx] = updated;
  savePlants(plants);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  savePlants(getPlants().filter((p) => p.id !== req.params.id));
  res.json({ ok: true });
});

export default router;
