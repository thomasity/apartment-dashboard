export interface TvStatus {
  appId?: string;
  appName?: string;
  playerState?: string;
  position?: number;
  duration?: number;
}

export interface TvApp {
  id: string;
  name: string;
}

export interface DiscoveredDevice {
  ip: string;
  name: string;
  model?: string;
}
