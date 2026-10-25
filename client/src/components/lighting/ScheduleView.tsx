import { useState, useEffect } from "react";
import axios from "axios";
import { TrashIcon } from "../icons";
import type { Rule, RuleAction, RoomsMap, RuleFormState } from "../../types";
import RuleForm from "./RuleForm";
import styles from './ScheduleView.module.css';

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function fmt12(timeStr: string): string {
  if (timeStr === "sunrise") return "Sunrise";
  if (timeStr === "sunset") return "Sunset";
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  if (!h || !m || isNaN(h) || isNaN(m)) return "";
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

function fmtAction(action: RuleAction): string {
  if (!action) return "";
  const target = action.group === "all" ? "All lights" : action.group;
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

interface Props {
  rooms: RoomsMap;
}

export default function ScheduleView({ rooms }: Props) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RuleFormState>(BLANK_FORM);

  useEffect(() => {
    axios
      .get("/api/lighting/rules")
      .then((r) => setRules(r.data))
      .catch(() => {});
  }, []);

  const refetch = () =>
    axios
      .get("/api/lighting/rules")
      .then((r) => setRules(r.data))
      .catch(() => {});

  const openAdd = () => {
    setEditId(null);
    setForm(BLANK_FORM);
    setShowForm(true);
  };

  const openEdit = (rule: Rule) => {
    setEditId(rule.id);
    setForm({
      name: rule.name,
      time: rule.time,
      days: rule.days,
      action: { ...rule.action },
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
      await axios
        .patch(`/api/lighting/rules/${editId}`, form)
        .catch(console.warn);
    } else {
      await axios.post("/api/lighting/rules", form).catch(console.warn);
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
        <span className={styles.title}>
          Scheduled Rules
        </span>
        <button
          onClick={openAdd}
          className={styles.addButton}
        >
          + Add Rule
        </button>
      </div>

      {rules.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>
            No rules yet
          </p>
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
                </div>
                <div className={styles.ruleWhen}>
                  {fmt12(rule.time)} · {fmtDays(rule.days)}
                </div>
                <div className={styles.ruleAction}>
                  {fmtAction(rule.action)}
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
                <TrashIcon />
              </button>
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
