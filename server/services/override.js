const EventEmitter = require('events');

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

class OverrideService extends EventEmitter {
  constructor() {
    super();
    this._overrides = {}; // { groupName: { expiresAt, timerId } }
  }

  set(groupName, durationMs = DEFAULT_DURATION_MS) {
    if (this._overrides[groupName]) {
      clearTimeout(this._overrides[groupName].timerId);
    }
    const expiresAt = Date.now() + durationMs;
    const timerId = setTimeout(() => this._expire(groupName), durationMs);
    if (timerId.unref) timerId.unref();
    this._overrides[groupName] = { expiresAt, timerId };
    this.emit('change', this.getState());
  }

  clear(groupName) {
    if (!this._overrides[groupName]) return;
    clearTimeout(this._overrides[groupName].timerId);
    delete this._overrides[groupName];
    this.emit('change', this.getState());
  }

  _expire(groupName) {
    delete this._overrides[groupName];
    this.emit('change', this.getState());
    this.emit('resume', groupName);
  }

  isOverridden(groupName) {
    return !!this._overrides[groupName];
  }

  getState() {
    const state = {};
    for (const [name, { expiresAt }] of Object.entries(this._overrides)) {
      state[name] = expiresAt;
    }
    return state;
  }
}

module.exports = new OverrideService();
