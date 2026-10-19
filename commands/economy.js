const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const state = require('../utils/state');

function xpLevel(xp) {
  return Math.floor(Math.max(0, xp) / 100);
}

function leaderboard(guild, selector) {
  return Object.entries(guild.users)
    .map(([id, user]) => ({ id, ...user }))
    .sort((a, b) => selector(b) - selector(a))
    .slice(0, 10);
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('reset')
      .setDescription('Reset a member’s XP or all server XP')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      .addSubcommand((s) => s.setName('member').setDescription('Reset one member’s XP and level').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)))
      .addSubcommand((s) => s.setName('server').setDescription('Reset XP and levels for the whole server')),
    ephemeral: true,
    async execute(interaction) {
      const action = interaction.options.getSubcommand();
      if (action === 'member') {
        const user = interaction.options.getUser('user', true);
        state.updateUser(interaction.guildId, user.id, (data) => {
          data.xp = 0;
          data.level = 0;
          return data;
        });
        return interaction.editReply({ content: `Reset XP and level for ${user}.` });
      }
      state.updateGuild(interaction.guildId, (data) => {
        for (const user of Object.values(data.users)) {
          user.xp = 0;
          user.level = 0;
        }
        return data;
      });
      await interaction.editReply({ content: 'Reset XP and levels for all members in this server.' });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setxp')
      .setDescription('Set a member’s XP points')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('points').setDescription('XP points').setRequired(true).setMinValue(0).setMaxValue(1_000_000_000)),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('user', true);
      const xp = interaction.options.getInteger('points', true);
      const updated = state.updateUser(interaction.guildId, user.id, (data) => {
        data.xp = xp;
        data.level = xpLevel(xp);
        return data;
      });
      await interaction.editReply({ content: `Set ${user} to **${updated.xp} XP**, level **${updated.level}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setlevel')
      .setDescription('Set a member’s level')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      .addIntegerOption((o) => o.setName('level').setDescription('New level').setRequired(true).setMinValue(0).setMaxValue(10_000)),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('user', true);
      const level = interaction.options.getInteger('level', true);
      const updated = state.updateUser(interaction.guildId, user.id, (data) => {
        data.level = level;
        data.xp = level * 100;
        return data;
      });
      await interaction.editReply({ content: `Set ${user} to level **${updated.level}** (${updated.xp} XP).` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('top')
      .setDescription('Show the top XP members in this server')
      .setDMPermission(false),
    async execute(interaction) {
      const rows = leaderboard(state.getGuild(interaction.guildId), (user) => user.xp || 0);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`Top XP — ${interaction.guild.name}`);
      embed.setDescription(rows.length ? rows.map((user, index) => `**${index + 1}.** <@${user.id}> — ${user.xp || 0} XP (Level ${user.level || 0})`).join('\n') : 'No XP has been earned yet.');
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('streak')
      .setDescription('View a member’s daily claim streak')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member (default: you)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const profile = state.getUser(interaction.guildId, user.id);
      const lastClaim = profile.lastDaily ? ` Last claim: <t:${Math.floor(profile.lastDaily / 1000)}:R>.` : '';
      await interaction.editReply({ content: `**${user.username}** has a daily streak of **${profile.streak}** day(s).${lastClaim}` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('topstreak')
      .setDescription('Show the top daily claim streaks')
      .setDMPermission(false),
    async execute(interaction) {
      const rows = leaderboard(state.getGuild(interaction.guildId), (user) => user.streak || 0).filter((user) => user.streak > 0);
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(`Top daily streaks — ${interaction.guild.name}`);
      embed.setDescription(rows.length ? rows.map((user, index) => `**${index + 1}.** <@${user.id}> — ${user.streak} day(s)`).join('\n') : 'No daily streaks have been recorded yet.');
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('profile')
      .setDescription('View your or another member’s profile')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member (default: you)')),
    async execute(interaction) {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const profile = state.getUser(interaction.guildId, user.id);
      const embed = new EmbedBuilder()
        .setColor(member?.displayColor || 0x5865f2)
        .setTitle(`${member?.displayName || user.username}’s profile`)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Level', value: String(profile.level), inline: true },
          { name: 'XP', value: String(profile.xp), inline: true },
          { name: 'Gold', value: String(profile.gold), inline: true },
          { name: 'Daily streak', value: `${profile.streak} day(s)`, inline: true },
          { name: 'Reputation', value: String(profile.rep), inline: true },
          { name: 'About me', value: profile.aboutMe || 'Not set' },
        );
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('golds')
      .setDescription('View your gold balance or transfer gold to another member')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Balance to view (default: yours)'))
      .addUserOption((o) => o.setName('to').setDescription('Member to send gold to'))
      .addIntegerOption((o) => o.setName('amount').setDescription('Amount to transfer').setMinValue(1).setMaxValue(1_000_000)),
    ephemeral: true,
    async execute(interaction) {
      const recipient = interaction.options.getUser('to');
      const amount = interaction.options.getInteger('amount');
      const selectedUser = interaction.options.getUser('user');
      if (recipient || amount !== null) {
        if (!recipient || !amount || selectedUser) return interaction.editReply({ content: 'For a transfer, provide only `to` and `amount`.' });
        if (recipient.bot || recipient.id === interaction.user.id) return interaction.editReply({ content: 'Gold can only be sent to another human member.' });
        let result;
        state.updateGuild(interaction.guildId, (data) => {
          const sender = { ...(data.users[interaction.user.id] || {}) };
          const receiver = { ...(data.users[recipient.id] || {}) };
          sender.gold = sender.gold || 0;
          receiver.gold = receiver.gold || 0;
          if (sender.gold < amount) {
            result = { ok: false, balance: sender.gold };
            return data;
          }
          sender.gold -= amount;
          receiver.gold += amount;
          data.users[interaction.user.id] = sender;
          data.users[recipient.id] = receiver;
          result = { ok: true };
          return data;
        });
        if (!result.ok) return interaction.editReply({ content: `You have ${result.balance} gold, so you cannot transfer ${amount}.` });
        return interaction.editReply({ content: `Transferred **${amount} gold** to ${recipient}.` });
      }
      const user = selectedUser || interaction.user;
      const profile = state.getUser(interaction.guildId, user.id);
      await interaction.editReply({ content: `**${user.username}** has **${profile.gold} gold**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rep')
      .setDescription('Give a member one reputation point (once per day)')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member to give reputation to').setRequired(true)),
    ephemeral: true,
    async execute(interaction) {
      const recipient = interaction.options.getUser('user', true);
      if (recipient.bot || recipient.id === interaction.user.id) return interaction.editReply({ content: 'Choose another human member.' });
      const giver = state.getUser(interaction.guildId, interaction.user.id);
      const remaining = 24 * 60 * 60 * 1000 - (Date.now() - giver.lastRep);
      if (remaining > 0) return interaction.editReply({ content: `You can give reputation again <t:${Math.floor((Date.now() + remaining) / 1000)}:R>.` });
      state.updateUser(interaction.guildId, interaction.user.id, (data) => {
        data.lastRep = Date.now();
        return data;
      });
      state.updateUser(interaction.guildId, recipient.id, (data) => {
        data.rep += 1;
        return data;
      });
      await interaction.editReply({ content: `Gave one reputation point to ${recipient}.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('daily')
      .setDescription('Claim daily gold and build a streak')
      .setDMPermission(false),
    ephemeral: true,
    async execute(interaction) {
      const now = Date.now();
      let reward;
      let streak;
      const updated = state.updateUser(interaction.guildId, interaction.user.id, (data) => {
        const remaining = 24 * 60 * 60 * 1000 - (now - data.lastDaily);
        if (remaining > 0) {
          reward = 0;
          return data;
        }
        data.streak = data.lastDaily && now - data.lastDaily <= 48 * 60 * 60 * 1000 ? data.streak + 1 : 1;
        reward = 100 + Math.min(data.streak - 1, 7) * 10;
        data.gold += reward;
        data.lastDaily = now;
        streak = data.streak;
        return data;
      });
      if (reward === 0) {
        const next = updated.lastDaily + 24 * 60 * 60 * 1000;
        return interaction.editReply({ content: `You already claimed today. Try again <t:${Math.floor(next / 1000)}:R>.` });
      }
      await interaction.editReply({ content: `Daily claimed: **${reward} gold**. Streak: **${streak} day(s)**. Balance: **${updated.gold} gold**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setaboutme')
      .setDescription('Set or clear your profile’s about-me text')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('text').setDescription('About me (leave blank only with clear=true)').setMaxLength(200))
      .addBooleanOption((o) => o.setName('clear').setDescription('Clear your about-me text')),
    ephemeral: true,
    async execute(interaction) {
      const clear = interaction.options.getBoolean('clear') ?? false;
      const text = interaction.options.getString('text');
      if (!clear && text === null) return interaction.editReply({ content: 'Provide `text` or set `clear` to true.' });
      state.updateUser(interaction.guildId, interaction.user.id, (data) => {
        data.aboutMe = clear ? '' : text;
        return data;
      });
      await interaction.editReply({ content: clear ? 'Cleared your about-me text.' : 'Updated your about-me text.' });
    },
  },
];
