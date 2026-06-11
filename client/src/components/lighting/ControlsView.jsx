import { PowerIcon } from '../icons';
import { LightSliders } from '../LightSliders';
import AutoToggle from './AutoToggle';
import CircadianStrip from './CircadianStrip';
import { avg, spread, tempLabel } from './utils';

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
          <button
            onClick={onTogglePower}
            className={`w-24 h-14 flex items-center justify-center rounded-item bg-white/[0.08] touch-manipulation transition-colors ${
              isOff ? 'text-white/60 hover:text-white/80' : 'text-white/40 hover:text-white/65 active:text-danger/70'
            }`}
          >
            <PowerIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ControlsView({ serverState, localDevices, circadian, availability, onSlider, onDeviceSlider, onTogglePower, onToggleCircadian, onGoToDevices }) {
  const offline       = !serverState.connected;
  const deviceEntries = Object.entries(serverState.groups);
  const avail         = availability ?? {};
  const poweredOff    = serverState.poweredOff ?? [];
  const enabledGroups = circadian.enabledGroups ?? [];

  const allOff          = deviceEntries.length > 0 && deviceEntries.every(([n]) => poweredOff.includes(n));
  const allCircadian    = deviceEntries.length > 0 && deviceEntries.every(([n]) => enabledGroups.includes(n));
  const allBrightness   = avg(localDevices, 'brightness');
  const allColorTemp    = avg(localDevices, 'colorTemp');
  const brightnessMixed = deviceEntries.length > 1 && spread(localDevices, 'brightness') > 5;
  const colorTempMixed  = deviceEntries.length > 1 && spread(localDevices, 'colorTemp')  > 5;

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

      {/* All Devices */}
      <div className="shrink-0 px-8 pt-2 pb-5 flex flex-col gap-2" data-no-swipe>
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

      {/* Individual devices */}
      <div className="flex-1 min-h-0 flex flex-col border-t-2 border-strong">
        <div className="flex-1 min-h-0 overflow-y-auto app-scrollbar px-8 pt-5 pb-3 flex flex-col gap-4" data-no-swipe>
          {deviceEntries.map(([name]) => {
            const dev = localDevices[name] ?? { brightness: 70, colorTemp: 30 };
            return (
              <DeviceRow
                key={name}
                name={name}
                device={dev}
                isCircadian={enabledGroups.includes(name)}
                isOff={poweredOff.includes(name)}
                isOffline={avail[name] === false}
                circadian={circadian}
                onBrightness={(v) => onDeviceSlider(name, 'brightness', v)}
                onColorTemp={(v) => onDeviceSlider(name, 'colorTemp', v)}
                onToggleCircadian={() => onToggleCircadian(name)}
                onTogglePower={() => onTogglePower(name)}
              />
            );
          })}
        </div>
      </div>
    </>
  );
}
