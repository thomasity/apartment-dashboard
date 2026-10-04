export type ServiceErrorCode = 'INVALID' | 'NOT_FOUND' | 'EXISTS' | 'NO_IP';

/** An error the routes translate into a specific HTTP status via its `code`. */
export class ServiceError extends Error {
  constructor(message: string, readonly code: ServiceErrorCode) {
    super(message);
  }
}

export function errorCode(err: unknown): ServiceErrorCode | null {
  return err instanceof ServiceError ? err.code : null;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Short opaque id — no uuid dependency needed for a handful of rules.
export function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function toHHMM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function apiBase(): string {
  return `http://localhost:${process.env.PORT || 3001}/api`;
}
