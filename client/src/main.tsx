import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// @ts-ignore
import './index.css';
import { ClockProvider } from './context/clockContext';
import { SpotifyProvider } from './context/spotifyContext';
import { WeatherProvider } from './context/weatherContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClockProvider>
      <WeatherProvider>
        <SpotifyProvider>
          <App />
        </SpotifyProvider>
      </WeatherProvider>
    </ClockProvider>
  </React.StrictMode>
);
