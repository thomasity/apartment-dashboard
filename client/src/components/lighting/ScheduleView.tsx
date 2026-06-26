import { useState, useEffect } from 'react';
import axios from 'axios';
import { TrashIcon } from '../icons';
import type { Rule, RuleAction, RuleActionType, RuleConfig, RoomsMap } from '../../types';

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt12(timeStr: string): string {
  if (timeStr === 'sunrise') return 'Sunrise';
  if (timeStr === 'sunset')  return 'Sunset';
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const period = h < 12 ? 'AM' : 'PM';
  const h12    = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function fmtDays(days: number[]): string {
  if (!days || days.length === 0) return '—';
  if (days.length === 7) return 'Every day';
  const sorted = [...days].sort();
  if (sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => sorted.includes(d))) return 'Weekdays';
  if (sorted.length === 2 && [0, 6].every((d) => sorted.includes(d))) return 'Weekends';
  return sorted.map((d) => DAY_NAMES[d]).join(', ');
}

function fmtAction(action: RuleAction): string {
  if (!action) return '';
  const target = action.group === 'all' ? 'All lights' : action.group;
  if (action.type === 'power') {
    if (!action.on) return `Turn off · ${target}`;
    if (action.config === 'scene')  return `Turn on · Scene ${action.brightness}% · ${target}`;
    if (action.config === 'auto')   return `Turn on · Auto · ${target}`;
    return `Turn on · ${target}`;
  }
  if (action.type === 'reconfigure') {
    if (action.config === 'scene') return `Scene ${action.brightness}% · ${target}`;
    if (action.config === 'auto')  return `Enable auto · ${target}`;
  }
  return '';
}

interface FormState {
  name: string;
  time: string;
  days: number[];
  action: RuleAction;
}

const BLANK_FORM: FormState = {
  name:   '',
  time:   '22:00',
  days:   [1, 2, 3, 4, 5],
  action: { type: 'power', group: 'all', on: true, config: 'none', brightness: 70, colorTemp: 20 },
};

interface Props {
  rooms: RoomsMap;
}

