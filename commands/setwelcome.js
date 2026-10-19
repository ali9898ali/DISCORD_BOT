const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const settings = require('../utils/settings');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('Customize the welcome message for new members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('Channel for welcome messages').addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription('Greeting. Placeholders: {user} {username} {server} {count}').setMaxLength(1000),
    )
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn welcome messages on or off')),

  ephemeral: true,
  async execute(interaction) {
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    const enabled = interaction.options.getBoolean('enabled');

    const patch = {};
    if (channel) patch.welcomeChannelId = channel.id;
    if (message) patch.welcomeMessage = message;
    if (enabled !== null) patch.welcomeEnabled = enabled;

    if (Object.keys(patch).length === 0) {
      const s = settings.get(interaction.guildId);
      return interaction.editReply({
        content:
          `**Current welcome settings**\nEnabled: ${s.welcomeEnabled}\n` +
          `Channel: ${s.welcomeChannelId ? `<#${s.welcomeChannelId}>` : 'server system channel'}\n` +
          `Message: ${s.welcomeMessage}\n\nPlaceholders: \`{user}\` \`{username}\` \`{server}\` \`{count}\``,
      });
    }

    settings.set(interaction.guildId, patch);
    await interaction.editReply({ content: '✅ Welcome settings updated. Run `/setwelcome` with no options to view them.' });
  },
};
