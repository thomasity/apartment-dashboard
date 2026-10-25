import { useWeather }       from '../../hooks/useWeather';
import { wmo }              from '../../lib/wmo';
import CurrentConditions    from './CurrentConditions';
import HourlyStrip          from './HourlyStrip';
import DailyForecast        from './DailyForecast';
import styles from './index.module.css';

export default function Weather() {
  const { data, error } = useWeather();

  if (error && !data) {
    return (
      <div className={styles.message}>
        Weather unavailable
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.loading}>
        Loading…
      </div>
    );
  }

  const { current, hourly, daily } = data;
  const weather = wmo(current.weather_code);

  return (
    <div className={styles.root}>
      <CurrentConditions current={current} icon={weather.icon} label={weather.label} />
      <HourlyStrip hourly={hourly} daily={daily} />
      <DailyForecast daily={daily} />
    </div>
  );
}
