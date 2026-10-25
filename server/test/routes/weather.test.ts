import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { mockAxios } from '../helpers/http';
import { mountRouter } from '../helpers/router';

const OPEN_METEO = 'GET https://api.open-meteo.com/v1/forecast';
const forecast = { current: { temperature_2m: 71.4, weather_code: 1 } };

let app: Express;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  app = await mountRouter('/api/weather', () => import('../../routes/weather'));
});
afterEach(() => vi.useRealTimers());

describe('GET /api/weather', () => {
  it('fetches from Open-Meteo in Fahrenheit / mph', async () => {
    const calls = mockAxios({ [OPEN_METEO]: () => forecast });
    const { body } = await request(app).get('/api/weather?lat=40&lon=-74').expect(200);
    expect(body).toEqual(forecast);

    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get('latitude')).toBe('40');
    expect(url.searchParams.get('temperature_unit')).toBe('fahrenheit');
    expect(url.searchParams.get('wind_speed_unit')).toBe('mph');
  });

  it('caches for 10 minutes', async () => {
    const calls = mockAxios({ [OPEN_METEO]: () => forecast });
    await request(app).get('/api/weather');
    vi.setSystemTime(Date.now() + 9 * 60 * 1000);
    await request(app).get('/api/weather');
    expect(calls).toHaveLength(1);

    vi.setSystemTime(Date.now() + 2 * 60 * 1000);
    await request(app).get('/api/weather');
    expect(calls).toHaveLength(2);
  });

  it('serves a stale forecast rather than an error when Open-Meteo is down', async () => {
    let up = true;
    mockAxios({ [OPEN_METEO]: () => up ? forecast : { status: 500 } });
    await request(app).get('/api/weather');
    up = false;
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    const { body } = await request(app).get('/api/weather').expect(200);
    expect(body).toEqual(forecast);
  });

  it('503s when there is nothing cached to fall back on', async () => {
    mockAxios({});
    await request(app).get('/api/weather').expect(503);
  });
});
