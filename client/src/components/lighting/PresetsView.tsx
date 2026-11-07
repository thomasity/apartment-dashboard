import PRESETS from "../../presets.json";
import { avg, tempLabel } from "./utils";
import { useLighting } from "../../hooks/useLighting";
import styles from "./PresetsView.module.css";
import controlStyles from "./ControlsView.module.css";

export default function PresetsView() {
  const { serverState, localDevices, applyPreset } = useLighting();
  const offline = !serverState.connected;
  // Match ControlsView: powered-off bulbs don't count toward the current look
  const poweredOff = serverState.poweredOff ?? [];
  const onDevices = Object.fromEntries(
    Object.entries(localDevices).filter(([n]) => !poweredOff.includes(n)),
  );
  const allBrightness = avg(onDevices, "brightness");
  const allColorTemp = avg(onDevices, "colorTemp");
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
              onClick={() => applyPreset(preset)}
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
