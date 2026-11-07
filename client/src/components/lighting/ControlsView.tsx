import { useState, type ReactNode } from 'react';
import { PowerIcon, ChevronDownIcon, ChevronRightIcon } from '../icons';
import { LightSliders } from '../LightSliders';
import AutoToggle from './AutoToggle';
import CircadianStrip from './CircadianStrip';
import ZoneHistorySheet from './ZoneHistorySheet';
import { avg, spread, tempLabel } from './utils';
import type { LightingValues, ZoneState } from '../../types';
import { useLighting } from '../../hooks/useLighting';
import { DEFAULT_VALUES } from '../../context/lightingContext';
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

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/**
 * Who's deciding a zone's look, when it isn't plain Auto: you, a rule window, or presence.
 * Tapping it (or the ⓘ when there's no badge) opens the zone's "why" and history.
 */
function ZoneBadge({ zone, onResume, onExplain }: { zone: ZoneState | undefined; onResume: () => void; onExplain: () => void }) {
  if (zone?.control === 'manual') {
    return (
      <span className={styles.overrideBadge}>
        <button onClick={onExplain} className={styles.badgeLabel}>Manual · until off</button>
        <button onClick={onResume} className={styles.overrideClear} title="Resume automation">
          ✕
        </button>
      </span>
    );
  }
  if (zone?.control === 'rule') {
    return (
      <button onClick={onExplain} className={styles.ruleBadge}>
        {zone.ruleName}{zone.until ? ` · until ${clock(zone.until)}` : ''}
      </button>
    );
  }
  if (zone?.control === 'presence') return <button onClick={onExplain} className={styles.ruleBadge}>Night light</button>;
  return <button onClick={onExplain} className={styles.infoButton} title="Why is it like this?">ⓘ</button>;
}

interface DeviceRowProps {
  name: string;
  device: LightingValues;
  isOff: boolean;
  isOffline?: boolean;
  /** Omit for bulbs inside a room — Auto is set per room */
  isAuto?: boolean;
  onToggleAuto?: () => void;
  status?: ReactNode;
  onBrightness: (v: number) => void;
  onColorTemp: (v: number) => void;
  onTogglePower: () => void;
  brightnessMixed?: boolean;
  colorTempMixed?: boolean;
  children?: ReactNode;
}

function DeviceRow({
  name, device, isOff, isOffline, isAuto, onToggleAuto, status,
  onBrightness, onColorTemp, onTogglePower, brightnessMixed, colorTempMixed, children,
}: DeviceRowProps) {
  return (
    <div className={`${styles.deviceRow} ${isOffline ? styles.offline : ''}`}>
      <div className={styles.deviceHeader}>
        <span className={styles.deviceName}>{name}</span>
        {isOffline && <span className={styles.offlineTag}>Offline</span>}
        {status}
      </div>
      <div className={styles.deviceControls}>
        <div className={`${styles.sliders} ${isOff ? styles.dimmed : ''}`}>
          <LightSliders
            brightness={device.brightness}
            colorTemp={device.colorTemp}
            tempLabel={tempLabel(device.colorTemp)}
            onBrightness={onBrightness}
            onColorTemp={onColorTemp}
            brightnessMixed={brightnessMixed}
            colorTempMixed={colorTempMixed}
          />
        </div>
        <div className={styles.toggles}>
          {onToggleAuto && (
            <div className={isOff ? styles.dimmed : ''}>
              <AutoToggle on={!!isAuto} onClick={onToggleAuto} />
            </div>
          )}
          <PowerBtn isOff={isOff} onClick={onTogglePower} />
        </div>
      </div>
      {children}
    </div>
  );
}

/** A bulb that isn't in a room is its own zone, so it gets its own Auto toggle and badge. */
function LooseBulb({ id, onExplain }: { id: string; onExplain: (zone: string) => void }) {
  const { serverState, localDevices, devicesState, zones, setDevice, togglePower, toggleAuto, resumeZone } = useLighting();
  const label = serverState.groups[id]?.label ?? id;
  return (
    <DeviceRow
      name={label}
      device={localDevices[id] ?? DEFAULT_VALUES}
      isOff={(serverState.poweredOff ?? []).includes(id)}
      isOffline={devicesState.availability?.[id] === false}
      isAuto={zones[id]?.auto}
      onToggleAuto={() => toggleAuto(id)}
      status={<ZoneBadge zone={zones[id]} onResume={() => resumeZone(id)} onExplain={() => onExplain(id)} />}
      onBrightness={(v) => setDevice(id, 'brightness', v)}
      onColorTemp={(v) => setDevice(id, 'colorTemp', v)}
      onTogglePower={() => togglePower(id)}
    />
  );
}

interface RoomSectionProps {
  id: string;
  onExplain: (zone: string) => void;
}

