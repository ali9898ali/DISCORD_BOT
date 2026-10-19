const { SlashCommandBuilder } = require('discord.js');
const state = require('../utils/state');
const music = require('../utils/music');

function keyFor(name) {
  return name.trim().toLowerCase();
}

function getOwnedPlaylist(interaction, name) {
  const guild = state.getGuild(interaction.guildId);
  const key = keyFor(name);
  const playlist = guild.playlists[key];
  if (!playlist || playlist.ownerId !== interaction.user.id) return null;
  return { guild, key, playlist };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('playlist')
    .setDescription('Create, edit, and play your saved playlists')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('create').setDescription('Create a playlist').addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) => s.setName('delete').setDescription('Delete one of your playlists').addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a YouTube track to one of your playlists')
        .addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('query').setDescription('YouTube URL or search terms').setRequired(true).setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a track from one of your playlists')
        .addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40))
        .addIntegerOption((o) => o.setName('position').setDescription('Track position, starting at 1').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('view').setDescription('View a playlist').addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40)))
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Rename a playlist or change its description')
        .addStringOption((o) => o.setName('name').setDescription('Current playlist name').setRequired(true).setMaxLength(40))
        .addStringOption((o) => o.setName('new_name').setDescription('New playlist name').setMaxLength(40))
        .addStringOption((o) => o.setName('description').setDescription('New description').setMaxLength(200)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List your playlists'))
    .addSubcommand((s) => s.setName('play').setDescription('Add a playlist to the music queue').addStringOption((o) => o.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(40))),
  ephemeral: true,
  async execute(interaction) {
    const action = interaction.options.getSubcommand();
    const name = interaction.options.getString('name');

    if (action === 'create') {
      const normalized = keyFor(name);
      const guild = state.getGuild(interaction.guildId);
      const owned = Object.values(guild.playlists).filter((p) => p.ownerId === interaction.user.id);
      if (owned.length >= 20) return interaction.editReply({ content: 'You can have up to 20 playlists in this server.' });
      if (guild.playlists[normalized]) return interaction.editReply({ content: 'A playlist with that name already exists in this server.' });
      state.updateGuild(interaction.guildId, (data) => {
        data.playlists[normalized] = { name: name.trim(), ownerId: interaction.user.id, description: '', tracks: [], createdAt: Date.now() };
        return data;
      });
      return interaction.editReply({ content: `Created playlist **${name.trim()}**.` });
    }

    if (action === 'list') {
      const owned = Object.values(state.getGuild(interaction.guildId).playlists).filter((p) => p.ownerId === interaction.user.id);
      if (!owned.length) return interaction.editReply({ content: 'You do not have any playlists yet. Use `/playlist create` to make one.' });
      return interaction.editReply({ content: owned.map((p) => `• **${p.name}** — ${p.tracks.length} track(s)`).join('\n') });
    }

    const owned = getOwnedPlaylist(interaction, name);
    if (!owned) return interaction.editReply({ content: 'That playlist was not found or does not belong to you.' });

    if (action === 'delete') {
      state.updateGuild(interaction.guildId, (data) => {
        delete data.playlists[owned.key];
        return data;
      });
      return interaction.editReply({ content: `Deleted playlist **${owned.playlist.name}**.` });
    }

    if (action === 'add') {
      if (owned.playlist.tracks.length >= 100) return interaction.editReply({ content: 'Playlists are limited to 100 tracks.' });
      const [track] = await music.searchTracks(interaction.options.getString('query', true), interaction.user, 1);
      if (!track) return interaction.editReply({ content: 'No YouTube tracks matched that search.' });
      state.updateGuild(interaction.guildId, (data) => {
        data.playlists[owned.key].tracks.push(track);
        return data;
      });
      return interaction.editReply({ content: `Added **${track.title}** to **${owned.playlist.name}**.` });
    }

    if (action === 'remove') {
      const position = interaction.options.getInteger('position', true);
      if (position > owned.playlist.tracks.length) return interaction.editReply({ content: 'There is no track at that position.' });
      const [removed] = owned.playlist.tracks.splice(position - 1, 1);
      state.updateGuild(interaction.guildId, (data) => {
        data.playlists[owned.key].tracks = owned.playlist.tracks;
        return data;
      });
      return interaction.editReply({ content: `Removed **${removed.title}** from **${owned.playlist.name}**.` });
    }

    if (action === 'view') {
      const playlist = owned.playlist;
      const lines = playlist.tracks.slice(0, 20).map((track, index) => `${index + 1}. [${track.title}](${track.url})`);
      const heading = `**${playlist.name}** — ${playlist.tracks.length} track(s)${playlist.description ? `\n${playlist.description}` : ''}`;
      return interaction.editReply({ content: `${heading}\n${lines.join('\n') || 'No tracks saved yet.'}${playlist.tracks.length > 20 ? `\n…and ${playlist.tracks.length - 20} more.` : ''}` });
    }

    if (action === 'edit') {
      const newName = interaction.options.getString('new_name');
      const description = interaction.options.getString('description');
      if (!newName && description === null) return interaction.editReply({ content: 'Provide a new name or description to edit this playlist.' });
      const newKey = newName ? keyFor(newName) : owned.key;
      if (newKey !== owned.key && state.getGuild(interaction.guildId).playlists[newKey]) {
        return interaction.editReply({ content: 'A playlist with that new name already exists.' });
      }
      state.updateGuild(interaction.guildId, (data) => {
        const playlist = data.playlists[owned.key];
        if (newName) playlist.name = newName.trim();
        if (description !== null) playlist.description = description;
        if (newKey !== owned.key) {
          data.playlists[newKey] = playlist;
          delete data.playlists[owned.key];
        }
        return data;
      });
      return interaction.editReply({ content: `Updated playlist **${newName || owned.playlist.name}**.` });
    }

    if (action === 'play') {
      const channel = interaction.member.voice.channel;
      if (!channel) return interaction.editReply({ content: 'Join a voice channel before playing a playlist.' });
      if (!owned.playlist.tracks.length) return interaction.editReply({ content: 'That playlist has no tracks.' });
      for (const track of owned.playlist.tracks) await music.enqueue(interaction.guild, channel, track);
      return interaction.editReply({ content: `Added **${owned.playlist.tracks.length}** track(s) from **${owned.playlist.name}** to the queue.` });
    }
  },
};
