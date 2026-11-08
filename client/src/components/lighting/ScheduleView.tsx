import { useState, useEffect } from "react";
import axios from "axios";
import { TrashIcon } from "../icons";
import type { Rule, RuleAction, RuleFormState, RoomsMap, RuleSuggestion, RemovedRule } from "../../types";
import { useLighting } from "../../hooks/useLighting";
import { getSocket } from "../../lib/socket";
import RuleForm from "./RuleForm";
import styles from "./ScheduleView.module.css";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt12(timeStr: string): string {
  if (timeStr === "sunrise") return "Sunrise";
  if (timeStr === "sunset") return "Sunset";
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  if (h === undefined || m === undefined || isNaN(h) || isNaN(m)) return "";
  const period = h < 12 ? "AM" : "PM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function fmtDays(days: number[]): string {
  if (!days || days.length === 0) return "—";
  if (days.length === 7) return "Every day";
  const sorted = [...days].sort();
  if (sorted.length === 5 && [1, 2, 3, 4, 5].every((d) => sorted.includes(d)))
    return "Weekdays";
  if (sorted.length === 2 && [0, 6].every((d) => sorted.includes(d)))
    return "Weekends";
  return sorted.map((d) => DAY_NAMES[d]).join(", ");
}

function fmtAction(action: RuleAction, rooms: RoomsMap): string {
  if (!action) return "";
  const target = action.group === "all" ? "All lights" : (rooms[action.group]?.name ?? "Missing room");
  if (action.type === "power") {
    if (!action.on) return `Turn off · ${target}`;
    if (action.config === "scene")
      return `Turn on · Scene ${action.brightness}% · ${target}`;
    if (action.config === "auto") return `Turn on · Auto · ${target}`;
    return `Turn on · ${target}`;
  }
  if (action.type === "reconfigure") {
    if (action.config === "scene")
      return `Scene ${action.brightness}% · ${target}`;
    if (action.config === "auto") return `Enable auto · ${target}`;
  }
  return "";
}

const BLANK_FORM: RuleFormState = {
  name: "",
  time: "22:00",
  days: [1, 2, 3, 4, 5],
  action: {
    type: "power",
    group: "all",
    on: true,
    config: "none",
    brightness: 70,
    colorTemp: 20,
  },
};

/** A quiet card offering a rule for something you keep doing by hand. */
function SuggestionCard({ suggestion, onMake }: { suggestion: RuleSuggestion; onMake: () => void }) {
  const { dismissSuggestion } = useLighting();
  return (
    <div className={styles.suggestion}>
      <p className={styles.suggestionText}>{suggestion.text} Make it a rule?</p>
      <div className={styles.suggestionActions}>
        <button onClick={onMake} className={styles.suggestionMake}>Make rule</button>
        <button onClick={() => dismissSuggestion(suggestion.id, false)} className={styles.suggestionDismiss}>Not now</button>
        <button onClick={() => dismissSuggestion(suggestion.id, true)} className={styles.suggestionDismiss}>Never</button>
      </div>
    </div>
  );
}

