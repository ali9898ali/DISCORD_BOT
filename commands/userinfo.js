const { SlashCommandBuilder, EmbedBuilder, time } = require('discord.js');
const config = require('../config');
const state = require('../utils/state');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('id')
    .setDescription('View your or another member’s ID and profile information')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('user').setDescription('The user to look up (default: you)')),

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    const profile = state.getUser(interaction.guildId, user.id);

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || config.embedColor)
      .setTitle(user.tag)
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Bot?', value: user.bot ? 'Yes' : 'No', inline: true },
        { name: 'Account created', value: `${time(user.createdAt, 'D')} (${time(user.createdAt, 'R')})` },
        { name: 'XP / Level', value: `${profile.xp} XP / Level ${profile.level}`, inline: true },
        { name: 'Gold / Rep', value: `${profile.gold} gold / ${profile.rep} rep`, inline: true },
      );

    if (member) {
      const roles = member.roles.cache
        .filter((r) => r.id !== interaction.guild.id)
        .map((r) => `${r}`)
        .slice(0, 20);
      embed.addFields(
        { name: 'Joined server', value: `${time(member.joinedAt, 'D')} (${time(member.joinedAt, 'R')})` },
        { name: `Roles (${roles.length})`, value: roles.join(' ') || 'None' },
      );
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
