export default function PlayingBars() {
  return (
    <span className="flex items-end gap-px h-3.5 w-3.5">
      {[0, 150, 75].map((delay, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm bg-green-400"
          style={{ animation: `soundbar 0.8s ease-in-out ${delay}ms infinite alternate` }}
        />
      ))}
      <style>{`@keyframes soundbar { from { height: 3px } to { height: 14px } }`}</style>
    </span>
  );
}
