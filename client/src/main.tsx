import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
// @ts-ignore
import './index.css';
import { ClockProvider } from './context/clockContext';
import { ConnectivityProvider } from './context/connectivityContext';
import { SpotifyProvider } from './context/spotifyContext';
import { WeatherProvider } from './context/weatherContext';
import { LightingProvider } from './context/lightingContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConnectivityProvider>
      <ClockProvider>
        <WeatherProvider>
          <SpotifyProvider>
            <LightingProvider>
              <App />
            </LightingProvider>
          </SpotifyProvider>
        </WeatherProvider>
      </ClockProvider>
    </ConnectivityProvider>
  </React.StrictMode>
);
