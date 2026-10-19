const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const state = require('../utils/state');
const { entryButton, finishGiveaway, chooseWinners } = require('../utils/giveaways');

async function getMessage(interaction, messageId) {
  const channel = interaction.channel;
  if (!channel?.messages) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Start and manage server giveaways')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a giveaway in this channel')
        .addStringOption((o) => o.setName('prize').setDescription('Giveaway prize').setRequired(true).setMaxLength(200))
        .addIntegerOption((o) => o.setName('duration_minutes').setDescription('Duration in minutes (1–10080)').setRequired(true).setMinValue(1).setMaxValue(10080))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners (1–10)').setMinValue(1).setMaxValue(10)),
    )
    .addSubcommand((s) => s.setName('reroll').setDescription('Pick a new winner for a completed giveaway').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID in this channel').setRequired(true).setMinLength(17).setMaxLength(20)))
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway early and choose winners').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID in this channel').setRequired(true).setMinLength(17).setMaxLength(20)))
    .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway and delete its message').addStringOption((o) => o.setName('message_id').setDescription('Giveaway message ID in this channel').setRequired(true).setMinLength(17).setMaxLength(20))),
  ephemeral: true,
  async execute(interaction) {
    const action = interaction.options.getSubcommand();

    if (action === 'start') {
      const prize = interaction.options.getString('prize', true);
      const duration = interaction.options.getInteger('duration_minutes', true);
      const winnerCount = interaction.options.getInteger('winners') || 1;
      const endsAt = Date.now() + duration * 60_000;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Giveaway: ${prize}`)
        .setDescription(`Click the button below to enter.\nEnds <t:${Math.floor(endsAt / 1000)}:R>.`)
        .addFields({ name: 'Winners', value: String(winnerCount), inline: true })
        .setTimestamp(endsAt);
      const message = await interaction.channel.send({ embeds: [embed] });
      await message.edit({ components: [entryButton(interaction.guildId, message.id)] });
      state.updateGuild(interaction.guildId, (data) => {
        data.giveaways[message.id] = {
          messageId: message.id,
          channelId: interaction.channelId,
          prize,
          winnerCount,
          endsAt,
          entrants: [],
          winners: [],
          status: 'active',
          createdBy: interaction.user.id,
        };
        return data;
      });
      return interaction.editReply({ content: `Giveaway started: ${message.url}` });
    }

    const messageId = interaction.options.getString('message_id', true);
    const giveaway = state.getGuild(interaction.guildId).giveaways[messageId];
    if (!giveaway || giveaway.channelId !== interaction.channelId) {
      return interaction.editReply({ content: 'No giveaway with that message ID was found in this channel.' });
    }

    if (action === 'end') {
      if (giveaway.status !== 'active') return interaction.editReply({ content: 'That giveaway is not active.' });
      const winners = await finishGiveaway(interaction.client, interaction.guildId, messageId, { force: true });
      return interaction.editReply({ content: winners?.length ? `Giveaway ended. Winner(s): ${winners.map((id) => `<@${id}>`).join(', ')}` : 'Giveaway ended with no eligible entries.' });
    }

    if (action === 'cancel') {
      const message = await getMessage(interaction, messageId);
      if (message) await message.delete().catch(() => {});
      state.updateGuild(interaction.guildId, (data) => {
        data.giveaways[messageId].status = 'cancelled';
        data.giveaways[messageId].endedAt = Date.now();
        return data;
      });
      return interaction.editReply({ content: 'Giveaway cancelled and its message deleted.' });
    }

    if (giveaway.status !== 'ended') return interaction.editReply({ content: 'End the giveaway before rerolling a winner.' });
    const winners = chooseWinners(giveaway.entrants, 1, giveaway.winners || []);
    if (!winners.length) return interaction.editReply({ content: 'There are no eligible entrants left to reroll.' });
    state.updateGuild(interaction.guildId, (data) => {
      data.giveaways[messageId].winners.push(...winners);
      return data;
    });
    const message = await getMessage(interaction, messageId);
    if (message) {
      const allWinners = [...(giveaway.winners || []), ...winners];
      await message.edit({ content: `Giveaway ended — **${giveaway.prize}**\nWinner(s): ${allWinners.map((id) => `<@${id}>`).join(', ')}` }).catch(() => {});
    }
    await interaction.editReply({ content: `New winner: ${winners.map((id) => `<@${id}>`).join(', ')}` });
  },
};