export default function ScheduleView() {
  const { rooms, suggestion, acceptSuggestion } = useLighting();
  const [rules, setRules] = useState<Rule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(BLANK_FORM);
  /** The suggestion the open form was started from — cleared once the rule is saved */
  const [fromSuggestion, setFromSuggestion] = useState<string | null>(null);
  const [removed, setRemoved] = useState<RemovedRule[]>([]);
  const [showRemoved, setShowRemoved] = useState(false);

  const fetchRemoved = () =>
    axios
      .get<RemovedRule[]>("/api/lighting/rule-changes/removed")
      .then((r) => setRemoved(r.data))
      .catch(() => {});

  // Rules can change from voice or the assistant too, so follow the server's broadcasts
  useEffect(() => {
    axios
      .get("/api/lighting/rules")
      .then((r) => setRules(r.data))
      .catch(() => {});
    fetchRemoved();
    const onRules = (next: Rule[]) => {
      setRules(next);
      fetchRemoved();
    };
    const socket = getSocket();
    socket.on("lighting:rules", onRules);
    return () => {
      socket.off("lighting:rules", onRules);
    };
  }, []);

  const refetch = () =>
    axios
      .get("/api/lighting/rules")
      .then((r) => setRules(r.data))
      .catch(() => {});

  const restore = (changeId: string) =>
    axios.post(`/api/lighting/rule-changes/${changeId}/undo`).catch(console.warn);

  const openAdd = () => {
    setEditId(null);
    setFromSuggestion(null);
    setForm(BLANK_FORM);
    setShowForm(true);
  };

  const openSuggestion = (s: RuleSuggestion) => {
    setEditId(null);
    setFromSuggestion(s.id);
    setForm({ ...BLANK_FORM, ...s.rule, action: { ...BLANK_FORM.action, ...s.rule.action } });
    setShowForm(true);
  };

  const openEdit = (rule: Rule) => {
    setEditId(rule.id);
    setFromSuggestion(null);
    setForm({
      name: rule.name,
      time: rule.time,
      days: rule.days,
      action: { ...rule.action },
      end: rule.end,
      presence: rule.presence,
      overrideManual: rule.overrideManual,
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditId(null);
  };

  const saveForm = async () => {
    if (!form.name.trim() || !form.time || form.days.length === 0) return;
    if (editId) {
      // null (not undefined, which JSON drops) so removing an end/presence reaches the server
      await axios
        .patch(`/api/lighting/rules/${editId}`, { ...form, end: form.end ?? null, presence: form.end ? form.presence : null })
        .catch(console.warn);
    } else {
      const saved = await axios
        .post("/api/lighting/rules", form)
        .then(() => true)
        .catch((err) => {
          console.warn(err);
          return false;
        });
      if (saved && fromSuggestion) acceptSuggestion(fromSuggestion);
    }
    await refetch();
    closeForm();
  };

  const toggleEnabled = async (rule: Rule) => {
    await axios
      .patch(`/api/lighting/rules/${rule.id}`, { enabled: !rule.enabled })
      .catch(console.warn);
    refetch();
  };

  const deleteRule = async (id: string) => {
    await axios.delete(`/api/lighting/rules/${id}`).catch(console.warn);
    refetch();
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>Scheduled Rules</span>
        <button onClick={openAdd} className={styles.addButton}>
          + Add Rule
        </button>
      </div>

      {suggestion && <SuggestionCard suggestion={suggestion} onMake={() => openSuggestion(suggestion)} />}

      {rules.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>No rules yet</p>
          <p className={styles.emptyHint}>
            Add a rule to automate your lights on a schedule
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {rules.map((rule) => (
            <div
              key={rule.id}
              className={`${styles.rule} ${
                rule.enabled ? styles.ruleEnabled : styles.ruleDisabled
              }`}
            >
              <button
                onClick={() => openEdit(rule)}
                className={styles.ruleBody}
              >
                <div className={styles.ruleName}>
                  {rule.name}
                  {rule.createdBy === "assistant" && <span className={styles.madeBy}>assistant</span>}
                </div>
                <div className={styles.ruleWhen}>
                  {fmt12(rule.time)}{rule.end ? `–${fmt12(rule.end)}` : ""} · {fmtDays(rule.days)}
                </div>
                <div className={styles.ruleAction}>
                  {fmtAction(rule.action, rooms)}
                  {rule.end && rule.presence?.mode === "custom" && ` · night light ${rule.presence.brightness ?? 10}%`}
                  {rule.end && rule.presence?.mode === "ignore" && " · ignores presence"}
                  {rule.overrideManual && " · overrides manual"}
                </div>
              </button>

              {/* Enabled toggle */}
              <button
                onClick={() => toggleEnabled(rule)}
                className={`${styles.switch} ${
                  rule.enabled ? styles.switchOn : styles.switchOff
                }`}
              >
                <span
                  className={`${styles.switchKnob} ${
                    rule.enabled ? styles.switchKnobOn : styles.switchKnobOff
                  }`}
                />
              </button>

              <button
                onClick={() => deleteRule(rule.id)}
                className={styles.deleteButton}
              >
                <TrashIcon size={20} />
              </button>
            </div>
          ))}
        </div>
      )}

      {removed.length > 0 && (
        <div className={styles.removed}>
          <button onClick={() => setShowRemoved((v) => !v)} className={styles.removedToggle}>
            Recently removed ({removed.length}) {showRemoved ? "▾" : "▸"}
          </button>
          {showRemoved && removed.map(({ change, rule }) => (
            <div key={change.id} className={styles.removedRow}>
              <div className={styles.ruleBody}>
                <div className={styles.ruleName}>{rule.name}</div>
                <div className={styles.ruleWhen}>
                  Removed {new Date(change.at).toLocaleDateString([], { month: "short", day: "numeric" })}
                  {change.by === "assistant" ? " by the assistant" : change.by === "voice" ? " by voice" : ""}
                  {change.reason ? ` · ${change.reason}` : ""}
                </div>
              </div>
              <button onClick={() => restore(change.id)} className={styles.restoreButton}>Restore</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Form sheet ── */}
      {showForm && (
        <RuleForm
          editId={editId}
          rooms={rooms}
          form={form}
          setForm={setForm}
          onSave={saveForm}
          onCancel={closeForm}
        />
      )}
    </div>
  );
}
