import { useState } from 'react';
import { PowerIcon, ChevronDownIcon, ChevronRightIcon } from '../icons';
import { LightSliders } from '../LightSliders';
import AutoToggle from './AutoToggle';
import CircadianStrip from './CircadianStrip';
import { avg, spread, tempLabel } from './utils';
import type { LightingServerState, LightingValues, CircadianState, RoomsMap, OverridesMap } from '../../types';
import { formatTime } from '../../lib/format';
import styles from './ControlsView.module.css';

function PowerBtn({ isOff, onClick }: { isOff: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`${styles.powerButton} ${
        isOff
          ? styles.powerOff
          : styles.powerOn
      }`}
    >
      <PowerIcon />
    </button>
  );
}

interface DeviceRowProps {
  name: string;
  device: LightingValues;
  isCircadian: boolean;
  isOff: boolean;
  isOffline?: boolean;
  circadian: CircadianState;
  onBrightness: (v: number) => void;
  onColorTemp: (v: number) => void;
  onToggleCircadian: () => void;
  onTogglePower: () => void;
  brightnessMixed?: boolean;
  colorTempMixed?: boolean;
}

function DeviceRow({ name, device, isCircadian, isOff, isOffline, circadian, onBrightness, onColorTemp, onToggleCircadian, onTogglePower, brightnessMixed, colorTempMixed }: DeviceRowProps) {
  return (
    <div className={`${styles.deviceRow} ${isOffline ? styles.offline : ''}`}>
      <div className={styles.deviceHeader}>
        <span className={styles.deviceName}>{name}</span>
        {isOffline && <span className={styles.offlineTag}>Offline</span>}
      </div>
      <div className={styles.deviceControls}>
        <div className={`${styles.sliders} ${isOff ? styles.dimmed : ''}`}>
          {isCircadian
            ? <CircadianStrip circadian={circadian} />
            : <LightSliders
                brightness={device.brightness}
                colorTemp={device.colorTemp}
                tempLabel={tempLabel(device.colorTemp)}
                onBrightness={onBrightness}
                onColorTemp={onColorTemp}
                brightnessMixed={brightnessMixed}
                colorTempMixed={colorTempMixed}
              />
          }
        </div>
        <div className={styles.toggles}>
          <div className={isOff ? styles.dimmed : ''}>
            <AutoToggle on={isCircadian} onClick={onToggleCircadian} />
          </div>
          <PowerBtn isOff={isOff} onClick={onTogglePower} />
        </div>
      </div>
    </div>
  );
}

interface RoomSectionProps {
  name: string;
  deviceNames: string[];
  serverState: LightingServerState;
  localDevices: Record<string, LightingValues>;
  circadian: CircadianState;
  avail: Record<string, boolean>;
  overrides: OverridesMap;
  onRoomSlider: (roomName: string, key: keyof LightingValues, value: number) => void;
  onRoomTogglePower: (roomName: string) => void;
  onRoomToggleCircadian: (roomName: string) => void;
  onClearRoomOverride: (roomName: string) => void;
  onDeviceSlider: (name: string, key: keyof LightingValues, value: number) => void;
  onTogglePower: (name: string) => void;
  onToggleCircadian: (name: string) => void;
}

