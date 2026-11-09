export type ServiceErrorCode = 'INVALID' | 'NOT_FOUND' | 'EXISTS' | 'NO_IP' | 'FULL';

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

/**
 * Who sent a request to our own API. The assistant marks its internal calls with an
 * `X-Source` header — `voice` when you asked it, `assistant` when it acted on its own (or
 * `source` in the body); anything else is a dashboard.
 */
export function requestSource(req: { body?: unknown; get(name: string): string | undefined }): 'voice' | 'assistant' | 'dashboard' {
  const body = req.body as { source?: unknown } | undefined;
  const source = req.get('x-source') ?? body?.source;
  return source === 'voice' || source === 'assistant' ? source : 'dashboard';
}