function RoomSection({ id, onExplain }: RoomSectionProps) {
  const {
    serverState, localDevices, devicesState, rooms, zones,
    setRoom, setDevice, togglePower, toggleAuto, resumeZone,
  } = useLighting();
  const [expanded, setExpanded] = useState(false);

  const room          = rooms[id];
  const avail         = devicesState.availability ?? {};
  const poweredOff    = serverState.poweredOff ?? [];
  const paired        = (room?.devices ?? []).filter((n) => serverState.groups[n]);

  if (!room || paired.length === 0) return null;

  const zone          = zones[id];
  const isRoomOff     = paired.every((n) => poweredOff.includes(n));
  const offlineCount  = paired.filter((n) => avail[n] === false).length;
  const isRoomOffline = offlineCount > 0 && offlineCount === paired.length;
  const someOffline   = offlineCount > 0 && offlineCount < paired.length;

  const roomOnDevices  = Object.fromEntries(
    paired.filter((n) => !poweredOff.includes(n))
          .map((n) => [n, localDevices[n] ?? DEFAULT_VALUES])
  );
  const roomBrightness  = avg(roomOnDevices, 'brightness');
  const roomColorTemp   = avg(roomOnDevices, 'colorTemp');
  const brightnessMixed = Object.keys(roomOnDevices).length > 1 && spread(roomOnDevices, 'brightness') > 5;
  const colorTempMixed  = Object.keys(roomOnDevices).length > 1 && spread(roomOnDevices, 'colorTemp')  > 5;

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
          <span className={styles.roomName}>{room.name}</span>
          <span className={styles.roomCount}>{paired.length}</span>
        </button>

        {isRoomOffline && (
          <span className={styles.roomOfflineTag}>Offline</span>
        )}
        {someOffline && !isRoomOffline && (
          <span className={styles.roomOfflineCount}>{offlineCount} offline</span>
        )}

        <ZoneBadge zone={zone} onResume={() => resumeZone(id)} onExplain={() => onExplain(id)} />

        <div className={isRoomOff || isRoomOffline ? styles.dimmed : ''}>
          <AutoToggle on={!!zone?.auto} onClick={() => toggleAuto(id)} />
        </div>
        <PowerBtn isOff={isRoomOff} onClick={() => togglePower(id)} />
      </div>

      {/* Room-level sliders — usable on Auto too; a change starts a manual session */}
      <div className={`${styles.roomSliders} ${isRoomOff || isRoomOffline ? styles.dimmed : ''}`}>
        <LightSliders
          brightness={roomBrightness}
          colorTemp={roomColorTemp}
          tempLabel={tempLabel(roomColorTemp)}
          onBrightness={(v) => setRoom(id, 'brightness', v)}
          onColorTemp={(v) => setRoom(id, 'colorTemp', v)}
          brightnessMixed={brightnessMixed}
          colorTempMixed={colorTempMixed}
        />
      </div>

      {/* Individual devices — expanded */}
      {expanded && (
        <div className={styles.roomDevices}>
          {paired.map((n) => (
            <DeviceRow
              key={n}
              name={serverState.groups[n]?.label ?? n}
              device={localDevices[n] ?? DEFAULT_VALUES}
              isOff={poweredOff.includes(n)}
              isOffline={avail[n] === false}
              onBrightness={(v) => setDevice(n, 'brightness', v)}
              onColorTemp={(v) => setDevice(n, 'colorTemp', v)}
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
  const { serverState, localDevices, circadian, rooms, zones, setAll, togglePower, toggleAuto } = useLighting();
  const [explaining, setExplaining] = useState<string | null>(null);
  const offline       = !serverState.connected;
  const deviceIds     = Object.keys(serverState.groups);
  const poweredOff    = serverState.poweredOff ?? [];
  const zoneList      = Object.values(zones);

  const allOff  = deviceIds.length > 0 && deviceIds.every((n) => poweredOff.includes(n));
  const allAuto = zoneList.length > 0 && zoneList.every((z) => z.auto);
  const anyAuto = zoneList.some((z) => z.auto);

  const onDevices       = Object.fromEntries(Object.entries(localDevices).filter(([n]) => !poweredOff.includes(n)));
  const allBrightness   = avg(onDevices, 'brightness');
  const allColorTemp    = avg(onDevices, 'colorTemp');
  const brightnessMixed = Object.keys(onDevices).length > 1 && spread(onDevices, 'brightness') > 5;
  const colorTempMixed  = Object.keys(onDevices).length > 1 && spread(onDevices, 'colorTemp')  > 5;

  const roomIds       = Object.keys(rooms);
  const hasRooms      = roomIds.length > 0;
  const assignedIds   = new Set(Object.values(rooms).flatMap((r) => r.devices));
  const unassigned    = deviceIds.filter((n) => !assignedIds.has(n));

  if (deviceIds.length === 0) {
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
          isOff={allOff}
          isAuto={allAuto}
          onToggleAuto={() => toggleAuto('all')}
          onBrightness={(v) => setAll('brightness', v)}
          onColorTemp={(v) => setAll('colorTemp', v)}
          onTogglePower={() => togglePower('all')}
          brightnessMixed={brightnessMixed}
          colorTempMixed={colorTempMixed}
        >
          {anyAuto && (
            <div className={styles.autoStrip}>
              <CircadianStrip circadian={circadian} />
            </div>
          )}
        </DeviceRow>
      </div>

      {/* Room / device sections */}
      <div className={styles.sections}>
        <div className={styles.sectionsScroll} data-no-swipe>

          {hasRooms ? (
            <>
              {roomIds.map((id) => <RoomSection key={id} id={id} onExplain={setExplaining} />)}

              {unassigned.length > 0 && (
                <div className={styles.unassigned}>
                  <span className={styles.unassignedTitle}>
                    Unassigned
                  </span>
                  <div className={styles.unassignedList}>
                    {unassigned.map((id) => <LooseBulb key={id} id={id} onExplain={setExplaining} />)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className={styles.flatList}>
              {deviceIds.map((id) => <LooseBulb key={id} id={id} onExplain={setExplaining} />)}
            </div>
          )}

        </div>
      </div>

      {explaining && <ZoneHistorySheet zone={explaining} onClose={() => setExplaining(null)} />}
    </>
  );
}
