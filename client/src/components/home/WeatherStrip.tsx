import { useWeather } from '../../hooks/useWeather';
import styles from './WeatherStrip.module.css';

interface Props {
  onNavigate: () => void;
}

export default function WeatherStrip({ onNavigate }: Props) {
  const { today } = useWeather();
  if (!today) return null;

  const { icon, temperature, high, low, precip } = today;

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
        {high != null && low != null ? `${high}° / ${low}°` : ' '}
        {high != null && precip != null && ' · '}
        {precip != null ? `💧${precip}%` : ''}
      </div>
    </button>
  );
}
