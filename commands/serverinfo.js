const { SlashCommandBuilder, EmbedBuilder, ChannelType, time } = require('discord.js');
const config = require('../config');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Show information about this server')
    .setDMPermission(false),

  async execute(interaction) {
    const { guild } = interaction;
    const owner = await guild.fetchOwner();
    const channels = guild.channels.cache;

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'Owner', value: `${owner.user.tag}`, inline: true },
        { name: 'Members', value: `${guild.memberCount}`, inline: true },
        { name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Text channels', value: `${channels.filter((c) => c.type === ChannelType.GuildText).size}`, inline: true },
        { name: 'Voice channels', value: `${channels.filter((c) => c.type === ChannelType.GuildVoice).size}`, inline: true },
        { name: 'Boosts', value: `${guild.premiumSubscriptionCount ?? 0} (Tier ${guild.premiumTier})`, inline: true },
        { name: 'Created', value: `${time(guild.createdAt, 'D')} (${time(guild.createdAt, 'R')})` },
      )
      .setFooter({ text: `Server ID: ${guild.id}` });

    await interaction.editReply({ embeds: [embed] });
  },
};
