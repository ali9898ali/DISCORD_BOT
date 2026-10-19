const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Show the bot and Discord gateway latency'),
  immediate: true,
  async execute(interaction) {
    const started = Date.now();
    await interaction.reply('Pong!');
    const roundTrip = Date.now() - started;
    await interaction.editReply(`Pong! Response: **${roundTrip} ms** · Discord gateway: **${interaction.client.ws.ping} ms**.`);
  },
};
