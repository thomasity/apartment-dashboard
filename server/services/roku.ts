import axios from 'axios';
import * as config from '../config';
import { ServiceError } from '../util';

// Talking to the Roku over its LAN control protocol (ECP), shared by the TV routes and
// the TV watcher.

export function rokuIp(): string | undefined {
  return config.get('rokuIp') ?? process.env.ROKU_IP;
}

export function rokuBase(): string {
  const ip = rokuIp();
  if (!ip) throw new ServiceError('ROKU_IP not configured', 'NO_IP');
  return `http://${ip}:8060`;
}

// Roku's ECP responses are small, predictable XML fragments, so a handful of regexes
// are simpler here than pulling in a full XML parser.

export function xmlAttr(xml: string, tag: string, attr: string): string | null {
  const re    = new RegExp(`<${tag}\\b[^>]*\\s${attr}="([^"]*)"`, 'i');
  const match = xml.match(re);
  return match?.[1] ?? null;
}

export function xmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return match?.[1]?.trim() ?? null;
}

export async function fetchDeviceInfo(ip: string, timeout: number): Promise<string> {
  const { data } = await axios.get<string>(`http://${ip}:8060/query/device-info`, { timeout });
  return data;
}

/** The app in front, from /query/active-app — { id: null, name: 'Roku' } on the home screen. */
export function parseActiveApp(xml: string): { id: string | null; name: string | null } {
  const match = xml.match(/<app\b[^>]*id="([^"]*)"[^>]*>([^<]*)<\/app>/) ?? xml.match(/<app>([^<]*)<\/app>/);
  if (!match) return { id: null, name: null };
  return match.length === 3
    ? { id: match[1] ?? null, name: match[2]?.trim() ?? null }
    : { id: null, name: match[1]?.trim() ?? null };
}
