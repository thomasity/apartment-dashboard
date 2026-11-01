import { useWeather }       from '../../hooks/useWeather';
import CurrentConditions    from './CurrentConditions';
import HourlyStrip          from './HourlyStrip';
import DailyForecast        from './DailyForecast';
import styles from './index.module.css';

export default function Weather() {
  const { data, today, error } = useWeather();

  if (error && !data) {
    return (
      <div className={styles.message}>
        Weather unavailable
      </div>
    );
  }

  if (!data || !today) {
    return (
      <div className={styles.loading}>
        Loading…
      </div>
    );
  }

  const { current, hourly, daily } = data;

  return (
    <div className={styles.root}>
      <CurrentConditions current={current} icon={today.icon} label={today.label} />
      <HourlyStrip hourly={hourly} daily={daily} />
      <DailyForecast daily={daily} />
    </div>
  );
}
