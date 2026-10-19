const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');

const FILE = path.join(__dirname, '..', 'data', 'settings.json');

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

/** Get a server's settings, falling back to defaults from config.js */
function get(guildId) {
  const defaults = {
    welcomeEnabled: config.welcome.enabled,
    welcomeMessage: config.welcome.message,
    welcomeChannelId: null,
  };
  return { ...defaults, ...(readAll()[guildId] || {}) };
}

/** Save (merge) settings for a server */
function set(guildId, patch) {
  const all = readAll();
  all[guildId] = { ...(all[guildId] || {}), ...patch };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

module.exports = { get, set };
