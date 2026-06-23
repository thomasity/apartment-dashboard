import { useState } from 'react';
import { PowerIcon, ChevronDownIcon, ChevronRightIcon } from '../icons';
import { LightSliders } from '../LightSliders';
import AutoToggle from './AutoToggle';
import CircadianStrip from './CircadianStrip';
import { avg, spread, tempLabel } from './utils';

function fmtRemaining(ms) {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function PowerBtn({ isOff, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-24 h-14 flex items-center justify-center rounded-item touch-manipulation transition-colors ${
        isOff
          ? 'bg-white/[0.05] text-white/30 hover:bg-white/[0.10] hover:text-white/60'
          : 'bg-white/[0.14] text-white/75 hover:bg-danger/15 hover:text-danger/70'
      }`}
    >
      <PowerIcon />
    </button>
  );
}

function DeviceRow({ name, device, isCircadian, isOff, isOffline, circadian, onBrightness, onColorTemp, onToggleCircadian, onTogglePower, brightnessMixed, colorTempMixed }) {
  return (
    <div className={`flex flex-col gap-1.5 ${isOffline ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-white/70 select-none">{name}</span>
        {isOffline && <span className="text-[10px] text-white/30 uppercase tracking-wider">Offline</span>}
      </div>
      <div className="flex items-center gap-4">
        <div className={`flex-1 h-[6.5rem] flex flex-col justify-center transition-opacity ${isOff ? 'opacity-20 pointer-events-none' : ''}`}>
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
        <div className="flex flex-row gap-4 mx-4">
          <div className={isOff ? 'opacity-20 pointer-events-none' : ''}>
            <AutoToggle on={isCircadian} onClick={onToggleCircadian} />
          </div>
          <PowerBtn isOff={isOff} onClick={onTogglePower} />
        </div>
      </div>
    </div>
  );
}

function RoomSection({
  name, deviceNames, serverState, localDevices, circadian, avail, overrides,
  onRoomSlider, onRoomTogglePower, onRoomToggleCircadian, onClearRoomOverride,
  onDeviceSlider, onTogglePower, onToggleCircadian,
}) {
  const [expanded, setExpanded] = useState(false);

  const poweredOff    = serverState.poweredOff ?? [];
  const enabledGroups = circadian.enabledGroups ?? [];
  const paired        = deviceNames.filter((n) => serverState.groups[n]);

  if (paired.length === 0) return null;

  const isRoomOff       = paired.every((n) => poweredOff.includes(n));
  const isRoomCircadian = paired.every((n) => enabledGroups.includes(n));

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
    <div className="flex flex-col pt-5 border-t border-white/[0.08]">
      {/* Room header row */}
      <div className="flex items-center gap-4 mb-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left touch-manipulation"
        >
          <span className="text-white/25 shrink-0">
            {expanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
          </span>
          <span className="text-sm font-semibold text-white/65 truncate">{name}</span>
          <span className="text-[10px] text-white/20 shrink-0">{paired.length}</span>
        </button>

        {hasOverride && (
          <span className="flex items-center gap-1.5 text-[10px] text-amber-400/70 bg-amber-400/[0.08] border border-amber-400/20 px-2 py-0.5 rounded-full shrink-0">
            Manual · {fmtRemaining(remainingMs)}
            <button
              onClick={() => onClearRoomOverride(name)}
              className="opacity-60 hover:opacity-100 leading-none touch-manipulation"
              title="Resume auto"
            >
              ✕
            </button>
          </span>
        )}

        <div className={isRoomOff ? 'opacity-20 pointer-events-none' : ''}>
          <AutoToggle on={isRoomCircadian} onClick={() => onRoomToggleCircadian(name)} />
        </div>
        <PowerBtn isOff={isRoomOff} onClick={() => onRoomTogglePower(name)} />
      </div>

      {/* Room-level sliders — always visible */}
      <div className={`transition-opacity ${isRoomOff ? 'opacity-20 pointer-events-none' : ''}`}>
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
        <div className="flex flex-col gap-5 mt-5 pl-4 border-l border-white/[0.06]">
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

export default function ControlsView({
  serverState, localDevices, circadian, availability, rooms, overrides,
  onSlider, onDeviceSlider, onRoomSlider,
  onTogglePower, onToggleCircadian,
  onRoomTogglePower, onRoomToggleCircadian, onClearRoomOverride,
  onGoToDevices,
}) {
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
      <div className="flex-1 flex flex-col items-center justify-center gap-2 pb-8">
        <span className={`w-2 h-2 rounded-full ${offline ? 'bg-white/20' : 'bg-online/40'}`} />
        <p className="text-[11px] uppercase tracking-widest text-white/25 mt-1">
          {offline ? 'Bridge offline' : 'No devices paired'}
        </p>
        {!offline && (
          <>
            <p className="text-white/15 text-xs">Pair a bulb in the Devices tab</p>
            <button
              onClick={onGoToDevices}
              className="mt-2 px-4 py-1.5 rounded-full bg-white/[0.06] text-white/40 text-[11px] font-medium uppercase tracking-widest touch-manipulation hover:bg-white/[0.10] transition-colors"
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
        <div className="absolute top-5 right-8 flex items-center gap-1.5 text-[10px] text-accent/60 select-none z-10">
          <span className="w-1.5 h-1.5 rounded-full bg-accent/60" />
          Local mode
        </div>
      )}

      {/* Global "All Devices" row */}
      <div className="shrink-0 px-8 pt-2 pb-5 bg-white/[0.02]" data-no-swipe>
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
      <div className="flex-1 min-h-0 flex flex-col border-t-2 border-white/[0.12]">
        <div className="flex-1 min-h-0 overflow-y-auto app-scrollbar px-8 pb-6 flex flex-col" data-no-swipe>

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
                <div className="flex flex-col pt-5 border-t border-white/[0.08]">
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-white/25 mb-4">
                    Unassigned
                  </span>
                  <div className="flex flex-col gap-5">
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
            <div className="flex flex-col gap-5 pt-4">
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
