import type { WeatherCurrent } from '../../types';
import styles from './CurrentConditions.module.css';

interface Props {
  current: WeatherCurrent;
  icon: string;
  label: string;
}

export default function CurrentConditions({ current, icon, label }: Props) {
  return (
    <div className={styles.root}>
      <span className={styles.icon}>{icon}</span>
      <div className={styles.details}>
        <div
          className={styles.temperature}
        >
          {Math.round(current.temperature_2m)}°
        </div>
        <div className={styles.condition}>
          Feels like {Math.round(current.apparent_temperature)}° · {label}
        </div>
      </div>
      <div className={styles.extras}>
        <div>Humidity {current.relative_humidity_2m}%</div>
        <div>Wind {Math.round(current.wind_speed_10m)} mph</div>
      </div>
    </div>
  );
}
