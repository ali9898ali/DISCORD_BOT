require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {
  Client,
  Collection,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
} = require('discord.js');

const config = require('./config');
const settings = require('./utils/settings');
const state = require('./utils/state');
const music = require('./utils/music');
const giveaways = require('./utils/giveaways');

// ---------------------------------------------------------------
// 1) Token check. The token is read from the DISCORD_TOKEN variable
//    (your local ".env" file, or the host's "Environment Variables").
// ---------------------------------------------------------------
if (!process.env.DISCORD_TOKEN) {
  console.error('Missing DISCORD_TOKEN. Copy .env.example to .env and add your bot token.');
  process.exit(1);
}

// ---------------------------------------------------------------
// 2) Client. GuildMembers is a PRIVILEGED intent: enable it in the
//    Developer Portal (Bot tab -> "Server Members Intent").
// ---------------------------------------------------------------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

// ---------------------------------------------------------------
// 3) Load every file in /commands
// ---------------------------------------------------------------
client.commands = new Collection();
const commandsDir = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsDir).filter((f) => f.endsWith('.js'))) {
  const loaded = require(path.join(commandsDir, file));
  const commands = Array.isArray(loaded) ? loaded : [loaded];
  for (const command of commands) {
    if (!command?.data?.name || typeof command.execute !== 'function') {
      throw new Error(`Invalid command module: ${file}`);
    }
    if (client.commands.has(command.data.name)) {
      throw new Error(`Duplicate slash command name: ${command.data.name}`);
    }
    client.commands.set(command.data.name, command);
  }
}

music.initialize(client);

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Logged in as ${c.user.tag} | ${client.commands.size} commands loaded`);
  music.restorePersistentConnections(client).catch((error) => {
    console.error('Could not restore 24/7 voice connections:', error.message);
  });
  giveaways.startScheduler(client);
  startTemporaryBanScheduler(client);
});

// ---------------------------------------------------------------
// 4) Slash command handler
// ---------------------------------------------------------------
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isButton() && interaction.customId.startsWith('giveaway:enter:')) {
    await giveaways.handleButton(interaction);
    return;
  }
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({ content: '❌ Unknown command.', flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    if (!command.immediate) {
      if (command.ephemeral) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      else await interaction.deferReply();
    }
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error in /${interaction.commandName}:`, error instanceof Error ? error.message : 'Unknown error');
    const reply = { content: '❌ Something went wrong running that command.' };
    if (interaction.deferred) await interaction.editReply(reply).catch(() => {});
    else if (interaction.replied) await interaction.followUp({ ...reply, flags: MessageFlags.Ephemeral }).catch(() => {});
    else await interaction.reply({ ...reply, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
});

// Award activity XP without reading message content; the Message Content
// privileged intent is therefore not required.
client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot) return;
  const current = state.getUser(message.guild.id, message.author.id);
  if (Date.now() - current.lastXp < 60_000) return;

  state.updateUser(message.guild.id, message.author.id, (user) => {
    if (Date.now() - user.lastXp < 60_000) return user;
    user.lastXp = Date.now();
    user.xp += 15 + Math.floor(Math.random() * 11);
    while (user.xp >= (user.level + 1) * 100) user.level += 1;
    return user;
  });
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  music.handleVoiceStateUpdate(oldState, newState).catch((error) => {
    console.error('Voice state handling failed:', error.message);
  });
  if (!newState.channelId || newState.member?.user.bot) return;
  const guildState = state.getGuild(newState.guild.id);
  if (guildState.voiceMuteIds.includes(newState.id) && !newState.serverMute) {
    await newState.setMute(true, 'Reapplying saved voice mute').catch(() => {});
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  if (!channel.guild || !channel.permissionOverwrites) return;
  const prisonRoleId = state.getGuild(channel.guild.id).prisonRoleId;
  if (!prisonRoleId) return;
  const role = channel.guild.roles.cache.get(prisonRoleId);
  if (!role) return;
  const deny = {};
  if (channel.isTextBased() && !channel.isThread?.()) {
    Object.assign(deny, {
      SendMessages: false,
      AddReactions: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
    });
  }
  if (channel.isVoiceBased()) Object.assign(deny, { Connect: false, Speak: false, UseVAD: false });
  if (Object.keys(deny).length) await channel.permissionOverwrites.edit(role, deny).catch(() => {});
});

function startTemporaryBanScheduler(botClient) {
  const tick = async () => {
    const now = Date.now();
    for (const [guildId, guildData] of Object.entries(state.getAllGuilds())) {
      for (const [userId, ban] of Object.entries(guildData.tempBans || {})) {
        if (ban.unbanAt > now) continue;
        const guild = botClient.guilds.cache.get(guildId);
        if (guild) await guild.members.unban(userId, 'Temporary ban expired').catch(() => {});
        state.updateGuild(guildId, (current) => {
          delete current.tempBans[userId];
          return current;
        });
      }
    }
  };
  setInterval(() => tick().catch((error) => console.error('Temporary ban scheduler failed:', error.message)), 30_000).unref();
}

// ---------------------------------------------------------------
// 5) Welcome message for new members
// ---------------------------------------------------------------
client.on(Events.GuildMemberAdd, async (member) => {
  const s = settings.get(member.guild.id);
  if (!s.welcomeEnabled) return;

  const channel = s.welcomeChannelId
    ? member.guild.channels.cache.get(s.welcomeChannelId)
    : member.guild.systemChannel;
  if (!channel || !channel.isTextBased()) return;

  const text = s.welcomeMessage
    .replaceAll('{user}', `${member}`)
    .replaceAll('{username}', member.user.username)
    .replaceAll('{server}', member.guild.name)
    .replaceAll('{count}', String(member.guild.memberCount));

  const embed = new EmbedBuilder()
    .setColor(config.embedColor)
    .setDescription(text)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  channel.send({ embeds: [embed] }).catch((err) => console.error('Welcome message failed:', err.message));
});

// ---------------------------------------------------------------
// 6) Tiny web server. Free hosts like Render need an open port, and it
//    gives uptime monitors something to ping. Harmless when run locally.
// ---------------------------------------------------------------
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running.');
  })
  .listen(process.env.PORT || 3000);

client.login(process.env.DISCORD_TOKEN);
