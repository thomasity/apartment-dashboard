import type { Plant } from '../../types';

interface Props {
  plants: Plant[];
  onNavigate: () => void;
}

function daysUntil(plant: Plant): number | null {
  if (!plant.lastWatered) return null;
  const next = new Date(plant.lastWatered);
  next.setDate(next.getDate() + plant.intervalDays);
  next.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.ceil((next.getTime() - now.getTime()) / 86400000);
}

export default function PlantsStrip({ plants, onNavigate }: Props) {
  const urgent = plants.filter((p) => {
    const d = daysUntil(p);
    return d === null || d <= 0;
  });

  if (urgent.length === 0) return null;

  return (
    <button
      onClick={onNavigate}
      className="absolute top-10 right-[168px] rounded-2xl backdrop-blur-xl bg-black/30 border border-white/10 px-3 py-2 touch-manipulation"
    >
      <div className="flex items-center gap-2 leading-none">
        <span className="text-base">🪴</span>
        <span className="font-light text-white/80 truncate max-w-[180px]" style={{ fontSize: 'clamp(0.65rem, 1.2vw, 0.85rem)' }}>
          {urgent.length === 1 ? urgent[0].name : `${urgent.length} plants`} need{urgent.length === 1 && 's'} water
        </span>
      </div>
    </button>
  );
}