export default function ScheduleView({ rooms }: Props) {
  const [rules,     setRules]     = useState<Rule[]>([]);
  const [showForm,  setShowForm]  = useState(false);
  const [editId,    setEditId]    = useState<string | null>(null);
  const [form,      setForm]      = useState<FormState>(BLANK_FORM);

  useEffect(() => {
    axios.get('/api/lighting/rules').then((r) => setRules(r.data)).catch(() => {});
  }, []);

  const refetch = () => axios.get('/api/lighting/rules').then((r) => setRules(r.data)).catch(() => {});

  const openAdd = () => {
    setEditId(null);
    setForm(BLANK_FORM);
    setShowForm(true);
  };

  const openEdit = (rule: Rule) => {
    setEditId(rule.id);
    setForm({
      name:   rule.name,
      time:   rule.time,
      days:   rule.days,
      action: { ...rule.action },
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditId(null); };

  const saveForm = async () => {
    if (!form.name.trim() || !form.time || form.days.length === 0) return;
    if (editId) {
      await axios.patch(`/api/lighting/rules/${editId}`, form).catch(console.warn);
    } else {
      await axios.post('/api/lighting/rules', form).catch(console.warn);
    }
    await refetch();
    closeForm();
  };

  const toggleEnabled = async (rule: Rule) => {
    await axios.patch(`/api/lighting/rules/${rule.id}`, { enabled: !rule.enabled }).catch(console.warn);
    refetch();
  };

  const deleteRule = async (id: string) => {
    await axios.delete(`/api/lighting/rules/${id}`).catch(console.warn);
    refetch();
  };

  const toggleDay = (day: number) => {
    setForm((f) => ({
      ...f,
      days: f.days.includes(day) ? f.days.filter((d) => d !== day) : [...f.days, day],
    }));
  };

  const setAction = (patch: Partial<RuleAction>) => setForm((f) => ({ ...f, action: { ...f.action, ...patch } }));

  const roomNames = Object.keys(rooms);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto px-8 py-6 gap-4 relative">

      <div className="flex items-center justify-between shrink-0">
        <span className="text-[11px] uppercase tracking-widest text-white/30 font-medium">Scheduled Rules</span>
        <button
          onClick={openAdd}
          className="text-xs text-white/30 hover:text-white/60 touch-manipulation transition-colors"
        >
          + Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 pb-8">
          <p className="text-[11px] uppercase tracking-widest text-white/20">No rules yet</p>
          <p className="text-[11px] text-white/15">Add a rule to automate your lights on a schedule</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center gap-3 px-4 py-3 rounded-card transition-colors ${
                rule.enabled ? 'bg-white/[0.05]' : 'bg-white/[0.02] opacity-50'
              }`}
            >
              <button onClick={() => openEdit(rule)} className="flex-1 min-w-0 text-left touch-manipulation">
                <div className="text-sm font-semibold text-white/70 truncate">{rule.name}</div>
                <div className="text-[10px] text-white/30 mt-0.5">
                  {fmt12(rule.time)} · {fmtDays(rule.days)}
                </div>
                <div className="text-[10px] text-white/20 mt-0.5">{fmtAction(rule.action)}</div>
              </button>

              {/* Enabled toggle */}
              <button
                onClick={() => toggleEnabled(rule)}
                className={`w-10 h-6 rounded-full relative shrink-0 touch-manipulation transition-colors ${
                  rule.enabled ? 'bg-accent/40' : 'bg-white/[0.10]'
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${
                    rule.enabled ? 'left-5' : 'left-1'
                  }`}
                />
              </button>

              <button
                onClick={() => deleteRule(rule.id)}
                className="p-2 text-white/20 hover:text-danger/60 touch-manipulation transition-colors shrink-0"
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Form sheet ── */}
      {showForm && (
        <div className="absolute inset-0 z-30 flex flex-col justify-end" onClick={closeForm}>
          <div
            className="bg-zinc-900 border-t border-white/10 px-5 pt-5 pb-8 rounded-t-2xl flex flex-col gap-5 max-h-[85%] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-white/60">{editId ? 'Edit Rule' : 'New Rule'}</span>
              <button onClick={closeForm} className="text-white/30 hover:text-white/60 text-xl leading-none touch-manipulation">✕</button>
            </div>

            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Name</label>
              <input
                autoFocus
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Bedtime"
                className="bg-white/[0.06] text-white/80 placeholder-white/20 text-sm rounded-lg px-3 py-2.5 outline-none ring-1 ring-white/[0.08] focus:ring-white/20"
              />
            </div>

            {/* Time */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Time</label>
              <div className="flex gap-2">
                {(['sunrise', 'sunset', 'fixed'] as const).map((opt) => {
                  const active = opt === 'fixed' ? (form.time !== 'sunrise' && form.time !== 'sunset') : form.time === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setForm((f) => ({
                        ...f,
                        time: opt === 'fixed'
                          ? (f.time === 'sunrise' || f.time === 'sunset' ? '07:00' : f.time)
                          : opt,
                      }))}
                      className={`px-4 py-2 rounded-lg text-xs font-medium capitalize touch-manipulation transition-colors ${
                        active
                          ? 'bg-accent/25 text-accent ring-1 ring-accent/40'
                          : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10]'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
              {form.time !== 'sunrise' && form.time !== 'sunset' && (
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="bg-white/[0.06] text-white/80 text-sm rounded-lg px-3 py-2.5 outline-none ring-1 ring-white/[0.08] focus:ring-white/20 w-36"
                />
              )}
            </div>

            {/* Days */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Days</label>
              <div className="flex gap-2">
                {DAYS.map((label, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`w-9 h-9 rounded-full text-xs font-medium touch-manipulation transition-colors ${
                      form.days.includes(i)
                        ? 'bg-accent/30 text-accent ring-1 ring-accent/40'
                        : 'bg-white/[0.06] text-white/35 hover:bg-white/[0.10]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Rule type */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Rule Type</label>
              <div className="flex gap-2">
                {([
                  { key: 'power' as RuleActionType, label: 'Power' },
                  { key: 'reconfigure' as RuleActionType, label: 'Reconfigure' },
                ] as { key: RuleActionType; label: string }[]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setAction({ type: key, on: key === 'power' ? (form.action.on ?? true) : undefined, config: key === 'power' ? (form.action.config ?? 'none') : (form.action.config === 'none' ? 'scene' : form.action.config) })}
                    className={`px-4 py-2 rounded-lg text-xs font-medium touch-manipulation transition-colors ${
                      form.action.type === key
                        ? 'bg-accent/25 text-accent ring-1 ring-accent/40'
                        : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target */}
            <div className="flex flex-col gap-2">
              <label className="text-[10px] uppercase tracking-widest text-white/30">Target</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setAction({ group: 'all' })}
                  className={`px-3 py-1.5 rounded-full text-xs touch-manipulation transition-colors ${
                    form.action.group === 'all'
                      ? 'bg-white/[0.15] text-white/80'
                      : 'bg-white/[0.05] text-white/35 hover:bg-white/[0.10]'
                  }`}
                >
                  All lights
                </button>
                {roomNames.map((r) => (
                  <button
                    key={r}
                    onClick={() => setAction({ group: r })}
                    className={`px-3 py-1.5 rounded-full text-xs touch-manipulation transition-colors ${
                      form.action.group === r
                        ? 'bg-white/[0.15] text-white/80'
                        : 'bg-white/[0.05] text-white/35 hover:bg-white/[0.10]'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Power: on/off */}
            {form.action.type === 'power' && (
              <div className="flex gap-3">
                {[{ label: 'Turn On', on: true }, { label: 'Turn Off', on: false }].map(({ label, on }) => (
                  <button
                    key={label}
                    onClick={() => setAction({ on, config: on ? (form.action.config ?? 'none') : undefined })}
                    className={`flex-1 py-2.5 rounded-lg text-sm font-medium touch-manipulation transition-colors ${
                      form.action.on === on
                        ? 'bg-accent/25 text-accent ring-1 ring-accent/40'
                        : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Power on config / Reconfigure mode */}
            {(form.action.type === 'reconfigure' || (form.action.type === 'power' && form.action.on)) && (
              <div className="flex flex-col gap-2">
                <label className="text-[10px] uppercase tracking-widest text-white/30">
                  {form.action.type === 'power' ? 'On Config' : 'Mode'}
                </label>
                <div className="flex gap-2">
                  {(form.action.type === 'power'
                    ? [{ key: 'none' as RuleConfig, label: 'Resume' }, { key: 'scene' as RuleConfig, label: 'Scene' }, { key: 'auto' as RuleConfig, label: 'Auto' }]
                    : [{ key: 'scene' as RuleConfig, label: 'Scene' }, { key: 'auto' as RuleConfig, label: 'Auto' }]
                  ).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setAction({ config: key })}
                      className={`px-4 py-2 rounded-lg text-xs font-medium touch-manipulation transition-colors ${
                        form.action.config === key
                          ? 'bg-accent/25 text-accent ring-1 ring-accent/40'
                          : 'bg-white/[0.06] text-white/40 hover:bg-white/[0.10]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Scene sliders */}
            {form.action.config === 'scene' && (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-widest text-white/30">Brightness</label>
                    <span className="text-[10px] text-white/40">{form.action.brightness ?? 70}%</span>
                  </div>
                  <input
                    type="range" min="1" max="100"
                    value={form.action.brightness ?? 70}
                    onChange={(e) => setAction({ brightness: Number(e.target.value) })}
                    className="w-full accent-white/60"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] uppercase tracking-widest text-white/30">Color Temp</label>
                    <span className="text-[10px] text-white/40">
                      {(form.action.colorTemp ?? 0) < 33 ? 'Warm' : (form.action.colorTemp ?? 0) < 67 ? 'Neutral' : 'Cool'}
                    </span>
                  </div>
                  <input
                    type="range" min="0" max="100"
                    value={form.action.colorTemp ?? 0}
                    onChange={(e) => setAction({ colorTemp: Number(e.target.value) })}
                    className="w-full"
                    style={{ accentColor: '#a8c8ff' }}
                  />
                </div>
              </div>
            )}

            {/* Save */}
            <button
              onClick={saveForm}
              disabled={!form.name.trim() || !form.time || form.days.length === 0}
              className="w-full py-3 rounded-xl bg-accent/25 text-accent font-semibold text-sm touch-manipulation transition-colors hover:bg-accent/35 disabled:opacity-30 disabled:pointer-events-none"
            >
              {editId ? 'Save Changes' : 'Add Rule'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
