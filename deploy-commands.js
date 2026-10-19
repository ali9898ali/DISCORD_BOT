// Run this ONCE (and again whenever you add/change a command): npm run deploy
require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and CLIENT_ID in your .env file first.');
  process.exit(1);
}

const isSnowflake = (value) => /^\d{17,20}$/.test(value);
if (!isSnowflake(CLIENT_ID)) {
  console.error('CLIENT_ID must be the numeric Application ID from Discord, not the bot token.');
  process.exit(1);
}
if (GUILD_ID && !isSnowflake(GUILD_ID)) {
  console.error('GUILD_ID must be the numeric server ID.');
  process.exit(1);
}

const commandsDir = path.join(__dirname, 'commands');
const modules = fs
  .readdirSync(commandsDir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => require(path.join(commandsDir, f)));
const commands = modules.flatMap((item) => (Array.isArray(item) ? item : [item]));
const names = commands.map((command) => command?.data?.name).filter(Boolean);
const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
if (duplicates.length) {
  console.error(`Duplicate slash command names: ${[...new Set(duplicates)].join(', ')}`);
  process.exit(1);
}
const body = commands.map((command) => {
  if (!command?.data?.toJSON) throw new Error('A command module has no serializable SlashCommandBuilder.');
  return command.data.toJSON();
});

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  try {
    const route = GUILD_ID
      ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) // instant, one server
      : Routes.applicationCommands(CLIENT_ID); // global, up to ~1 hour
    await rest.put(route, { body });
    console.log(`✅ Registered ${body.length} commands ${GUILD_ID ? `in guild ${GUILD_ID}` : 'globally'}.`);
  } catch {
    console.error('Command registration failed. Check the Discord secrets, app settings, and bot permissions.');
    process.exitCode = 1;
  }
})();
