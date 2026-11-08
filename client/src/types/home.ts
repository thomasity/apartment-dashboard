// ── Home / away (your phone on the Wi-Fi) ────────────────────────────────────

export interface TrackedPhone {
  mac: string;
  name: string;
  home: boolean | null;
  lastSeen: number | null;
}

export interface HomeState {
  /** null until a phone is set up (or just after the server starts) */
  home: boolean | null;
  phones: TrackedPhone[];
}

/** Something the Pi's network scan found */
export interface NetworkDevice {
  ip: string;
  mac: string;
  vendor: string | null;
  lastSeen: number;
}
