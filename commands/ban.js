const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const state = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a user from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('User to ban').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban'))
    .addIntegerOption((o) =>
      o.setName('delete_days').setDescription('Delete their messages from the last X days (0-7)').setMinValue(0).setMaxValue(7),
    )
    .addIntegerOption((o) =>
      o.setName('duration_hours').setDescription('Optional temporary ban duration in hours (1–8760)').setMinValue(1).setMaxValue(8760),
    ),

  ephemeral: true,
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const deleteDays = interaction.options.getInteger('delete_days') ?? 0;
    const durationHours = interaction.options.getInteger('duration_hours');
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (user.id === interaction.user.id) return interaction.editReply({ content: "❌ You can't ban yourself." });

    if (member) {
      if (!member.bannable) return interaction.editReply({ content: "❌ I can't ban that member (their role is higher than or equal to mine)." });
      if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
        return interaction.editReply({ content: '❌ You can only ban members with a lower role than yours.' });
      }
    }

    await interaction.guild.members.ban(user, {
      reason: `${reason} (by ${interaction.user.tag})`,
      deleteMessageSeconds: deleteDays * 86400,
    });
    if (durationHours) {
      state.updateGuild(interaction.guildId, (data) => {
        data.tempBans[user.id] = { unbanAt: Date.now() + durationHours * 60 * 60 * 1000, reason };
        return data;
      });
    }
    await interaction.editReply({
      content: `🔨 **${user.tag}** was banned${durationHours ? ` for ${durationHours} hour(s)` : ''}. Reason: ${reason}`,
    });
  },
};
