const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const music = require('../utils/music');

const voiceChannel = (option) =>
  option
    .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
    .setDescription('Voice channel');

function voiceChannelFor(interaction) {
  return interaction.member.voice.channel;
}

function currentQueue(interaction) {
  return music.getQueue(interaction.guildId);
}

function requireQueue(interaction) {
  const queue = currentQueue(interaction);
  if (!queue) {
    interaction.editReply({ content: 'There is no active music player in this server.' });
    return null;
  }
  return queue;
}

function trackLine(track, index) {
  const duration = track.durationRaw || 'Live';
  return `${index}. [${track.title}](${track.url}) — ${duration}`;
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('play')
      .setDescription('Play a YouTube track or add it to the queue')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('query').setDescription('YouTube URL or search terms').setRequired(true).setMaxLength(300)),
    async execute(interaction) {
      const channel = voiceChannelFor(interaction);
      if (!channel) return interaction.editReply({ content: 'Join a voice channel before using music commands.' });
      const [track] = await music.searchTracks(interaction.options.getString('query', true), interaction.user, 1);
      if (!track) return interaction.editReply({ content: 'No YouTube tracks matched that search.' });
      await music.enqueue(interaction.guild, channel, track);
      await interaction.editReply({ content: `Added **${track.title}** to the queue. Requested by ${interaction.user}.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('playnext')
      .setDescription('Add a YouTube track to play next')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('query').setDescription('YouTube URL or search terms').setRequired(true).setMaxLength(300)),
    async execute(interaction) {
      const channel = voiceChannelFor(interaction);
      if (!channel) return interaction.editReply({ content: 'Join a voice channel before using music commands.' });
      const [track] = await music.searchTracks(interaction.options.getString('query', true), interaction.user, 1);
      if (!track) return interaction.editReply({ content: 'No YouTube tracks matched that search.' });
      await music.enqueue(interaction.guild, channel, track, { next: true });
      await interaction.editReply({ content: `**${track.title}** will play next.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('search')
      .setDescription('Search YouTube and add a result to the music queue')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('query').setDescription('Track, artist, or YouTube URL').setRequired(true).setMaxLength(300))
      .addIntegerOption((o) => o.setName('result').setDescription('Which search result to add (1–5)').setMinValue(1).setMaxValue(5)),
    async execute(interaction) {
      const channel = voiceChannelFor(interaction);
      if (!channel) return interaction.editReply({ content: 'Join a voice channel before using music commands.' });
      const results = await music.searchTracks(interaction.options.getString('query', true), interaction.user, 5);
      if (!results.length) return interaction.editReply({ content: 'No YouTube tracks matched that search.' });
      const index = (interaction.options.getInteger('result') ?? 1) - 1;
      if (index >= results.length) return interaction.editReply({ content: `That search returned only ${results.length} result(s).` });
      const track = results[index];
      await music.enqueue(interaction.guild, channel, track);
      await interaction.editReply({
        content: `Added result ${index + 1}: **${track.title}**\n\n${results.map((item, i) => trackLine(item, i + 1)).join('\n')}`,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('volume')
      .setDescription('Show or change music volume (1–100)')
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('level').setDescription('Volume percentage').setMinValue(1).setMaxValue(100)),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      const level = interaction.options.getInteger('level');
      if (level === null) return interaction.editReply({ content: `Current volume: **${queue.volume}%**.` });
      queue.volume = level;
      queue.player.state.resource?.volume?.setVolume(level / 100);
      await interaction.editReply({ content: `Volume set to **${level}%**.` });
    },
  },
  {
    data: new SlashCommandBuilder().setName('join').setDescription('Join your voice channel').setDMPermission(false),
    async execute(interaction) {
      const channel = voiceChannelFor(interaction);
      if (!channel) return interaction.editReply({ content: 'Join a voice channel first.' });
      await music.connect(interaction.guild, channel);
      await interaction.editReply({ content: `Joined **${channel.name}**.` });
    },
  },
  {
    data: new SlashCommandBuilder().setName('leave').setDescription('Leave the voice channel and clear music').setDMPermission(false),
    async execute(interaction) {
      music.disconnect(interaction.guildId);
      const { updateGuild } = require('../utils/state');
      updateGuild(interaction.guildId, (data) => {
        data.voice24hChannelId = null;
        return data;
      });
      await interaction.editReply({ content: 'Left the voice channel and cleared the queue.' });
    },
  },
  {
    data: new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track').setDMPermission(false),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      if (!queue.current) return interaction.editReply({ content: 'Nothing is playing right now.' });
      const track = queue.current;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(track.title)
        .setURL(track.url)
        .addFields(
          { name: 'Duration', value: track.durationRaw || 'Live', inline: true },
          { name: 'Requested by', value: track.requestedBy ? `<@${track.requestedBy}>` : 'Unknown', inline: true },
        );
      if (track.thumbnail) embed.setThumbnail(track.thumbnail);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause the current track').setDMPermission(false),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      if (!queue.current || !queue.player.pause()) return interaction.editReply({ content: 'Nothing is playing or it is already paused.' });
      await interaction.editReply({ content: 'Playback paused.' });
    },
  },
  {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume the paused track').setDMPermission(false),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      if (!queue.current || !queue.player.unpause()) return interaction.editReply({ content: 'There is no paused track to resume.' });
      await interaction.editReply({ content: 'Playback resumed.' });
    },
  },
  {
    data: new SlashCommandBuilder().setName('skip').setDescription('Skip the current track').setDMPermission(false),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      if (!queue.current) return interaction.editReply({ content: 'Nothing is playing right now.' });
      const title = queue.current.title;
      queue.player.stop(true);
      await interaction.editReply({ content: `Skipped **${title}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('skipto')
      .setDescription('Skip to a track in the upcoming queue')
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('position').setDescription('Upcoming queue position (starts at 1)').setRequired(true).setMinValue(1)),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      const position = interaction.options.getInteger('position', true);
      if (position > queue.tracks.length) return interaction.editReply({ content: `The queue has only ${queue.tracks.length} upcoming track(s).` });
      queue.repeat = 'off';
      queue.tracks = queue.tracks.slice(position - 1);
      if (queue.current) queue.player.stop(true);
      else await music.playNext(queue);
      await interaction.editReply({ content: `Skipping to upcoming track **${position}**.` });
    },
  },
  {
    data: new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue').setDMPermission(false),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      queue.tracks = [];
      queue.current = null;
      queue.repeat = 'off';
      queue.suppressIdle = true;
      queue.source?.destroy?.();
      queue.ffmpeg?.kill('SIGKILL');
      queue.player.stop(true);
      setImmediate(() => {
        queue.suppressIdle = false;
      });
      await interaction.editReply({ content: 'Playback stopped and the queue was cleared.' });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('repeat')
      .setDescription('Set repeat mode for the current track or queue')
      .setDMPermission(false)
      .addStringOption((o) =>
        o
          .setName('mode')
          .setDescription('Repeat mode')
          .setRequired(true)
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Current track', value: 'track' },
            { name: 'Queue', value: 'queue' },
          ),
      ),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      queue.repeat = interaction.options.getString('mode', true);
      await interaction.editReply({ content: `Repeat mode set to **${queue.repeat}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Jump to a position in the current track')
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('seconds').setDescription('Position in seconds').setRequired(true).setMinValue(0)),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      const seconds = interaction.options.getInteger('seconds', true);
      if (!queue.current) return interaction.editReply({ content: 'Nothing is playing right now.' });
      if (queue.current.duration && seconds >= queue.current.duration) {
        return interaction.editReply({ content: 'That position is beyond the end of the track.' });
      }
      await music.seek(interaction.guildId, seconds);
      await interaction.editReply({ content: `Jumped to **${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}**.` });
    },
  },
  {
    data: new SlashCommandBuilder().setName('queue').setDescription('Show the current track and upcoming queue').setDMPermission(false),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      const lines = [];
      if (queue.current) lines.push(`**Now playing:** ${trackLine(queue.current, 1)}`);
      if (queue.tracks.length) {
        lines.push('', '**Up next:**', ...queue.tracks.slice(0, 15).map((track, i) => trackLine(track, i + 1)));
      }
      if (!lines.length) lines.push('The queue is empty.');
      if (queue.tracks.length > 15) lines.push(`…and ${queue.tracks.length - 15} more.`);
      await interaction.editReply({ content: lines.join('\n').slice(0, 1900) });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('remove')
      .setDescription('Remove a track from the upcoming queue')
      .setDMPermission(false)
      .addIntegerOption((o) => o.setName('position').setDescription('Upcoming queue position (starts at 1)').setRequired(true).setMinValue(1)),
    async execute(interaction) {
      const queue = requireQueue(interaction);
      if (!queue) return;
      const position = interaction.options.getInteger('position', true);
      if (position > queue.tracks.length) return interaction.editReply({ content: `The queue has only ${queue.tracks.length} upcoming track(s).` });
      const [removed] = queue.tracks.splice(position - 1, 1);
      await interaction.editReply({ content: `Removed **${removed.title}** from the queue.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('24h')
      .setDescription('Keep the bot in your current voice channel until disabled')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false)
      .addBooleanOption((o) => o.setName('enabled').setDescription('Enable or disable 24/7 presence').setRequired(true)),
    async execute(interaction) {
      const enabled = interaction.options.getBoolean('enabled', true);
      const channel = voiceChannelFor(interaction);
      if (enabled && !channel) return interaction.editReply({ content: 'Join a voice channel before enabling 24/7 presence.' });
      if (enabled) {
        await music.setPersistent24h(interaction.guild, channel, true);
        await interaction.editReply({ content: `24/7 presence enabled in **${channel.name}**. The bot process must remain online for this to work.` });
      } else {
        await music.setPersistent24h(interaction.guild, channel, false);
        await interaction.editReply({ content: '24/7 presence disabled.' });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('move')
      .setDescription('Move a member to another voice channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to move').setRequired(true))
      .addChannelOption((o) => voiceChannel(o.setName('channel').setRequired(true))),
    ephemeral: true,
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      const channel = interaction.options.getChannel('channel', true);
      if (!member?.voice.channel) return interaction.editReply({ content: 'That member is not in a voice channel.' });
      if (!member.voice.channelId) return interaction.editReply({ content: 'That member is not connected to voice.' });
      await member.voice.setChannel(channel, `Moved by ${interaction.user.tag}`);
      await interaction.editReply({ content: `Moved **${member.displayName}** to **${channel.name}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('moveme')
      .setDescription('Move yourself to another voice channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
      .setDMPermission(false)
      .addChannelOption((o) => voiceChannel(o.setName('channel').setRequired(true))),
    ephemeral: true,
    async execute(interaction) {
      if (!interaction.member.voice.channel) return interaction.editReply({ content: 'Join a voice channel before using this command.' });
      const channel = interaction.options.getChannel('channel', true);
      await interaction.member.voice.setChannel(channel, 'Member requested a voice channel move');
      await interaction.editReply({ content: `Moved you to **${channel.name}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('vkick')
      .setDescription('Disconnect a member from voice')
      .setDefaultMemberPermissions(PermissionFlagsBits.MoveMembers)
      .setDMPermission(false)
      .addUserOption((o) => o.setName('member').setDescription('Member to disconnect').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for disconnect').setMaxLength(300)),
    ephemeral: true,
    async execute(interaction) {
      const member = await interaction.guild.members.fetch(interaction.options.getUser('member', true).id).catch(() => null);
      if (!member?.voice.channel) return interaction.editReply({ content: 'That member is not in a voice channel.' });
      if (member.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) {
        return interaction.editReply({ content: 'You can only disconnect members with a lower role than yours.' });
      }
      await member.voice.disconnect(interaction.options.getString('reason') || `Disconnected by ${interaction.user.tag}`);
      await interaction.editReply({ content: `Disconnected **${member.displayName}** from voice.` });
    },
  },
];
