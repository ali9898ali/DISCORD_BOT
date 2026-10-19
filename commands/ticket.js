const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const state = require('../utils/state');

function isStaff(interaction) {
  return interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) ||
    interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages);
}

function ticketFor(interaction) {
  return state.getGuild(interaction.guildId).tickets[interaction.channelId] || null;
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'member';
}

async function getTicketCategory(guild) {
  let category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === 'tickets');
  if (!category) {
    category = await guild.channels.create({ name: 'Tickets', type: ChannelType.GuildCategory, reason: 'Ticket system setup' });
  }
  return category;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create and manage private support tickets')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Create a private support ticket').addStringOption((o) => o.setName('reason').setDescription('Brief reason for the ticket').setMaxLength(300)))
    .addSubcommand((s) => s.setName('close').setDescription('Close the current ticket'))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete the current ticket channel'))
    .addSubcommand((s) => s.setName('reopen').setDescription('Reopen the current ticket'))
    .addSubcommand((s) => s.setName('add_user').setDescription('Add a member to the current ticket').addUserOption((o) => o.setName('member').setDescription('Member to add').setRequired(true)))
    .addSubcommand((s) => s.setName('remove_user').setDescription('Remove a member from the current ticket').addUserOption((o) => o.setName('member').setDescription('Member to remove').setRequired(true)))
    .addSubcommand((s) => s.setName('claim').setDescription('Claim the current ticket'))
    .addSubcommand((s) => s.setName('unclaim').setDescription('Release your claim on the current ticket'))
    .addSubcommand((s) => s.setName('rename').setDescription('Rename the current ticket').addStringOption((o) => o.setName('name').setDescription('New channel name').setRequired(true).setMaxLength(80)))
    .addSubcommandGroup((g) =>
      g
        .setName('points')
        .setDescription('View or reset ticket support points')
        .addSubcommand((s) => s.setName('list').setDescription('View support points'))
        .addSubcommand((s) => s.setName('reset_user').setDescription('Reset a staff member’s points').addUserOption((o) => o.setName('member').setDescription('Staff member').setRequired(true))),
    )
    .addSubcommand((s) => s.setName('notify').setDescription('Notify ticket participants').addStringOption((o) => o.setName('message').setDescription('Optional notification text').setMaxLength(500))),
  ephemeral: true,
  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup(false);
    const action = interaction.options.getSubcommand();
    const saved = state.getGuild(interaction.guildId);

    if (group === 'points') {
      if (action === 'list') {
        const rows = Object.entries(saved.ticketPoints).sort((a, b) => b[1] - a[1]).slice(0, 20);
        return interaction.editReply({ content: rows.length ? rows.map(([id, points], i) => `${i + 1}. <@${id}> — ${points} point(s)`).join('\n') : 'No ticket points have been recorded yet.' });
      }
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ content: 'You need Manage Server permission to reset ticket points.' });
      }
      const member = interaction.options.getUser('member', true);
      const points = saved.ticketPoints[member.id] || 0;
      state.updateGuild(interaction.guildId, (data) => {
        delete data.ticketPoints[member.id];
        return data;
      });
      return interaction.editReply({ content: `Reset ${points} ticket point(s) for ${member}.` });
    }

    if (action === 'create') {
      const existing = Object.values(saved.tickets).find((ticket) => ticket.ownerId === interaction.user.id && ticket.open);
      if (existing) return interaction.editReply({ content: `You already have an open ticket: <#${existing.channelId}>.` });
      const category = await getTicketCategory(interaction.guild);
      const safeName = slug(interaction.user.username);
      const permissionOverwrites = [
        { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
        },
        {
          id: interaction.guild.members.me.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
        },
      ];
      for (const role of interaction.guild.roles.cache.values()) {
        if (role.permissions.has(PermissionFlagsBits.ManageChannels) || role.permissions.has(PermissionFlagsBits.Administrator)) {
          permissionOverwrites.push({
            id: role.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
          });
        }
      }
      const channel = await interaction.guild.channels.create({
        name: `ticket-${safeName}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites,
        reason: `Ticket opened by ${interaction.user.tag}`,
      });
      const ticket = {
        channelId: channel.id,
        ownerId: interaction.user.id,
        participants: [interaction.user.id],
        open: true,
        claimedBy: null,
        pointsAwarded: false,
        createdAt: Date.now(),
      };
      state.updateGuild(interaction.guildId, (data) => {
        data.tickets[channel.id] = ticket;
        return data;
      });
      const reason = interaction.options.getString('reason');
      await channel.send({ content: `${interaction.user} opened this ticket.${reason ? `\n**Reason:** ${reason}` : ''}\nStaff can use \`/ticket claim\` to take it.` });
      return interaction.editReply({ content: `Your ticket is ready: <#${channel.id}>.` });
    }

    const ticket = ticketFor(interaction);
    if (!ticket) return interaction.editReply({ content: 'This command must be used in a ticket channel.' });
    const owner = ticket.ownerId === interaction.user.id;
    if (!isStaff(interaction) && !owner && !ticket.participants.includes(interaction.user.id)) {
      return interaction.editReply({ content: 'You do not have access to this ticket.' });
    }

    if (action === 'close') {
      if (!ticket.open) return interaction.editReply({ content: 'This ticket is already closed.' });
      state.updateGuild(interaction.guildId, (data) => {
        const current = data.tickets[interaction.channelId];
        current.open = false;
        current.closedAt = Date.now();
        if (current.claimedBy && !current.pointsAwarded) {
          data.ticketPoints[current.claimedBy] = (data.ticketPoints[current.claimedBy] || 0) + 1;
          current.pointsAwarded = true;
        }
        return data;
      });
      await interaction.channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: false });
      await interaction.channel.setName(`closed-${interaction.channel.name.replace(/^closed-/, '')}`.slice(0, 100));
      return interaction.editReply({ content: 'Ticket closed. Staff can use `/ticket reopen` to reopen it.' });
    }

    if (action === 'delete') {
      if (!isStaff(interaction) && !owner) return interaction.editReply({ content: 'Only the ticket owner or staff can delete this ticket.' });
      await interaction.editReply({ content: 'Deleting this ticket channel.' });
      state.updateGuild(interaction.guildId, (data) => {
        delete data.tickets[interaction.channelId];
        return data;
      });
      return interaction.channel.delete(`Ticket deleted by ${interaction.user.tag}`);
    }

    if (action === 'reopen') {
      if (!isStaff(interaction)) return interaction.editReply({ content: 'Only ticket staff can reopen a ticket.' });
      if (ticket.open) return interaction.editReply({ content: 'This ticket is already open.' });
      state.updateGuild(interaction.guildId, (data) => {
        data.tickets[interaction.channelId].open = true;
        delete data.tickets[interaction.channelId].closedAt;
        return data;
      });
      await interaction.channel.permissionOverwrites.edit(ticket.ownerId, { SendMessages: true });
      await interaction.channel.setName(interaction.channel.name.replace(/^closed-/, '').slice(0, 100));
      return interaction.editReply({ content: 'Ticket reopened.' });
    }

    if (action === 'add_user' || action === 'remove_user') {
      if (!isStaff(interaction)) return interaction.editReply({ content: 'Only ticket staff can change ticket participants.' });
      const member = interaction.options.getUser('member', true);
      if (action === 'add_user') {
        const guildMember = await interaction.guild.members.fetch(member.id).catch(() => null);
        if (!guildMember) return interaction.editReply({ content: 'That user is not in this server.' });
        await interaction.channel.permissionOverwrites.edit(member.id, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
          AttachFiles: true,
        });
        state.updateGuild(interaction.guildId, (data) => {
          const current = data.tickets[interaction.channelId];
          if (!current.participants.includes(member.id)) current.participants.push(member.id);
          return data;
        });
        return interaction.editReply({ content: `Added ${member} to the ticket.` });
      }
      if (member.id === ticket.ownerId) return interaction.editReply({ content: 'The ticket owner cannot be removed.' });
      await interaction.channel.permissionOverwrites.delete(member.id).catch(() => {});
      state.updateGuild(interaction.guildId, (data) => {
        data.tickets[interaction.channelId].participants = data.tickets[interaction.channelId].participants.filter((id) => id !== member.id);
        return data;
      });
      return interaction.editReply({ content: `Removed ${member} from the ticket.` });
    }

    if (action === 'claim') {
      if (!isStaff(interaction)) return interaction.editReply({ content: 'Only ticket staff can claim a ticket.' });
      if (ticket.claimedBy) return interaction.editReply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.` });
      state.updateGuild(interaction.guildId, (data) => {
        data.tickets[interaction.channelId].claimedBy = interaction.user.id;
        return data;
      });
      await interaction.channel.send(`${interaction.user} claimed this ticket.`);
      return interaction.editReply({ content: 'Ticket claimed.' });
    }

    if (action === 'unclaim') {
      if (!isStaff(interaction)) return interaction.editReply({ content: 'Only ticket staff can release a ticket claim.' });
      if (ticket.claimedBy !== interaction.user.id && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.editReply({ content: 'Only the staff member who claimed this ticket or a server manager can unclaim it.' });
      }
      state.updateGuild(interaction.guildId, (data) => {
        data.tickets[interaction.channelId].claimedBy = null;
        return data;
      });
      await interaction.channel.send(`${interaction.user} released the ticket claim.`);
      return interaction.editReply({ content: 'Ticket unclaimed.' });
    }

    if (action === 'rename') {
      if (!isStaff(interaction)) return interaction.editReply({ content: 'Only ticket staff can rename a ticket.' });
      const name = slug(interaction.options.getString('name', true)).slice(0, 90);
      await interaction.channel.setName(name);
      return interaction.editReply({ content: `Ticket renamed to **${name}**.` });
    }

    if (action === 'notify') {
      if (!isStaff(interaction)) return interaction.editReply({ content: 'Only ticket staff can notify ticket participants.' });
      const participants = ticket.participants.map((id) => `<@${id}>`).join(' ');
      const message = interaction.options.getString('message');
      await interaction.channel.send({ content: `${participants}${message ? ` — ${message}` : ' — you have a ticket update.'}` });
      return interaction.editReply({ content: 'Ticket participants notified.' });
    }
  },
};
