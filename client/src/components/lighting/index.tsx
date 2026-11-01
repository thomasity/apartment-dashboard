import { useState } from "react";
import ControlsView from "./ControlsView";
import PresetsView from "./PresetsView";
import ScheduleView from "./ScheduleView";
import DevicesView from "./DevicesView";
import styles from "./index.module.css";

export default function Lighting() {
  const [view, setView] = useState("controls");

  return (
    <div className={styles.root}>
      {/* Nav pill */}
      <div className={styles.tabBar}>
        <div className={styles.tabs}>
          {["controls", "presets", "rules", "devices"].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`${styles.tab} ${
                view === v ? styles.tabActive : styles.tabIdle
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "controls" && (
        <ControlsView onGoToDevices={() => setView("devices")} />
      )}
      {view === "presets" && <PresetsView />}
      {view === "rules" && <ScheduleView />}
      {view === "devices" && <DevicesView />}
    </div>
  );
}
