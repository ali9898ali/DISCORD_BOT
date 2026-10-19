const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(__dirname, '..', 'data', 'bot-state.json');

function emptyGuild() {
  return {
    playlists: {},
    warnings: {},
    tickets: {},
    ticketPoints: {},
    giveaways: {},
    users: {},
    tempBans: {},
    voiceMuteIds: [],
    voice24hChannelId: null,
    prisonRoleId: null,
  };
}

function readAll() {
  if (!fs.existsSync(FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (error) {
    throw new Error(`Bot state file is unreadable: ${error.message}`);
  }
}

function writeAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const temp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(all, null, 2));
  fs.renameSync(temp, FILE);
}

function getGuild(guildId) {
  const all = readAll();
  return structuredClone({ ...emptyGuild(), ...(all[guildId] || {}) });
}

function updateGuild(guildId, mutate) {
  if (!guildId) throw new Error('A guild ID is required to save bot state.');
  const all = readAll();
  const current = { ...emptyGuild(), ...(all[guildId] || {}) };
  const next = mutate(current) || current;
  all[guildId] = next;
  writeAll(all);
  return structuredClone(next);
}

function defaultUser() {
  return {
    xp: 0,
    level: 0,
    gold: 0,
    rep: 0,
    streak: 0,
    lastDaily: 0,
    lastRep: 0,
    lastXp: 0,
    aboutMe: '',
  };
}

function getUser(guildId, userId) {
  const guild = getGuild(guildId);
  return { ...defaultUser(), ...(guild.users[userId] || {}) };
}

function updateUser(guildId, userId, mutate) {
  let saved;
  updateGuild(guildId, (guild) => {
    const user = { ...defaultUser(), ...(guild.users[userId] || {}) };
    saved = mutate(user) || user;
    guild.users[userId] = saved;
    return guild;
  });
  return structuredClone(saved);
}

function getAllGuilds() {
  return readAll();
}

module.exports = { getGuild, updateGuild, getUser, updateUser, getAllGuilds };
