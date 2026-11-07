import * as activity from './activity';
import * as circadian from './circadian';
import * as controller from './controller';
import * as presence from './presence';
import type { ActivityEntry, ActivityLine, LightValues, ZoneExplanation } from '../types';

// "Why are the lights like this?" — one answer shared by the dashboard's history sheet
// and voice, built from the controller's decision, presence's state and the activity log.
// It covers what is holding automation back as well, since "why didn't the light come
// on?" is the question that comes up most.

export const clock = (at: number | Date): string =>
  new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const tone = (colorTemp: number): string => (colorTemp < 30 ? 'warm' : colorTemp < 70 ? 'neutral' : 'cool');

export const describeLook = (look: LightValues): string => `${look.brightness}% ${tone(look.colorTemp)}`;

const by = (e: ActivityEntry): string =>
    e.source === 'dashboard' ? 'You'
  : e.source === 'voice'     ? 'You (voice)'
  : e.source === 'rule'      ? `"${e.rule}"`
  : e.source === 'presence'  ? 'Motion'
  : 'The wall switch';

/** One log entry as a sentence, without its time. */
export function describe(e: ActivityEntry, bulbName: (id: string) => string = (id) => id): string {
  const what = e.bulbs ? e.bulbs.map(bulbName).join(', ') : 'it';
  const look = e.look ? ` (${describeLook(e.look)})` : '';
  switch (e.action) {
    case 'set':
      return `${by(e)} set ${what} to ${e.look ? describeLook(e.look) : 'a new look'}`;
    case 'on':
      if (e.source === 'wall')     return `Power came back — on${look}`;
      if (e.source === 'presence') return `Motion turned it on${e.note === 'night light' ? ' as a night light' : ''}${look}`;
      return `${by(e)} turned ${what} on${look}`;
    case 'off':
      if (e.source === 'wall')     return 'Lost power — switched off at the wall?';
      if (e.source === 'presence') return 'Empty — motion turned it off';
      return `${by(e)} turned ${what} off`;
    case 'resume':   return `${by(e)} handed it back to automation`;
    case 'auto-on':  return `${by(e)} turned Auto on`;
    case 'auto-off': return `${by(e)} turned Auto off`;
    case 'skipped':  return `"${e.rule}" left it alone — it was being adjusted by hand`;
    case 'blocked':  return 'Motion didn\'t turn it on — it had been switched off by hand';
  }
}

export function history(zone: string, since: number): ActivityLine[] {
  return activity.list(since, zone).map((e) => ({
    at:     e.at,
    source: e.source,
    text:   describe(e, controller.zoneName),
  }));
}

export function explain(zone: string, since = Date.now() - 24 * 60 * 60 * 1000): ZoneExplanation {
  const state   = controller.getZonesState()[zone];
  const rt      = controller.zoneRuntime(zone);
  const window  = controller.governingWindow(zone);
  const status  = presence.roomStatus(zone);
  const on      = controller.isZoneOn(zone);
  const log     = activity.list(0, zone);
  const now     = Date.now();
  const control = state?.control ?? 'none';
  const auto    = state?.auto ?? false;

  const reasons: string[] = [];
  const blocked: string[] = [];

  if (!on) {
    const lastOff = [...log].reverse().find((e) => e.action === 'off');
    reasons.push(lastOff ? `Off since ${clock(lastOff.at)} — ${lowerFirst(describe(lastOff, controller.zoneName))}.` : 'It\'s off.');
  }

  if (control === 'manual' && rt.manual) {
    const lastManual = [...log].reverse().find((e) => e.action === 'set' && (e.source === 'dashboard' || e.source === 'voice'));
    const how = lastManual?.source === 'voice' ? ' by voice' : '';
    reasons.push(`You adjusted it${how} at ${clock(rt.manual.startedAt)}; it stays that way until it's turned off.`);
    if (window) blocked.push(`"${window.rule.name}" is leaving it alone because you adjusted it.`);
    else if (auto) blocked.push('Auto is paused until it\'s turned off.');
  } else if (control === 'presence' && rt.presenceLook) {
    reasons.push(`Motion turned it on as a night light (${describeLook(rt.presenceLook)})${window ? ` for "${window.rule.name}"` : ''}.`);
  } else if (control === 'rule' && window) {
    reasons.push(`"${window.rule.name}" sets the look until ${clock(window.end)}.`);
  } else if (window) {
    reasons.push(`"${window.rule.name}" is in effect until ${clock(window.end)}.`);
  }

  if (on && control === 'auto') {
    reasons.push(`On Auto — ${describeLook(circadian.currentValues())} right now, shifting through the day.`);
  } else if (on && control === 'none' && !rt.manual) {
    reasons.push('Not on Auto, so it stays however it was last set.');
  }

  if (status.vacantOffAt) reasons.push(`Turning off at ${clock(status.vacantOffAt)} unless someone moves.`);

  if (status.sensors > 0) {
    const policy = controller.presencePolicy(zone);
    if (!status.enabled) {
      blocked.push('Its motion sensor is turned off in settings.');
    } else if (status.cooldownUntil) {
      const since = status.cooldownUntil - status.cooldownMinutes * 60000;
      blocked.push(`Motion won't turn it on until ${clock(status.cooldownUntil)} — it was switched off by hand at ${clock(since)}.`);
    } else if (policy?.mode === 'ignore' && window) {
      blocked.push(`"${window.rule.name}" ignores motion until ${clock(window.end)}.`);
    }
  }

  const offline = controller.offlineBulbs(zone);
  if (offline.length) {
    blocked.push(`${offline.join(', ')} can't be reached — switched off at the wall?`);
  }

  return {
    zone,
    name: controller.zoneName(zone),
    on,
    control,
    auto,
    reasons,
    blocked,
    history: history(zone, Math.min(since, now)),
  };
}

const lowerFirst = (s: string): string => (s.startsWith('"') ? s : s[0]!.toLowerCase() + s.slice(1));
