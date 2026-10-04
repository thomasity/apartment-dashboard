const EventEmitter = require('events');

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * @typedef {Object} OverrideEntry
 * @property {number} expiresAt
 * @property {NodeJS.Timeout} timerId
 */

/**
 * @typedef {Object.<string, number>} OverridesMap
 * Map of group name -> expiresAt timestamp (ms).
 */

class OverrideService extends EventEmitter {
  constructor() {
    super();
    /** @type {Object.<string, OverrideEntry>} */
    this._overrides = {};
  }

  /**
   * @param {string} groupName
   * @param {number} [durationMs]
   * @returns {void}
   */
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

  /**
   * @param {string} groupName
   * @returns {void}
   */
  clear(groupName) {
    if (!this._overrides[groupName]) return;
    clearTimeout(this._overrides[groupName].timerId);
    delete this._overrides[groupName];
    this.emit('change', this.getState());
  }

  /**
   * @param {string} groupName
   * @returns {void}
   */
  _expire(groupName) {
    delete this._overrides[groupName];
    this.emit('change', this.getState());
    this.emit('resume', groupName);
  }

  /**
   * @param {string} groupName
   * @returns {boolean}
   */
  isOverridden(groupName) {
    return !!this._overrides[groupName];
  }

  /** @returns {OverridesMap} */
  getState() {
    /** @type {OverridesMap} */
    const state = {};
    for (const [name, { expiresAt }] of Object.entries(this._overrides)) {
      state[name] = expiresAt;
    }
    return state;
  }
}

module.exports = new OverrideService();
