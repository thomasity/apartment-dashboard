import PRESETS from '../../presets.json';
import { avg, tempLabel } from './utils';
import type { LightingValues } from '../../types';

interface Props {
  localDevices: Record<string, LightingValues>;
  onApplyPreset: (preset: LightingValues) => void;
}

export default function PresetsView({ localDevices, onApplyPreset }: Props) {
  const allBrightness = avg(localDevices, 'brightness');
  const allColorTemp  = avg(localDevices, 'colorTemp');
  const activePreset  = PRESETS.find((p) => p.brightness === allBrightness && p.colorTemp === allColorTemp);

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center px-8">
      <div className="w-full grid grid-cols-3 gap-4">
        {PRESETS.map((preset) => {
          const isActive = activePreset?.label === preset.label;
          return (
            <button
              key={preset.label}
              onClick={() => onApplyPreset(preset)}
              className={`flex flex-col items-center gap-3 py-8 rounded-card transition-colors touch-manipulation ${
                isActive ? 'bg-white/[0.12] ring-1 ring-strong' : 'bg-white/[0.04] hover:bg-white/[0.08] active:bg-white/[0.15]'
              }`}
            >
              <span className="text-4xl leading-none">{preset.icon}</span>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-sm font-medium text-white/70">{preset.label}</span>
                <span className="text-[10px] text-white/30">{preset.brightness}% · {tempLabel(preset.colorTemp)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
