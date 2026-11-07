import React from "react";
import type {
  RuleAction,
  RuleActionType,
  RuleConfig,
  RuleFormState,
  RulePresence,
  RoomsMap,
} from "../../types";
import { tempLabel } from "./utils";
import styles from "./RuleForm.module.css";

interface RuleFormProps {
  editId: string | null;
  rooms: RoomsMap;
  form: RuleFormState;
  setForm: React.Dispatch<React.SetStateAction<RuleFormState>>;
  onSave: () => void;
  onCancel: () => void;
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];
const RULE_TIME_OPTIONS = ["sunrise", "sunset", "fixed"];
const END_OPTIONS = ["none", "sunrise", "sunset", "fixed"] as const;

const NIGHT_LIGHT: RulePresence = { mode: "custom", brightness: 10, colorTemp: 0, vacantAfterMinutes: 2 };

/** What presence should do by default once a rule has an end: night light for an "off"
 *  window, business as usual for a scene, otherwise stay out of it. */
function defaultPresence(action: RuleAction): RulePresence {
  if (action.type === "power" && !action.on) return NIGHT_LIGHT;
  if (action.config === "scene") return { mode: "normal" };
  return { mode: "ignore" };
}

export default function RuleForm({
  editId,
  rooms,
  form,
  setForm,
  onSave,
  onCancel,
}: RuleFormProps) {
  const toggleDay = (day: number) => {
    setForm((f) => {
      const days = f.days.includes(day)
        ? f.days.filter((d) => d !== day)
        : [...f.days, day];

      return {
        ...f,
        days,
      };
    });
  };
  const setAction = (patch: Partial<RuleAction>) =>
    setForm((f) => ({ ...f, action: { ...f.action, ...patch } }));
  const setPresence = (patch: Partial<RulePresence>) =>
    setForm((f) => ({ ...f, presence: { ...(f.presence ?? { mode: "normal" }), ...patch } }));

  const endKind = !form.end ? "none" : form.end === "sunrise" || form.end === "sunset" ? form.end : "fixed";
  const setEnd = (kind: (typeof END_OPTIONS)[number]) =>
    setForm((f) => {
      const end =
        kind === "none" ? undefined
        : kind === "fixed" ? (f.end && f.end !== "sunrise" && f.end !== "sunset" ? f.end : "07:00")
        : kind;
      return { ...f, end, presence: end ? (f.presence ?? defaultPresence(f.action)) : undefined };
    });
  const presence = form.presence ?? { mode: "normal" };
  return (
    <div className={styles.backdrop} onClick={onCancel} data-no-swipe>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>
            {editId ? "Edit Rule" : "New Rule"}
          </span>
          <button onClick={onCancel} className={styles.close}>
            ✕
          </button>
        </div>

        {/* Name */}
        <div className={styles.field}>
          <label className={styles.label}>Name</label>
          <input
            autoFocus
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Bedtime"
            className={styles.nameInput}
          />
        </div>

        {/* Time */}
        <div className={styles.group}>
          <label className={styles.label}>Time</label>
          <div className={styles.options}>
            {RULE_TIME_OPTIONS.map((opt) => {
              const active =
                opt === "fixed"
                  ? form.time !== "sunrise" && form.time !== "sunset"
                  : form.time === opt;
              return (
                <button
                  key={opt}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      time:
                        opt === "fixed"
                          ? f.time === "sunrise" || f.time === "sunset"
                            ? "07:00"
                            : f.time
                          : opt,
                    }))
                  }
                  className={`${styles.option} ${
                    active ? styles.optionSelected : styles.optionIdle
                  }`}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {form.time !== "sunrise" && form.time !== "sunset" && (
            <input
              type="time"
              value={form.time}
              onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
              className={styles.timeInput}
            />
          )}
        </div>

        {/* End — turns the rule into a window that stays in effect */}
        <div className={styles.group}>
          <label className={styles.label}>Until</label>
          <div className={styles.options}>
            {END_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => setEnd(opt)}
                className={`${styles.option} ${
                  endKind === opt ? styles.optionSelected : styles.optionIdle
                }`}
              >
                {opt === "none" ? "no end" : opt}
              </button>
            ))}
          </div>
          {endKind === "fixed" && (
            <input
              type="time"
              value={form.end}
              onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
              className={styles.timeInput}
            />
          )}
        </div>

        {/* Days */}
        <div className={styles.group}>
          <label className={styles.label}>Days</label>
          <div className={styles.options}>
            {DAYS.map((label, i) => (
              <button
                key={i}
                onClick={() => toggleDay(i)}
                className={`${styles.day} ${
                  form.days.includes(i) ? styles.daySelected : styles.dayIdle
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Rule type */}
        <div className={styles.group}>
          <label className={styles.label}>Rule Type</label>
          <div className={styles.options}>
            {(
              [
                { key: "power" as RuleActionType, label: "Power" },
                { key: "reconfigure" as RuleActionType, label: "Reconfigure" },
              ] as { key: RuleActionType; label: string }[]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() =>
                  setAction({
                    type: key,
                    on: key === "power" ? (form.action.on ?? true) : undefined,
                    config:
                      key === "power"
                        ? (form.action.config ?? "none")
                        : form.action.config === "none"
                          ? "scene"
                          : form.action.config,
                  })
                }
                className={`${styles.optionPlain} ${
                  form.action.type === key
                    ? styles.optionSelected
                    : styles.optionIdle
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Target */}
        <div className={styles.group}>
          <label className={styles.label}>Target</label>
          <div className={styles.chips}>
            <button
              onClick={() => setAction({ group: "all" })}
              className={`${styles.chip} ${
                form.action.group === "all"
                  ? styles.chipSelected
                  : styles.chipIdle
              }`}
            >
              All lights
            </button>
            {Object.entries(rooms).map(([id, room]) => (
              <button
                key={id}
                onClick={() => setAction({ group: id })}
                className={`${styles.chip} ${
                  form.action.group === id
                    ? styles.chipSelected
                    : styles.chipIdle
                }`}
              >
                {room.name}
              </button>
            ))}
          </div>
        </div>

        {/* Power: on/off */}
        {form.action.type === "power" && (
          <div className={styles.powerOptions}>
            {[
              { label: "Turn On", on: true },
              { label: "Turn Off", on: false },
            ].map(({ label, on }) => (
              <button
                key={label}
                onClick={() =>
                  setAction({
                    on,
                    config: on ? (form.action.config ?? "none") : undefined,
                  })
                }
                className={`${styles.powerOption} ${
                  form.action.on === on
                    ? styles.optionSelected
                    : styles.optionIdle
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Power on config / Reconfigure mode */}
        {(form.action.type === "reconfigure" ||
          (form.action.type === "power" && form.action.on)) && (
          <div className={styles.group}>
            <label className={styles.label}>
              {form.action.type === "power" ? "On Config" : "Mode"}
            </label>
            <div className={styles.options}>
              {(form.action.type === "power"
                ? [
                    { key: "none" as RuleConfig, label: "Resume" },
                    { key: "scene" as RuleConfig, label: "Scene" },
                    { key: "auto" as RuleConfig, label: "Auto" },
                  ]
                : [
                    { key: "scene" as RuleConfig, label: "Scene" },
                    { key: "auto" as RuleConfig, label: "Auto" },
                  ]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setAction({ config: key })}
                  className={`${styles.optionPlain} ${
                    form.action.config === key
                      ? styles.optionSelected
                      : styles.optionIdle
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Scene sliders */}
        {form.action.config === "scene" && (
          <div className={styles.sceneFields}>
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label}>Brightness</label>
                <span className={styles.fieldValue}>
                  {form.action.brightness ?? 70}%
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                value={form.action.brightness ?? 70}
                onChange={(e) =>
                  setAction({ brightness: Number(e.target.value) })
                }
                className={styles.brightnessInput}
              />
            </div>
            <div className={styles.field}>
              <div className={styles.fieldHeader}>
                <label className={styles.label}>Color Temp</label>
                <span className={styles.fieldValue}>
                  {tempLabel(form.action.colorTemp ?? 0)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={form.action.colorTemp ?? 0}
                onChange={(e) =>
                  setAction({ colorTemp: Number(e.target.value) })
                }
                className={styles.colorTempInput}
              />
            </div>
          </div>
        )}

        {/* Presence while the window is in effect */}
        {form.end && (
          <div className={styles.group}>
            <label className={styles.label}>When presence is detected</label>
            <div className={styles.options}>
              {(
                [
                  { key: "ignore", label: "Ignore" },
                  { key: "normal", label: "Normal" },
                  { key: "custom", label: "Custom look" },
                ] as { key: RulePresence["mode"]; label: string }[]
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setForm((f) => ({ ...f, presence: key === "custom" ? { ...NIGHT_LIGHT, ...f.presence, mode: key } : { mode: key } }))}
                  className={`${styles.optionPlain} ${
                    presence.mode === key ? styles.optionSelected : styles.optionIdle
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {presence.mode === "custom" && (
              <div className={styles.sceneFields}>
                <div className={styles.field}>
                  <div className={styles.fieldHeader}>
                    <label className={styles.label}>Brightness</label>
                    <span className={styles.fieldValue}>{presence.brightness ?? 10}%</span>
                  </div>
                  <input
                    type="range" min="1" max="100"
                    value={presence.brightness ?? 10}
                    onChange={(e) => setPresence({ brightness: Number(e.target.value) })}
                    className={styles.brightnessInput}
                  />
                </div>
                <div className={styles.field}>
                  <div className={styles.fieldHeader}>
                    <label className={styles.label}>Color Temp</label>
                    <span className={styles.fieldValue}>{tempLabel(presence.colorTemp ?? 0)}</span>
                  </div>
                  <input
                    type="range" min="0" max="100"
                    value={presence.colorTemp ?? 0}
                    onChange={(e) => setPresence({ colorTemp: Number(e.target.value) })}
                    className={styles.colorTempInput}
                  />
                </div>
                <div className={styles.field}>
                  <div className={styles.fieldHeader}>
                    <label className={styles.label}>Off after empty</label>
                    <span className={styles.fieldValue}>{presence.vacantAfterMinutes ?? 2} min</span>
                  </div>
                  <input
                    type="range" min="1" max="30"
                    value={presence.vacantAfterMinutes ?? 2}
                    onChange={(e) => setPresence({ vacantAfterMinutes: Number(e.target.value) })}
                    className={styles.brightnessInput}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Manual sessions */}
        <div className={styles.group}>
          <label className={styles.label}>Rooms you've adjusted</label>
          <div className={styles.options}>
            {[
              { value: false, label: "Leave alone" },
              { value: true,  label: "Override manual" },
            ].map(({ value, label }) => (
              <button
                key={label}
                onClick={() => setForm((f) => ({ ...f, overrideManual: value }))}
                className={`${styles.optionPlain} ${
                  !!form.overrideManual === value ? styles.optionSelected : styles.optionIdle
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Save */}
        <button
          onClick={onSave}
          disabled={!form.name.trim() || !form.time || form.days.length === 0}
          className={styles.save}
        >
          {editId ? "Save Changes" : "Add Rule"}
        </button>
      </div>
    </div>
  );
}
