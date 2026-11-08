import express from 'express';
import * as patterns from '../services/patterns';

// Your habits, as summarised from the logs each night (services/patterns.ts).
const router = express.Router();

router.get('/', (_req, res) => res.json(patterns.current()));

// Recompute now instead of waiting for 3:30 AM
router.post('/refresh', (_req, res) => res.json(patterns.refresh()));

export default router;
