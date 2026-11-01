import PRESETS from "../../presets.json";
import { avg, tempLabel } from "./utils";
import type { LightingValues } from "../../types";
import styles from "./PresetsView.module.css";
import controlStyles from "./ControlsView.module.css";

interface Props {
  offline: boolean;
  localDevices: Record<string, LightingValues>;
  onApplyPreset: (preset: LightingValues) => void;
}

export default function PresetsView({
  offline,
  localDevices,
  onApplyPreset,
}: Props) {
  const allBrightness = avg(localDevices, "brightness");
  const allColorTemp = avg(localDevices, "colorTemp");
  const activePreset = PRESETS.find(
    (p) => p.brightness === allBrightness && p.colorTemp === allColorTemp,
  );

  if (offline)
    return (
      <div className={controlStyles.empty}>
        <span
          className={`${controlStyles.emptyDot} ${offline ? controlStyles.emptyDotOffline : controlStyles.emptyDotOnline}`}
        />
        <p className={controlStyles.emptyTitle}>
          {offline ? "Bridge offline" : "No devices paired"}
        </p>
      </div>
    );

  return (
    <div className={styles.root}>
      <div className={styles.grid}>
        {PRESETS.map((preset) => {
          const isActive = activePreset?.label === preset.label;
          return (
            <button
              key={preset.label}
              onClick={() => onApplyPreset(preset)}
              className={`${styles.preset} ${
                isActive ? styles.presetActive : styles.presetIdle
              }`}
            >
              <span className={styles.presetIcon}>{preset.icon}</span>
              <div className={styles.presetText}>
                <span className={styles.presetName}>{preset.label}</span>
                <span className={styles.presetDetail}>
                  {preset.brightness}% · {tempLabel(preset.colorTemp)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
