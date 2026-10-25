import { wmo }  from '../../lib/wmo';
import { DAYS } from './utils';
import type { WeatherHourly, WeatherDaily } from '../../types';
import styles from './HourlyStrip.module.css';

interface Props {
  hourly: WeatherHourly;
  daily: WeatherDaily;
}

export default function HourlyStrip({ hourly, daily }: Props) {
  const todayStr = daily.time[0];
  const nowHour  = new Date().getHours();

  const startIdx = todayStr === undefined ? -1 : hourly.time.findIndex(
    (t) => t.startsWith(todayStr) && parseInt(t.split('T')[1] ?? '') === nowHour
  );
  const safeStart   = startIdx >= 0 ? startIdx : 0;
  const hourlyItems = hourly.time.slice(safeStart, safeStart + 12).map((timeStr, offset) => {
    const i        = safeStart + offset;
    const [datePart = '', hourPart = ''] = timeStr.split('T');
    const hour     = parseInt(hourPart);
    return {
      timeStr,
      datePart,
      hour,
      temp:   hourly.temperature_2m[i],
      code:   hourly.weather_code[i],
      precip: hourly.precipitation_probability[i] ?? 0,
      isNow:  offset === 0,
    };
  });

  return (
    <div className={styles.root}>
      <div className={styles.heading}>
        Hourly
      </div>
      <div data-no-swipe className={styles.scroller}>
        {hourlyItems.map((item, idx) => {
          const w          = wmo(item.code);
          const label      = item.isNow
            ? 'Now'
            : `${item.hour % 12 || 12} ${item.hour >= 12 ? 'PM' : 'AM'}`;
          const prev       = hourlyItems[idx - 1];
          const isDayBreak = prev !== undefined && item.datePart !== prev.datePart;
          const dayName    = isDayBreak
            ? DAYS[new Date(item.datePart + 'T12:00:00').getDay()]
            : null;

          return (
            <div key={item.timeStr} className={styles.item}>
              {isDayBreak && (
                <div className={styles.dayBreak}>
                  <div className={styles.dayBreakLine} />
                  <span className={styles.dayBreakLabel}>{dayName}</span>
                </div>
              )}
              <div
                className={`${styles.card} ${
                  item.isNow ? styles.cardNow : styles.cardLater
                }`}
              >
                <span className={`${styles.hour} ${item.isNow ? styles.hourNow : styles.hourLater}`}>
                  {label}
                </span>
                <span className={styles.icon}>{w.icon}</span>
                <span className={styles.temperature}>{item.temp !== undefined ? `${Math.round(item.temp)}°` : '–'}</span>
                {item.precip > 0 && (
                  <span className={styles.precip}>{item.precip}%</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
