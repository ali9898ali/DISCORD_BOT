const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const state = require('../utils/state');
const { canActOnMember, clampText } = require('../utils/command-utils');

async function getPrisonRole(guild) {
  const savedId = state.getGuild(guild.id).prisonRoleId;
  let role = savedId ? guild.roles.cache.get(savedId) : null;
  let configureOverwrites = false;
  if (!role) {
    role = guild.roles.cache.find((candidate) => candidate.name === 'Prisoner');
    if (!role) {
      role = await guild.roles.create({
        name: 'Prisoner',
        color: 0x555555,
        permissions: [],
        reason: 'Created for the /prison moderation command',
      });
    }
    configureOverwrites = true;
    state.updateGuild(guild.id, (data) => {
      data.prisonRoleId = role.id;
      return data;
    });
  }

  if (!configureOverwrites) return role;
  for (const channel of guild.channels.cache.values()) {
    if (!channel.permissionOverwrites) continue;
    const deny = {};
    if (channel.isTextBased() && !channel.isThread?.()) {
      deny.SendMessages = false;
      deny.AddReactions = false;
      deny.SendMessagesInThreads = false;
      deny.CreatePublicThreads = false;
      deny.CreatePrivateThreads = false;
    }
    if (channel.isVoiceBased()) {
      deny.Connect = false;
      deny.Speak = false;
      deny.UseVAD = false;
    }
    if (Object.keys(deny).length) await channel.permissionOverwrites.edit(role, deny).catch(() => {});
  }
  return role;
}

function validRoleForChange(interaction, role) {
  const botHighest = interaction.guild.members.me?.roles.highest.position ?? 0;
  const actorHighest = interaction.member.roles.highest.position;
  if (role.id === interaction.guild.id || role.managed || role.position >= botHighest) return false;
  if (interaction.guild.ownerId !== interaction.user.id && role.position >= actorHighest) return false;
  return true;
}

