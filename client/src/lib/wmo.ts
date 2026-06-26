export const WMO = {
  0:  { label: 'Clear',          icon: '☀️' },
  1:  { label: 'Mostly Clear',   icon: '🌤' },
  2:  { label: 'Partly Cloudy',  icon: '⛅' },
  3:  { label: 'Overcast',       icon: '☁️' },
  45: { label: 'Foggy',          icon: '🌫' },
  48: { label: 'Icy Fog',        icon: '🌫' },
  51: { label: 'Light Drizzle',  icon: '🌦' },
  53: { label: 'Drizzle',        icon: '🌦' },
  55: { label: 'Heavy Drizzle',  icon: '🌧' },
  61: { label: 'Light Rain',     icon: '🌧' },
  63: { label: 'Rain',           icon: '🌧' },
  65: { label: 'Heavy Rain',     icon: '🌧' },
  71: { label: 'Light Snow',     icon: '🌨' },
  73: { label: 'Snow',           icon: '❄️' },
  75: { label: 'Heavy Snow',     icon: '❄️' },
  77: { label: 'Snow Grains',    icon: '🌨' },
  80: { label: 'Showers',        icon: '🌦' },
  81: { label: 'Rain Showers',   icon: '🌧' },
  82: { label: 'Heavy Showers',  icon: '⛈' },
  85: { label: 'Snow Showers',   icon: '🌨' },
  86: { label: 'Heavy Snow',     icon: '❄️' },
  95: { label: 'Thunderstorm',   icon: '⛈' },
  96: { label: 'Thunderstorm',   icon: '⛈' },
  99: { label: 'Thunderstorm',   icon: '⛈' },
};

export function wmo(code: number): { label: string; icon: string } {
  return (WMO as Record<number, { label: string; icon: string }>)[code] ?? { label: 'Unknown', icon: '🌡' };
}
