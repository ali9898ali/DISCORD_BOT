const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const state = require('../utils/state');
const { canActOnMember } = require('../utils/command-utils');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Mute a member in text or voice channels')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('text')
        .setDescription('Prevent a member from sending messages in existing text channels')
        .addUserOption((o) => o.setName('member').setDescription('Member to mute').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('voice')
        .setDescription('Server-mute a member in voice, including when they join')
        .addUserOption((o) => o.setName('member').setDescription('Member to mute').setRequired(true)),
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
    if (user.id === interaction.user.id) return interaction.editReply({ content: "You can't mute yourself." });
    if (!canActOnMember(interaction, member)) return interaction.editReply({ content: 'You can only mute members with a lower role than yours.' });

    if (action === 'voice') {
      state.updateGuild(interaction.guildId, (data) => {
        if (!data.voiceMuteIds.includes(user.id)) data.voiceMuteIds.push(user.id);
        return data;
      });
      if (member.voice.channel) await member.voice.setMute(true, `Voice-muted by ${interaction.user.tag}`);
      return interaction.editReply({
        content: member.voice.channel
          ? `**${member.displayName}** is now server-muted in voice.`
          : `Saved a voice mute for **${member.displayName}**; it will apply when they join a voice channel.`,
      });
    }

    const channels = interaction.guild.channels.cache.filter(
      (channel) => channel.isTextBased() && channel.guild && !channel.isThread?.() && channel.permissionOverwrites,
    );
    let applied = 0;
    for (const channel of channels.values()) {
      await channel.permissionOverwrites
        .edit(
          member,
          {
            SendMessages: false,
            AddReactions: false,
            SendMessagesInThreads: false,
            CreatePublicThreads: false,
            CreatePrivateThreads: false,
          },
          { reason: `Text-muted by ${interaction.user.tag}` },
        )
        .then(() => applied++)
        .catch(() => {});
    }
    await interaction.editReply({ content: `Text-muted **${member.displayName}** in ${applied} existing channel(s).` });
  },
};
