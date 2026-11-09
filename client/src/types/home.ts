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

// ── The assistant's remarks ──────────────────────────────────────────────────

export interface Notice {
  id: string;
  at: number;
  text: string;
  /** Present when the note has an Undo */
  undo?: { kind: 'look'; zone: string } | { kind: 'rule'; changeId: string };
  deliveredAt?: number;
}
