const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const state = require('../utils/state');
const { canActOnMember } = require('../utils/command-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a member text or voice mute')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('text')
        .setDescription('Restore a member’s permissions in existing text channels')
        .addUserOption((o) => o.setName('member').setDescription('Member to unmute').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('voice')
        .setDescription('Remove a saved server voice mute')
        .addUserOption((o) => o.setName('member').setDescription('Member to unmute').setRequired(true)),
    ),
  ephemeral: true,
  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const permission = action === 'text' ? PermissionFlagsBits.ManageMessages : PermissionFlagsBits.MuteMembers;
    if (!interaction.memberPermissions.has(permission)) {
      return interaction.editReply({ content: `You need the ${action === 'text' ? 'Manage Messages' : 'Mute Members'} permission to do that.` });
    }

    const user = interaction.options.getUser('member', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.editReply({ content: 'That user is not in this server.' });
    if (!canActOnMember(interaction, member)) return interaction.editReply({ content: 'You cannot change mute settings for a member with an equal or higher role.' });

    if (action === 'voice') {
      state.updateGuild(interaction.guildId, (data) => {
        data.voiceMuteIds = data.voiceMuteIds.filter((id) => id !== user.id);
        return data;
      });
      if (member.voice.channel) await member.voice.setMute(false, `Voice-unmuted by ${interaction.user.tag}`);
      return interaction.editReply({ content: `Removed the saved voice mute for **${member.displayName}**.` });
    }

    let cleared = 0;
    const channels = interaction.guild.channels.cache.filter(
      (channel) => channel.isTextBased() && channel.guild && !channel.isThread?.() && channel.permissionOverwrites,
    );
    for (const channel of channels.values()) {
      const overwrite = channel.permissionOverwrites.cache.get(member.id);
      if (!overwrite) continue;
      if (
        overwrite.deny.has(PermissionFlagsBits.SendMessages) ||
        overwrite.deny.has(PermissionFlagsBits.AddReactions) ||
        overwrite.deny.has(PermissionFlagsBits.SendMessagesInThreads)
      ) {
        await channel.permissionOverwrites
          .edit(
            member,
            {
              SendMessages: null,
              AddReactions: null,
              SendMessagesInThreads: null,
              CreatePublicThreads: null,
              CreatePrivateThreads: null,
            },
            { reason: `Text-unmuted by ${interaction.user.tag}` },
          )
          .then(() => cleared++)
          .catch(() => {});
      }
    }
    await interaction.editReply({ content: `Removed text-mute permissions for **${member.displayName}** in ${cleared} channel(s).` });
  },
};
