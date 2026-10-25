import express from 'express';
import { checkInternet } from '../services/connectivity';

const router = express.Router();

router.get('/', async (_req, res) => {
  res.json({ online: await checkInternet() });
});

export default router;
