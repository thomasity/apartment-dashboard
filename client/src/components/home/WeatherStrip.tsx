import styles from './WeatherStrip.module.css';

interface Props {
  icon: string | null;
  temperature: number | null;
  high: number | null;
  low: number | null;
  precip: number | null;
  onNavigate: () => void;
}

export default function WeatherStrip({ icon, temperature, high, low, precip, onNavigate }: Props) {
  if (!icon) return null;

  return (
    <button
      onClick={onNavigate}
      className={styles.root}
    >
      <div className={styles.summary}>
        <span className={styles.icon}>{icon}</span>
        <span
          className={styles.temperature}
        >
          {temperature}°
        </span>
      </div>
      <div className={styles.details}>
        {high != null && low != null ? `${high}° / ${low}°` : ' '}
        {high != null && precip != null && ' · '}
        {precip != null ? `💧${precip}%` : ''}
      </div>
    </button>
  );
}
