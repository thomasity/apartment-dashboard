import express from 'express';
import * as home from '../services/home';
import { ServiceError, errorCode, errorMessage } from '../util';

// Home / away from your phone on the Wi-Fi (services/home.ts).
const router = express.Router();

function handle(fn: (req: express.Request, res: express.Response) => void): express.RequestHandler {
  return (req, res) => {
    try { fn(req, res); }
    catch (err) {
      const code = errorCode(err);
      res.status(code === 'NOT_FOUND' ? 404 : code ? 400 : 500).json({ error: errorMessage(err) });
    }
  };
}

router.get('/', (_req, res) => res.json(home.getState()));

// What the network scan sees, to pick your phone from
router.get('/devices', (_req, res) => res.json(home.devices()));

router.post('/phones', handle((req, res) => {
  const { mac, name } = req.body as { mac?: string; name?: string };
  if (!mac) throw new ServiceError('mac required', 'INVALID');
  home.addPhone(mac, name ?? '');
  res.json(home.getState());
}));

router.delete('/phones/:mac', handle((req, res) => {
  home.removePhone(req.params.mac!);
  res.json(home.getState());
}));

export default router;