function RoomSection({
  name, deviceNames, serverState, localDevices, circadian, avail, overrides,
  onRoomSlider, onRoomTogglePower, onRoomToggleCircadian, onClearRoomOverride,
  onDeviceSlider, onTogglePower, onToggleCircadian,
}: RoomSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const poweredOff    = serverState.poweredOff ?? [];
  const enabledGroups = circadian.enabledGroups ?? [];
  const paired        = deviceNames.filter((n) => serverState.groups[n]);

  if (paired.length === 0) return null;

  const isRoomOff       = paired.every((n) => poweredOff.includes(n));
  const isRoomCircadian = paired.every((n) => enabledGroups.includes(n));

  const offlineCount   = paired.filter((n) => avail[n] === false).length;
  const isRoomOffline  = offlineCount > 0 && offlineCount === paired.length;
  const someOffline    = offlineCount > 0 && offlineCount < paired.length;

  const roomOnDevices  = Object.fromEntries(
    paired.filter((n) => !poweredOff.includes(n))
          .map((n) => [n, localDevices[n] ?? { brightness: 70, colorTemp: 30 }])
  );
  const roomBrightness  = avg(roomOnDevices, 'brightness');
  const roomColorTemp   = avg(roomOnDevices, 'colorTemp');
  const brightnessMixed = Object.keys(roomOnDevices).length > 1 && spread(roomOnDevices, 'brightness') > 5;
  const colorTempMixed  = Object.keys(roomOnDevices).length > 1 && spread(roomOnDevices, 'colorTemp')  > 5;

  const roomOverrideExpiry = paired.reduce((acc, n) => {
    return overrides[n] !== undefined ? Math.max(acc, overrides[n]) : acc;
  }, 0);
  const hasOverride = roomOverrideExpiry > 0;
  const remainingMs = hasOverride ? Math.max(0, roomOverrideExpiry - Date.now()) : 0;

  return (
    <div className={`${styles.room} ${isRoomOffline ? styles.roomOffline : ''}`}>
      {/* Room header row */}
      <div className={styles.roomHeader}>
        <button
          onClick={() => setExpanded((e) => !e)}
          className={styles.roomToggle}
        >
          <span className={styles.chevron}>
            {expanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          </span>
          <span className={styles.roomName}>{name}</span>
          <span className={styles.roomCount}>{paired.length}</span>
        </button>

        {isRoomOffline && (
          <span className={styles.roomOfflineTag}>Offline</span>
        )}
        {someOffline && !isRoomOffline && (
          <span className={styles.roomOfflineCount}>{offlineCount} offline</span>
        )}

        {hasOverride && (
          <span className={styles.overrideBadge}>
            Manual · {formatTime(remainingMs)}
            <button
              onClick={() => onClearRoomOverride(name)}
              className={styles.overrideClear}
              title="Resume auto"
            >
              ✕
            </button>
          </span>
        )}

        <div className={isRoomOff || isRoomOffline ? styles.dimmed : ''}>
          <AutoToggle on={isRoomCircadian} onClick={() => onRoomToggleCircadian(name)} />
        </div>
        <PowerBtn isOff={isRoomOff} onClick={() => onRoomTogglePower(name)} />
      </div>

      {/* Room-level sliders — always visible */}
      <div className={`${styles.roomSliders} ${isRoomOff || isRoomOffline ? styles.dimmed : ''}`}>
        {isRoomCircadian
          ? <CircadianStrip circadian={circadian} />
          : <LightSliders
              brightness={roomBrightness}
              colorTemp={roomColorTemp}
              tempLabel={tempLabel(roomColorTemp)}
              onBrightness={(v) => onRoomSlider(name, 'brightness', v)}
              onColorTemp={(v) => onRoomSlider(name, 'colorTemp', v)}
              brightnessMixed={brightnessMixed}
              colorTempMixed={colorTempMixed}
            />
        }
      </div>

      {/* Individual devices — expanded */}
      {expanded && (
        <div className={styles.roomDevices}>
          {paired.map((n) => (
            <DeviceRow
              key={n}
              name={n}
              device={localDevices[n] ?? { brightness: 70, colorTemp: 30 }}
              isCircadian={enabledGroups.includes(n)}
              isOff={poweredOff.includes(n)}
              isOffline={avail[n] === false}
              circadian={circadian}
              onBrightness={(v) => onDeviceSlider(n, 'brightness', v)}
              onColorTemp={(v) => onDeviceSlider(n, 'colorTemp', v)}
              onToggleCircadian={() => onToggleCircadian(n)}
              onTogglePower={() => onTogglePower(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ControlsViewProps {
  serverState: LightingServerState;
  localDevices: Record<string, LightingValues>;
  circadian: CircadianState;
  availability: Record<string, boolean> | undefined;
  rooms: RoomsMap;
  overrides: OverridesMap;
  onSlider: (key: keyof LightingValues, value: number) => void;
  onDeviceSlider: (name: string, key: keyof LightingValues, value: number) => void;
  onRoomSlider: (roomName: string, key: keyof LightingValues, value: number) => void;
  onTogglePower: (group: string) => void;
  onToggleCircadian: (group: string) => void;
  onRoomTogglePower: (roomName: string) => void;
  onRoomToggleCircadian: (roomName: string) => void;
  onClearRoomOverride: (roomName: string) => void;
  onGoToDevices: () => void;
}

export default function ControlsView({
  serverState, localDevices, circadian, availability, rooms, overrides,
  onSlider, onDeviceSlider, onRoomSlider,
  onTogglePower, onToggleCircadian,
  onRoomTogglePower, onRoomToggleCircadian, onClearRoomOverride,
  onGoToDevices,
}: ControlsViewProps) {
  const offline       = !serverState.connected;
  const deviceEntries = Object.entries(serverState.groups);
  const avail         = availability ?? {};
  const poweredOff    = serverState.poweredOff ?? [];
  const enabledGroups = circadian.enabledGroups ?? [];

  const allOff       = deviceEntries.length > 0 && deviceEntries.every(([n]) => poweredOff.includes(n));
  const allCircadian = deviceEntries.length > 0 && deviceEntries.every(([n]) => enabledGroups.includes(n));

  const onDevices       = Object.fromEntries(Object.entries(localDevices).filter(([n]) => !poweredOff.includes(n)));
  const allBrightness   = avg(onDevices, 'brightness');
  const allColorTemp    = avg(onDevices, 'colorTemp');
  const brightnessMixed = Object.keys(onDevices).length > 1 && spread(onDevices, 'brightness') > 5;
  const colorTempMixed  = Object.keys(onDevices).length > 1 && spread(onDevices, 'colorTemp')  > 5;

  const hasRooms      = Object.keys(rooms).length > 0;
  const assignedNames = new Set(Object.values(rooms).flat());
  const unassigned    = deviceEntries.filter(([name]) => !assignedNames.has(name));

  if (deviceEntries.length === 0) {
    return (
      <div className={styles.empty}>
        <span className={`${styles.emptyDot} ${offline ? styles.emptyDotOffline : styles.emptyDotOnline}`} />
        <p className={styles.emptyTitle}>
          {offline ? 'Bridge offline' : 'No devices paired'}
        </p>
        {!offline && (
          <>
            <p className={styles.emptyHint}>Pair a bulb in the Devices tab</p>
            <button
              onClick={onGoToDevices}
              className={styles.emptyAction}
            >
              Open Devices
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {offline && (
        <div className={styles.localMode}>
          <span className={styles.localModeDot} />
          Local mode
        </div>
      )}

      {/* Global "All Devices" row */}
      <div className={styles.allDevices} data-no-swipe>
        <DeviceRow
          name="All Devices"
          device={{ brightness: allBrightness, colorTemp: allColorTemp }}
          isCircadian={allCircadian}
          isOff={allOff}
          circadian={circadian}
          onBrightness={(v) => onSlider('brightness', v)}
          onColorTemp={(v) => onSlider('colorTemp', v)}
          onToggleCircadian={() => onToggleCircadian('all')}
          onTogglePower={() => onTogglePower('all')}
          brightnessMixed={brightnessMixed}
          colorTempMixed={colorTempMixed}
        />
      </div>

      {/* Room / device sections */}
      <div className={styles.sections}>
        <div className={styles.sectionsScroll} data-no-swipe>

          {hasRooms ? (
            <>
              {Object.entries(rooms).map(([roomName, roomDeviceNames]) => (
                <RoomSection
                  key={roomName}
                  name={roomName}
                  deviceNames={roomDeviceNames}
                  serverState={serverState}
                  localDevices={localDevices}
                  circadian={circadian}
                  avail={avail}
                  overrides={overrides}
                  onRoomSlider={onRoomSlider}
                  onRoomTogglePower={onRoomTogglePower}
                  onRoomToggleCircadian={onRoomToggleCircadian}
                  onClearRoomOverride={onClearRoomOverride}
                  onDeviceSlider={onDeviceSlider}
                  onTogglePower={onTogglePower}
                  onToggleCircadian={onToggleCircadian}
                />
              ))}

              {unassigned.length > 0 && (
                <div className={styles.unassigned}>
                  <span className={styles.unassignedTitle}>
                    Unassigned
                  </span>
                  <div className={styles.unassignedList}>
                    {unassigned.map(([name]) => (
                      <DeviceRow
                        key={name}
                        name={name}
                        device={localDevices[name] ?? { brightness: 70, colorTemp: 30 }}
                        isCircadian={enabledGroups.includes(name)}
                        isOff={poweredOff.includes(name)}
                        isOffline={avail[name] === false}
                        circadian={circadian}
                        onBrightness={(v) => onDeviceSlider(name, 'brightness', v)}
                        onColorTemp={(v) => onDeviceSlider(name, 'colorTemp', v)}
                        onToggleCircadian={() => onToggleCircadian(name)}
                        onTogglePower={() => onTogglePower(name)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.flatList}>
              {deviceEntries.map(([name]) => (
                <DeviceRow
                  key={name}
                  name={name}
                  device={localDevices[name] ?? { brightness: 70, colorTemp: 30 }}
                  isCircadian={enabledGroups.includes(name)}
                  isOff={poweredOff.includes(name)}
                  isOffline={avail[name] === false}
                  circadian={circadian}
                  onBrightness={(v) => onDeviceSlider(name, 'brightness', v)}
                  onColorTemp={(v) => onDeviceSlider(name, 'colorTemp', v)}
                  onToggleCircadian={() => onToggleCircadian(name)}
                  onTogglePower={() => onTogglePower(name)}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
