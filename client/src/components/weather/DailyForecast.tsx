import { wmo }  from '../../lib/wmo';
import { DAYS } from './utils';
import type { WeatherDaily } from '../../types';
import styles from './DailyForecast.module.css';

interface Props {
  daily: WeatherDaily;
}

export default function DailyForecast({ daily }: Props) {
  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        5-Day Forecast
      </div>
      <div className={styles.list}>
        {daily.time.map((dateStr, i) => {
          const d = new Date(dateStr + 'T12:00:00');
          const w    = wmo(daily.weather_code[i]);
          const high = daily.temperature_2m_max[i];
          const low  = daily.temperature_2m_min[i];
          return (
            <div key={dateStr} className={styles.row}>
              <span className={styles.day}>
                {i === 0 ? 'Today' : DAYS[d.getDay()]}
              </span>
              <span className={styles.icon}>{w.icon}</span>
              <span className={styles.condition}>{w.label}</span>
              <span className={styles.high}>
                {high !== undefined ? `${Math.round(high)}°` : '–'}
              </span>
              <span className={styles.low}>
                {low !== undefined ? `${Math.round(low)}°` : '–'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
