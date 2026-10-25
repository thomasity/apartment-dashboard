// Route-table mock for axios, standing in for Roku / Spotify / Open-Meteo.
//
//   const calls = mockAxios({
//     'GET http://10.0.0.5:8060/query/apps': () => '<apps>…</apps>',
//     'POST https://api.spotify.com/v1/me/player/pause': () => ({ status: 204 }),
//   });
//
// Keys match on method + URL prefix (longest wins). A handler returns the response body,
// or { status, data, headers } for anything else. Unmatched requests fail like an
// unreachable host (ECONNREFUSED), which is what the routes see when a device is offline.

import axios, { AxiosError, type AxiosRequestConfig, type AxiosResponse } from 'axios';
import { vi } from 'vitest';

export interface Call { method: string; url: string; data: unknown; headers: Record<string, unknown> }
type Reply = { status?: number; data?: unknown; headers?: Record<string, string> };
type Handler = (call: Call) => unknown;

const isReply = (v: unknown): v is Reply =>
  typeof v === 'object' && v !== null && 'status' in v && typeof (v as Reply).status === 'number';

export function mockAxios(routes: Record<string, Handler>): Call[] {
  const calls: Call[] = [];

  async function handle(method: string, url: string, data: unknown, config: AxiosRequestConfig = {}) {
    const query = config.params ? `?${new URLSearchParams(config.params)}` : '';
    const call: Call = { method, url: url + query, data, headers: (config.headers ?? {}) as Record<string, unknown> };
    calls.push(call);

    const key = Object.keys(routes)
      .filter((k) => { const [m, p] = k.split(' ', 2); return m === method && call.url.startsWith(p!); })
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new AxiosError(`connect ECONNREFUSED (no mock for ${method} ${call.url})`, 'ECONNREFUSED');

    const out   = await routes[key]!(call);
    const reply = isReply(out) ? out : { status: 200, data: out };
    const response = {
      status: reply.status ?? 200, data: reply.data, headers: reply.headers ?? {}, statusText: '', config,
    } as AxiosResponse;
    if (response.status >= 400) {
      throw new AxiosError(`Request failed with status code ${response.status}`, 'ERR_BAD_RESPONSE', undefined, undefined, response);
    }
    return response;
  }

  vi.spyOn(axios, 'get').mockImplementation(((url: string, config?: AxiosRequestConfig) =>
    handle('GET', url, undefined, config)) as never);
  vi.spyOn(axios, 'post').mockImplementation(((url: string, data?: unknown, config?: AxiosRequestConfig) =>
    handle('POST', url, data, config)) as never);
  vi.spyOn(axios, 'request').mockImplementation(((config: AxiosRequestConfig) =>
    handle(String(config.method).toUpperCase(), config.url!, config.data, config)) as never);

  return calls;
}
