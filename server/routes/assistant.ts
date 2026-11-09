import express from 'express';
import * as notices from '../services/notices';

// The assistant's remarks on dashboards (services/notices.ts).
const router = express.Router();

router.get('/notices', (_req, res) => res.json(notices.active()));

router.post('/notices/:id/dismiss', (req, res) => {
  if (!notices.dismiss(req.params.id)) return res.status(404).json({ error: 'No such note' });
  res.json({ ok: true });
});

router.post('/notices/:id/undo', (req, res) => {
  try {
    if (!notices.undo(req.params.id)) return res.status(404).json({ error: 'Nothing to undo' });
    res.json({ ok: true });
  } catch (err) {
    res.status(409).json({ error: (err as Error).message });
  }
});

// Check the setup: a test remark, delivered (and spoken) the way a real one would be
router.post('/notices/test', (_req, res) => {
  res.json(notices.notify({ text: 'This is a test remark from the assistant.' }));
});

export default router;
