import { useWeather }       from '../../hooks/useWeather';
import { wmo }              from '../../lib/wmo';
import CurrentConditions    from './CurrentConditions';
import HourlyStrip          from './HourlyStrip';
import DailyForecast        from './DailyForecast';

export default function Weather() {
  const { data, error } = useWeather();

  if (error && !data) {
    return (
      <div className="h-full flex items-center justify-center text-white/25">
        Weather unavailable
      </div>
    );
  }

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center text-white/20 animate-pulse">
        Loading…
      </div>
    );
  }

  const { current, hourly, daily } = data;
  const weather = wmo(current.weather_code);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <CurrentConditions current={current} icon={weather.icon} label={weather.label} />
      <HourlyStrip hourly={hourly} daily={daily} />
      <DailyForecast daily={daily} />
    </div>
  );
}
