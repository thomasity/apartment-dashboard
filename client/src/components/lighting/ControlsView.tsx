import { useState } from 'react';
import { PowerIcon, ChevronDownIcon, ChevronRightIcon } from '../icons';
import { LightSliders } from '../LightSliders';
import AutoToggle from './AutoToggle';
import CircadianStrip from './CircadianStrip';
import { avg, spread, tempLabel } from './utils';
import type { LightingValues, CircadianState } from '../../types';
import { useLighting } from '../../hooks/useLighting';
import { DEFAULT_VALUES } from '../../context/lightingContext';
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
}

function RoomSection({ name, deviceNames }: RoomSectionProps) {
  const {
    serverState, localDevices, circadian, devicesState, overrides,
    setRoom, toggleRoomPower, toggleRoomCircadian, clearRoomOverride,
    setDevice, togglePower, toggleCircadian,
  } = useLighting();
  const [expanded, setExpanded] = useState(false);

  const avail         = devicesState.availability ?? {};
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
          .map((n) => [n, localDevices[n] ?? DEFAULT_VALUES])
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
              onClick={() => clearRoomOverride(name)}
              className={styles.overrideClear}
              title="Resume auto"
            >
              ✕
            </button>
          </span>
        )}

        <div className={isRoomOff || isRoomOffline ? styles.dimmed : ''}>
          <AutoToggle on={isRoomCircadian} onClick={() => toggleRoomCircadian(name)} />
        </div>
        <PowerBtn isOff={isRoomOff} onClick={() => toggleRoomPower(name)} />
      </div>

      {/* Room-level sliders — always visible */}
      <div className={`${styles.roomSliders} ${isRoomOff || isRoomOffline ? styles.dimmed : ''}`}>
        {isRoomCircadian
          ? <CircadianStrip circadian={circadian} />
          : <LightSliders
              brightness={roomBrightness}
              colorTemp={roomColorTemp}
              tempLabel={tempLabel(roomColorTemp)}
              onBrightness={(v) => setRoom(name, 'brightness', v)}
              onColorTemp={(v) => setRoom(name, 'colorTemp', v)}
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
              device={localDevices[n] ?? DEFAULT_VALUES}
              isCircadian={enabledGroups.includes(n)}
              isOff={poweredOff.includes(n)}
              isOffline={avail[n] === false}
              circadian={circadian}
              onBrightness={(v) => setDevice(n, 'brightness', v)}
              onColorTemp={(v) => setDevice(n, 'colorTemp', v)}
              onToggleCircadian={() => toggleCircadian(n)}
              onTogglePower={() => togglePower(n)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface ControlsViewProps {
  onGoToDevices: () => void;
}

export default function ControlsView({ onGoToDevices }: ControlsViewProps) {
  const {
    serverState, localDevices, circadian, devicesState, rooms,
    setAll, setDevice, togglePower, toggleCircadian,
  } = useLighting();
  const offline       = !serverState.connected;
  const deviceEntries = Object.entries(serverState.groups);
  const avail         = devicesState.availability ?? {};
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
          onBrightness={(v) => setAll('brightness', v)}
          onColorTemp={(v) => setAll('colorTemp', v)}
          onToggleCircadian={() => toggleCircadian('all')}
          onTogglePower={() => togglePower('all')}
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
                        device={localDevices[name] ?? DEFAULT_VALUES}
                        isCircadian={enabledGroups.includes(name)}
                        isOff={poweredOff.includes(name)}
                        isOffline={avail[name] === false}
                        circadian={circadian}
                        onBrightness={(v) => setDevice(name, 'brightness', v)}
                        onColorTemp={(v) => setDevice(name, 'colorTemp', v)}
                        onToggleCircadian={() => toggleCircadian(name)}
                        onTogglePower={() => togglePower(name)}
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
                  device={localDevices[name] ?? DEFAULT_VALUES}
                  isCircadian={enabledGroups.includes(name)}
                  isOff={poweredOff.includes(name)}
                  isOffline={avail[name] === false}
                  circadian={circadian}
                  onBrightness={(v) => setDevice(name, 'brightness', v)}
                  onColorTemp={(v) => setDevice(name, 'colorTemp', v)}
                  onToggleCircadian={() => toggleCircadian(name)}
                  onTogglePower={() => togglePower(name)}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </>
  );
}
