export default function ClockDisplay({ hour, m, s, ampm, dateStr }) {
  return (
    <div className="relative h-full flex flex-col items-center justify-center">
      <div className="flex items-end gap-4">
        <span
          className="font-thin text-white tracking-tight leading-none"
          style={{ fontSize: 'clamp(6rem, 18vw, 20rem)', textShadow: '0 2px 40px rgba(0,0,0,0.6)' }}
        >
          {hour}:{m}
        </span>
        <div className="flex flex-col items-start pb-3 gap-2">
          <span
            className="font-light text-white/70 leading-none"
            style={{ fontSize: 'clamp(1.5rem, 3.5vw, 4rem)', textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}
          >
            {ampm}
          </span>
          <span
            className="font-light text-white/40 leading-none"
            style={{ fontSize: 'clamp(1.2rem, 2.5vw, 3rem)', textShadow: '0 2px 20px rgba(0,0,0,0.6)' }}
          >
            :{s}
          </span>
        </div>
      </div>
      <div
        className="font-light text-white/50 tracking-widest uppercase mt-4"
        style={{ fontSize: 'clamp(0.7rem, 1.4vw, 1.1rem)', textShadow: '0 1px 12px rgba(0,0,0,0.7)' }}
      >
        {dateStr}
      </div>
    </div>
  );
}
