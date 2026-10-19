const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const state = require('./state');

const BUTTON_PREFIX = 'giveaway:enter:';
let schedulerStarted = false;

function entryButton(guildId, messageId, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${guildId}:${messageId}`)
      .setLabel('Enter giveaway')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled),
  );
}

function chooseWinners(entrants, count, excluded = []) {
  const candidates = entrants.filter((id) => !excluded.includes(id));
  const winners = [];
  while (candidates.length && winners.length < count) {
    const index = Math.floor(Math.random() * candidates.length);
    winners.push(candidates.splice(index, 1)[0]);
  }
  return winners;
}

async function finishGiveaway(client, guildId, messageId, { force = false } = {}) {
  const current = state.getGuild(guildId).giveaways[messageId];
  if (!current || current.status !== 'active' || (!force && current.endsAt > Date.now())) return null;
  const winners = chooseWinners(current.entrants, current.winnerCount);
  state.updateGuild(guildId, (data) => {
    const giveaway = data.giveaways[messageId];
    if (!giveaway || giveaway.status !== 'active') return data;
    giveaway.status = 'ended';
    giveaway.winners = winners;
    giveaway.endedAt = Date.now();
    return data;
  });

  const channel = await client.channels.fetch(current.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(messageId).catch(() => null) : null;
  if (message) {
    const winnerText = winners.length ? winners.map((id) => `<@${id}>`).join(', ') : 'No eligible entries';
    await message
      .edit({
        content: `Giveaway ended — **${current.prize}**\nWinner(s): ${winnerText}`,
        components: [entryButton(guildId, messageId, true)],
      })
      .catch(() => {});
  }
  return winners;
}

function startScheduler(client) {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const tick = async () => {
    const now = Date.now();
    for (const [guildId, guildData] of Object.entries(state.getAllGuilds())) {
      for (const [messageId, giveaway] of Object.entries(guildData.giveaways || {})) {
        if (giveaway.status === 'active' && giveaway.endsAt <= now) {
          await finishGiveaway(client, guildId, messageId).catch((error) => {
            console.error(`Could not finish giveaway ${messageId}:`, error.message);
          });
        }
      }
    }
  };
  setInterval(() => tick().catch((error) => console.error('Giveaway scheduler failed:', error.message)), 15_000).unref();
}

async function handleButton(interaction) {
  const suffix = interaction.customId.slice(BUTTON_PREFIX.length);
  const [guildId, messageId] = suffix.split(':');
  if (guildId !== interaction.guildId) return interaction.reply({ content: 'This giveaway is not from this server.', ephemeral: true });
  const giveaway = state.getGuild(guildId).giveaways[messageId];
  if (!giveaway || giveaway.status !== 'active' || giveaway.endsAt <= Date.now()) {
    return interaction.reply({ content: 'This giveaway has ended.', ephemeral: true });
  }
  let joined;
  state.updateGuild(guildId, (data) => {
    const current = data.giveaways[messageId];
    if (!current || current.status !== 'active') return data;
    const index = current.entrants.indexOf(interaction.user.id);
    if (index >= 0) {
      current.entrants.splice(index, 1);
      joined = false;
    } else {
      current.entrants.push(interaction.user.id);
      joined = true;
    }
    return data;
  });
  await interaction.reply({
    content: joined ? 'You entered the giveaway.' : 'You left the giveaway.',
    ephemeral: true,
  });
}

module.exports = { BUTTON_PREFIX, entryButton, finishGiveaway, startScheduler, handleButton, chooseWinners };
