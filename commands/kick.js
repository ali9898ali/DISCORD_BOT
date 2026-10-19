const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member from the server')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick')),

  ephemeral: true,
  async execute(interaction) {
    const user = interaction.options.getUser('user');
    const reason = interaction.options.getString('reason') ?? 'No reason provided';
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) return interaction.editReply({ content: '❌ That user is not in this server.' });
    if (user.id === interaction.user.id) return interaction.editReply({ content: "❌ You can't kick yourself." });
    if (!member.kickable) return interaction.editReply({ content: "❌ I can't kick that member (their role is higher than or equal to mine)." });
    if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.editReply({ content: '❌ You can only kick members with a lower role than yours.' });
    }

    await member.kick(`${reason} (by ${interaction.user.tag})`);
    await interaction.editReply(`👢 **${user.tag}** was kicked. Reason: ${reason}`);
  },
};