async function bulkRoleChange(members, role, action) {
  let succeeded = 0;
  let failed = 0;
  for (const member of members) {
    if (member.roles.cache.has(role.id) === (action === 'add')) continue;
    try {
      await member.roles[action](role, `Role ${action} requested by server moderator`);
      succeeded++;
    } catch {
      failed++;
    }
  }
  return { succeeded, failed };
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user from the server')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('user_id').setDescription('Discord user ID to unban').setRequired(true).setMinLength(17).setMaxLength(20))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the unban').setMaxLength(300)),
    ephemeral: true,
    async execute(interaction) {
      const userId = interaction.options.getString('user_id', true);
      if (!/^\d{17,20}$/.test(userId)) return interaction.editReply({ content: 'Enter a valid Discord user ID.' });
      await interaction.guild.members.unban(userId, interaction.options.getString('reason') || `Unbanned by ${interaction.user.tag}`);
      state.updateGuild(interaction.guildId, (data) => {
        delete data.tempBans[userId];
        return data;
      });
      await interaction.editReply({ content: `Unbanned user \`${userId}\`.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Delete recent messages in this or another text channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('amount').setDescription('Number of recent messages (1–100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Text channel to clear (defaults to this channel)')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
    ephemeral: true,
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (channel.guildId !== interaction.guildId || !channel.isTextBased() || channel.isThread?.()) {
        return interaction.editReply({ content: 'Choose a text channel in this server.' });
      }
      const amount = interaction.options.getInteger('amount', true);
      const deleted = await channel.bulkDelete(amount, true);
      await interaction.editReply({ content: `Deleted ${deleted.size} recent message(s) in <#${channel.id}>. Messages older than 14 days are skipped.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Apply a Discord timeout to a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to timeout').setRequired(true))
      .addIntegerOption((o) => o.setName('minutes').setDescription('Duration in minutes (1–40320)').setRequired(true).setMinValue(1).setMaxValue(40320))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the timeout').setMaxLength(300)),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('member', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
      if (user.id === interaction.user.id) return interaction.editReply({ content: "You can't timeout yourself." });
      if (!member.moderatable || !canActOnMember(interaction, member)) {
        return interaction.editReply({ content: 'You cannot timeout that member because of role hierarchy or permissions.' });
      }
      const minutes = interaction.options.getInteger('minutes', true);
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await member.timeout(minutes * 60_000, `${reason} (by ${interaction.user.tag})`);
      await interaction.editReply({ content: `Timed out **${member.displayName}** for ${minutes} minute(s). Reason: ${reason}` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('untimeout')
      .setDescription('Remove a Discord timeout from a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to untimeout').setRequired(true)),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('member', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
      if (!member.moderatable || !canActOnMember(interaction, member)) {
        return interaction.editReply({ content: 'You cannot remove the timeout from that member.' });
      }
      await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);
      await interaction.editReply({ content: `Removed the timeout from **${member.displayName}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('prison')
      .setDescription('Restrict a member’s text and voice access with the Prisoner role')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to imprison').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason').setMaxLength(300)),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('member', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
      if (user.id === interaction.user.id || !canActOnMember(interaction, member)) {
        return interaction.editReply({ content: 'You cannot imprison that member.' });
      }
      const role = await getPrisonRole(interaction.guild);
      await member.roles.add(role, interaction.options.getString('reason') || `Imprisoned by ${interaction.user.tag}`);
      await interaction.editReply({ content: `Applied the **${role.name}** restriction to **${member.displayName}**. Use \`/unprison\` to remove it.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unprison')
      .setDescription('Remove a member’s Prisoner role')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to release').setRequired(true)),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('member', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
      const saved = state.getGuild(interaction.guildId);
      const role = (saved.prisonRoleId && interaction.guild.roles.cache.get(saved.prisonRoleId)) || interaction.guild.roles.cache.find((r) => r.name === 'Prisoner');
      if (!role || !member.roles.cache.has(role.id)) return interaction.editReply({ content: 'That member does not have the Prisoner role.' });
      if (!canActOnMember(interaction, member)) return interaction.editReply({ content: 'You cannot release that member because of role hierarchy.' });
      await member.roles.remove(role, `Released by ${interaction.user.tag}`);
      await interaction.editReply({ content: `Removed the **${role.name}** restriction from **${member.displayName}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Prevent @everyone from sending messages in this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .setDMPermission(false),
    ephemeral: true,
    async execute(interaction) {
      if (!interaction.channel.permissionOverwrites) return interaction.editReply({ content: 'This channel cannot be locked.' });
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
      await interaction.editReply({ content: `Locked <#${interaction.channelId}> for @everyone.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Remove the @everyone send-message lock from this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .setDMPermission(false),
    ephemeral: true,
    async execute(interaction) {
      if (!interaction.channel.permissionOverwrites) return interaction.editReply({ content: 'This channel cannot be unlocked.' });
      await interaction.channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
      await interaction.editReply({ content: `Removed the @everyone send-message lock from <#${interaction.channelId}>.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('modlist')
      .setDescription('List members who are timed out, voice-muted, imprisoned, or temporarily banned')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false),
    ephemeral: true,
    async execute(interaction) {
      const saved = state.getGuild(interaction.guildId);
      const now = Date.now();
      const lines = [];
      for (const member of interaction.guild.members.cache.values()) {
        if (member.communicationDisabledUntilTimestamp > now) {
          lines.push(`Timeout — ${member} until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`);
        }
        if (saved.voiceMuteIds.includes(member.id)) lines.push(`Voice-muted — ${member}`);
        const prisonRole = saved.prisonRoleId && interaction.guild.roles.cache.get(saved.prisonRoleId);
        if (prisonRole && member.roles.cache.has(prisonRole.id)) lines.push(`Imprisoned — ${member}`);
      }
      for (const [userId, ban] of Object.entries(saved.tempBans)) {
        if (ban.unbanAt > now) lines.push(`Temporary ban — <@${userId}> until <t:${Math.floor(ban.unbanAt / 1000)}:R>`);
      }
      await interaction.editReply({ content: lines.length ? lines.slice(0, 25).join('\n') : 'No active moderation restrictions were found.' });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('setnickname')
      .setDescription('Set or clear a member nickname')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
      .addStringOption((o) => o.setName('nickname').setDescription('New nickname (up to 32 characters)').setMaxLength(32))
      .addBooleanOption((o) => o.setName('remove').setDescription('Clear the member’s nickname')),
    ephemeral: true,
    async execute(interaction) {
      const user = interaction.options.getUser('member', true);
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
      if (!member.manageable || !canActOnMember(interaction, member)) return interaction.editReply({ content: 'You cannot change that member’s nickname.' });
      const remove = interaction.options.getBoolean('remove') ?? false;
      const nickname = interaction.options.getString('nickname');
      if (!remove && !nickname) return interaction.editReply({ content: 'Provide a nickname or set `remove` to true.' });
      await member.setNickname(remove ? null : nickname, `Nickname changed by ${interaction.user.tag}`);
      await interaction.editReply({ content: remove ? `Cleared **${member.user.tag}**’s nickname.` : `Set **${member.user.tag}**’s nickname to **${nickname}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('role')
      .setDescription('Add or remove roles from members')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('member_add')
          .setDescription('Add a role to one member')
          .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to add').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('member_remove')
          .setDescription('Remove a role from one member')
          .addUserOption((o) => o.setName('member').setDescription('Member').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('server_add').setDescription('Add a role to every server member').addRoleOption((o) => o.setName('role').setDescription('Role to add').setRequired(true)),
      )
      .addSubcommand((s) =>
        s.setName('server_remove').setDescription('Remove a role from every server member').addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('members_add')
          .setDescription('Add a role to members who have another role')
          .addRoleOption((o) => o.setName('source_role').setDescription('Role whose members are selected').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to add').setRequired(true)),
      )
      .addSubcommand((s) =>
        s
          .setName('members_remove')
          .setDescription('Remove a role from members who have another role')
          .addRoleOption((o) => o.setName('source_role').setDescription('Role whose members are selected').setRequired(true))
          .addRoleOption((o) => o.setName('role').setDescription('Role to remove').setRequired(true)),
      ),
    ephemeral: true,
    async execute(interaction) {
      const action = interaction.options.getSubcommand();
      const role = interaction.options.getRole('role', true);
      if (!validRoleForChange(interaction, role)) return interaction.editReply({ content: 'That role is managed or is above your or my highest role.' });

      if (action.startsWith('member_')) {
        const member = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
        if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
        if (!canActOnMember(interaction, member)) return interaction.editReply({ content: 'You cannot manage roles for that member.' });
        await member.roles[action === 'member_add' ? 'add' : 'remove'](role, `Role change by ${interaction.user.tag}`);
        return interaction.editReply({ content: `${action === 'member_add' ? 'Added' : 'Removed'} **${role.name}** ${action === 'member_add' ? 'to' : 'from'} **${member.displayName}**.` });
      }

      const members = await interaction.guild.members.fetch();
      let selected = [...members.values()];
      if (action.startsWith('members_')) {
        const sourceRole = interaction.options.getRole('source_role', true);
        selected = selected.filter((member) => member.roles.cache.has(sourceRole.id));
      }
      const result = await bulkRoleChange(selected, role, action.endsWith('_add') ? 'add' : 'remove');
      await interaction.editReply({
        content: `Updated **${role.name}** for ${result.succeeded} member(s). ${result.failed} failed. This command affects ${action.startsWith('server_') ? 'the entire server' : 'members with the selected source role'}.`,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('rar')
      .setDescription('Remove all manageable roles from a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to remove roles from').setRequired(true)),
    ephemeral: true,
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
      if (!canActOnMember(interaction, member)) return interaction.editReply({ content: 'You cannot manage roles for that member.' });
      const botHighest = interaction.guild.members.me.roles.highest.position;
      const removable = member.roles.cache.filter((role) => role.id !== interaction.guild.id && !role.managed && role.position < botHighest);
      if (!removable.size) return interaction.editReply({ content: 'That member has no roles I can remove.' });
      await member.roles.remove(removable, `All manageable roles removed by ${interaction.user.tag}`);
      await interaction.editReply({ content: `Removed ${removable.size} role(s) from **${member.displayName}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Add, remove, and list member warnings')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .setDMPermission(false)
      .addSubcommand((s) =>
        s
          .setName('add')
          .setDescription('Warn a member')
          .addUserOption((o) => o.setName('member').setDescription('Member to warn').setRequired(true))
          .addStringOption((o) => o.setName('reason').setDescription('Warning reason').setRequired(true).setMaxLength(500)),
      )
      .addSubcommand((s) =>
        s
          .setName('remove')
          .setDescription('Remove one member’s warnings or clear all server warnings')
          .addUserOption((o) => o.setName('member').setDescription('Member (omit to clear all server warnings)'))
          .addStringOption((o) => o.setName('warning_id').setDescription('Specific warning ID (omit to clear that member’s warnings)').setMaxLength(20)),
      )
      .addSubcommand((s) =>
        s.setName('list').setDescription('List warnings for a member or the server').addUserOption((o) => o.setName('member').setDescription('Member (omit to list server warnings)')),
      ),
    ephemeral: true,
    async execute(interaction) {
      const action = interaction.options.getSubcommand();
      const user = interaction.options.getUser('member');
      const saved = state.getGuild(interaction.guildId);

      if (action === 'add') {
        if (!user) return interaction.editReply({ content: 'Choose a member to warn.' });
        const member = await interaction.guild.members.fetch(user.id).catch(() => null);
        if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
        if (!canActOnMember(interaction, member)) return interaction.editReply({ content: 'You cannot warn a member with an equal or higher role.' });
        const warning = {
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
          reason: interaction.options.getString('reason', true),
          moderatorId: interaction.user.id,
          createdAt: Date.now(),
        };
        state.updateGuild(interaction.guildId, (data) => {
          data.warnings[user.id] ||= [];
          data.warnings[user.id].push(warning);
          return data;
        });
        return interaction.editReply({ content: `Warned **${member.displayName}**. Warning ID: \`${warning.id}\`. Reason: ${warning.reason}` });
      }

      if (action === 'remove') {
        const warningId = interaction.options.getString('warning_id');
        let removed = 0;
        state.updateGuild(interaction.guildId, (data) => {
          if (user) {
            const existing = data.warnings[user.id] || [];
            if (warningId) {
              const filtered = existing.filter((warning) => warning.id !== warningId);
              removed = existing.length - filtered.length;
              if (filtered.length) data.warnings[user.id] = filtered;
              else delete data.warnings[user.id];
            } else {
              removed = existing.length;
              delete data.warnings[user.id];
            }
          } else {
            removed = Object.values(data.warnings).reduce((count, list) => count + list.length, 0);
            data.warnings = {};
          }
          return data;
        });
        return interaction.editReply({ content: removed ? `Removed ${removed} warning(s).` : 'No matching warnings were found.' });
      }

      const entries = user
        ? (saved.warnings[user.id] || []).map((warning) => ({ memberId: user.id, warning }))
        : Object.entries(saved.warnings).flatMap(([memberId, warnings]) => warnings.map((warning) => ({ memberId, warning })));
      if (!entries.length) return interaction.editReply({ content: 'No warnings were found.' });
      const lines = entries.slice(0, 20).map(
        ({ memberId, warning }) =>
          `• <@${memberId}> — \`${warning.id}\` — ${clampText(warning.reason, 160)} — <t:${Math.floor(warning.createdAt / 1000)}:R>`,
      );
      await interaction.editReply({ content: `${lines.join('\n')}${entries.length > 20 ? `\n…and ${entries.length - 20} more.` : ''}` });
    },
  },
];
