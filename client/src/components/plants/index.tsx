import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import type { Plant } from '../../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(plant: Plant): number | null {
  if (!plant.lastWatered) return null;
  const next = new Date(plant.lastWatered);
  next.setDate(next.getDate() + plant.intervalDays);
  next.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((next.getTime() - now.getTime()) / 86400000);
}

function waterProgress(plant: Plant): number {
  const days = daysUntil(plant);
  if (days === null || days <= 0) return 0;
  return Math.min(100, (days / plant.intervalDays) * 100);
}

function fmtDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function nextWaterDate(plant: Plant): string {
  if (!plant.lastWatered) return '—';
  const next = new Date(plant.lastWatered);
  next.setDate(next.getDate() + plant.intervalDays);
  return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Color = 'green' | 'yellow' | 'red';

function status(days: number | null): { label: string; color: Color } {
  if (days === null) return { label: 'Never watered', color: 'red' };
  if (days < 0)      return { label: `${Math.abs(days)}d overdue`, color: 'red' };
  if (days === 0)    return { label: 'Water today',  color: 'yellow' };
  if (days === 1)    return { label: 'Due tomorrow', color: 'yellow' };
  return               { label: `In ${days} days`,  color: 'green' };
}

const BADGE: Record<Color, string> = {
  green:  'bg-green-500/10  text-green-400  border-green-500/20',
  yellow: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  red:    'bg-red-500/10    text-red-400    border-red-500/20',
};

const ACCENT: Record<Color, string> = {
  green:  'bg-green-500/50',
  yellow: 'bg-yellow-500/50',
  red:    'bg-red-500/50',
};

const BAR: Record<Color, string> = {
  green:  'bg-green-400',
  yellow: 'bg-yellow-400',
  red:    'bg-red-400',
};

function sortKey(p: Plant): number {
  const d = daysUntil(p);
  return d === null ? -9999 : d;
}

const BLANK = { name: '', intervalDays: '7' };

export default function Plants() {
  const [plants,   setPlants]   = useState<Plant[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form,     setForm]     = useState(BLANK);
  const [editId,   setEditId]   = useState<string | null>(null);
  const [watering, setWatering] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await axios.get<Plant[]>('/api/plants');
    setPlants([...data].sort((a, b) => sortKey(a) - sortKey(b)));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function water(id: string) {
    setWatering(id);
    await axios.put(`/api/plants/${id}`, { lastWatered: today() });
    await load();
    setWatering(null);
  }

  async function remove(id: string) {
    await axios.delete(`/api/plants/${id}`);
    load();
  }

  async function submitForm() {
    const name = form.name.trim();
    const intervalDays = parseInt(form.intervalDays, 10);
    if (!name || !intervalDays) return;
    if (editId) {
      await axios.put(`/api/plants/${editId}`, { name, intervalDays });
      setEditId(null);
    } else {
      await axios.post('/api/plants', { name, intervalDays });
    }
    setForm(BLANK);
    setShowForm(false);
    load();
  }

  function startEdit(plant: Plant) {
    setForm({ name: plant.name, intervalDays: String(plant.intervalDays) });
    setEditId(plant.id);
    setShowForm(true);
  }

  function cancelForm() {
    setForm(BLANK);
    setEditId(null);
    setShowForm(false);
  }

  return (
    <div className="h-full overflow-y-auto" data-no-swipe>
      <div className="px-4 pt-4 pb-6 space-y-3 max-w-lg mx-auto">

        {/* ── Add / Edit form ── */}
        {showForm ? (
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
            <p className="text-[11px] font-medium tracking-widest uppercase text-[--color-subtle-text]">
              {editId ? 'Edit Plant' : 'New Plant'}
            </p>
            <input
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[--color-text] placeholder:text-[--color-subtle-text] outline-none focus:border-white/25"
              placeholder="Plant name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <div className="flex items-center gap-3">
              <label className="text-xs text-[--color-subtle-text] shrink-0">Water every</label>
              <input
                type="number"
                min="1"
                className="w-20 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-[--color-text] outline-none focus:border-white/25"
                value={form.intervalDays}
                onChange={(e) => setForm((f) => ({ ...f, intervalDays: e.target.value }))}
              />
              <label className="text-xs text-[--color-subtle-text]">days</label>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={submitForm}
                className="flex-1 py-2 rounded-lg bg-white/10 text-sm text-[--color-text] hover:bg-white/15 active:bg-white/20 touch-manipulation"
              >
                {editId ? 'Save' : 'Add'}
              </button>
              <button
                onClick={cancelForm}
                className="flex-1 py-2 rounded-lg text-sm text-[--color-subtle-text] hover:bg-white/5 touch-manipulation"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-3 rounded-xl border border-dashed border-white/15 text-sm text-[--color-subtle-text] hover:bg-white/5 hover:border-white/25 transition-colors touch-manipulation"
          >
            + Add Plant
          </button>
        )}

        {/* ── Empty state ── */}
        {plants.length === 0 && !showForm && (
          <div className="flex flex-col items-center justify-center pt-16 gap-2">
            <span className="text-5xl opacity-20">🪴</span>
            <p className="text-[--color-subtle-text] text-sm mt-2">No plants yet.</p>
            <p className="text-[--color-subtle-text] text-xs opacity-50">Add a plant to start tracking watering schedules.</p>
          </div>
        )}

        {/* ── Plant cards ── */}
        {plants.map((plant) => {
          const days = daysUntil(plant);
          const { label, color } = status(days);
          const pct = waterProgress(plant);

          return (
            <div key={plant.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
              {/* Colored accent line */}
              <div className={`h-[3px] ${ACCENT[color]}`} />

              <div className="p-4">
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl shrink-0">🪴</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[--color-text] truncate">{plant.name}</p>
                      <p className="text-[11px] text-[--color-subtle-text] mt-0.5">Every {plant.intervalDays} days</p>
                    </div>
                  </div>
                  <span className={`shrink-0 text-[11px] font-medium px-2.5 py-1 rounded-full border ${BADGE[color]}`}>
                    {label}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="mt-3.5 space-y-1.5">
                  <div className="h-1 rounded-full bg-white/8 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${BAR[color]}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] text-[--color-subtle-text]">
                    <span>Last: {fmtDate(plant.lastWatered)}</span>
                    <span>Next: {nextWaterDate(plant)}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 mt-3.5">
                  <button
                    onClick={() => water(plant.id)}
                    disabled={watering === plant.id}
                    className="flex-1 py-2 rounded-lg bg-white/10 text-xs text-[--color-text] hover:bg-white/15 active:bg-white/20 disabled:opacity-50 touch-manipulation transition-opacity"
                  >
                    {watering === plant.id ? 'Watering…' : '💧 Watered today'}
                  </button>
                  <button
                    onClick={() => startEdit(plant)}
                    className="px-3 py-2 rounded-lg text-xs text-[--color-subtle-text] hover:bg-white/5 touch-manipulation"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(plant.id)}
                    className="px-3 py-2 rounded-lg text-xs text-red-400/60 hover:text-red-400 hover:bg-red-500/10 touch-manipulation transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
