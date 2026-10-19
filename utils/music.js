const { spawn } = require('node:child_process');
const play = require('play-dl');
const {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');
const stateStore = require('./state');

const queues = new Map();
let client;

function initialize(discordClient) {
  client = discordClient;
}

function getQueue(guildId) {
  return queues.get(guildId) || null;
}

function secondsFromRaw(raw) {
  if (typeof raw !== 'string') return 0;
  return raw.split(':').reduce((total, part) => total * 60 + Number(part || 0), 0);
}

function normalizeTrack(video, requestedBy) {
  return {
    title: video.title || 'Unknown title',
    url: video.url,
    duration: Number(video.durationInSec) || secondsFromRaw(video.durationRaw),
    durationRaw: video.durationRaw || 'Live',
    thumbnail: video.thumbnails?.[0]?.url || video.thumbnail || null,
    author: video.channel?.name || video.channel?.title || 'YouTube',
    requestedBy: requestedBy?.id || requestedBy || null,
  };
}

async function searchTracks(query, requestedBy, limit = 5) {
  const type = play.yt_validate(query);
  if (type === 'video') {
    const result = await play.video_basic_info(query);
    return [normalizeTrack(result.video_details, requestedBy)];
  }

  const results = await play.search(query, {
    limit: Math.max(1, Math.min(limit, 10)),
    source: { youtube: 'video' },
  });
  return results.map((video) => normalizeTrack(video, requestedBy));
}

function createQueue(guildId, guild) {
  const player = createAudioPlayer();
  const queue = {
    guildId,
    guild,
    player,
    connection: null,
    channelId: null,
    current: null,
    tracks: [],
    volume: 100,
    repeat: 'off',
    persistent24h: false,
    suppressIdle: false,
    seekSeconds: 0,
    ffmpeg: null,
    source: null,
  };

  player.on(AudioPlayerStatus.Idle, () => {
    if (queue.suppressIdle) {
      queue.suppressIdle = false;
      return;
    }
    if (queue.current && queue.repeat === 'track') queue.tracks.unshift(queue.current);
    else if (queue.current && queue.repeat === 'queue') queue.tracks.push(queue.current);
    queue.current = null;
    queue.seekSeconds = 0;
    playNext(queue).catch((error) => {
      console.error(`Music queue ${guildId} failed:`, error.message);
    });
  });

  player.on('error', (error) => {
    console.error(`Audio player ${guildId} error:`, error.message);
  });

  queues.set(guildId, queue);
  return queue;
}

function getOrCreateQueue(guild) {
  return queues.get(guild.id) || createQueue(guild.id, guild);
}

async function connect(guild, channel) {
  if (!channel || !channel.isVoiceBased()) throw new Error('Join a voice channel first.');
  const queue = getOrCreateQueue(guild);

  if (queue.connection && queue.channelId === channel.id && queue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    return queue;
  }

  if (queue.connection && queue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    queue.connection.destroy();
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: true,
  });
  queue.connection = connection;
  queue.channelId = channel.id;
  connection.subscribe(queue.player);

  connection.on('stateChange', (oldState, newState) => {
    if (newState.status === VoiceConnectionStatus.Disconnected && queue.persistent24h) {
      setTimeout(() => {
        if (!queue.persistent24h || !client) return;
        const target = client.channels.cache.get(queue.channelId);
        if (target?.isVoiceBased()) {
          connect(target.guild, target).catch((error) => {
            console.error(`24/7 reconnect failed for ${guild.id}:`, error.message);
          });
        }
      }, 5_000).unref();
    }
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  return queue;
}

function ffmpegArgs(seekSeconds) {
  const args = ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0'];
  if (seekSeconds > 0) args.push('-ss', String(seekSeconds));
  args.push('-vn', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1');
  return args;
}

async function playTrack(queue, track, seekSeconds = 0) {
  const source = await play.stream(track.url);
  const ffmpeg = spawn(process.env.FFMPEG_PATH || 'ffmpeg', ffmpegArgs(seekSeconds), {
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  queue.source = source.stream;
  queue.ffmpeg = ffmpeg;
  source.stream.pipe(ffmpeg.stdin);

  ffmpeg.on('error', (error) => {
    console.error('FFmpeg could not start:', error.message);
    queue.player.stop(true);
  });
  ffmpeg.on('close', () => {
    if (queue.ffmpeg === ffmpeg) queue.ffmpeg = null;
  });

  const resource = createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    inlineVolume: true,
  });
  resource.volume?.setVolume(queue.volume / 100);
  queue.player.play(resource);
}

async function seek(guildId, seconds) {
  const queue = queues.get(guildId);
  if (!queue?.current) throw new Error('Nothing is playing right now.');
  const track = queue.current;
  queue.suppressIdle = true;
  queue.source?.destroy?.();
  queue.ffmpeg?.kill('SIGKILL');
  queue.player.stop(true);
  await new Promise((resolve) => setImmediate(resolve));
  queue.suppressIdle = false;
  queue.current = track;
  queue.seekSeconds = seconds;
  await playTrack(queue, track, seconds);
}

async function playNext(queue) {
  if (!queue.tracks.length) return;
  if (!queue.connection || queue.connection.state.status === VoiceConnectionStatus.Destroyed) return;
  const next = queue.tracks.shift();
  queue.current = next;
  queue.seekSeconds = 0;
  try {
    await playTrack(queue, next);
  } catch (error) {
    queue.current = null;
    console.error(`Could not play ${next.url}:`, error.message);
    await playNext(queue);
  }
}

async function enqueue(guild, voiceChannel, track, { next = false } = {}) {
  const queue = await connect(guild, voiceChannel);
  if (next && queue.current) queue.tracks.unshift(track);
  else queue.tracks.push(track);
  if (!queue.current || queue.player.state.status === AudioPlayerStatus.Idle) {
    await playNext(queue);
  }
  return queue;
}

async function setPersistent24h(guild, channel, enabled) {
  const queue = getOrCreateQueue(guild);
  queue.persistent24h = enabled;
  stateStore.updateGuild(guild.id, (data) => {
    data.voice24hChannelId = enabled ? channel.id : null;
    return data;
  });
  if (enabled) {
    await connect(guild, channel);
  } else if (queue.connection && queue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
    queue.connection.destroy();
    queue.connection = null;
  }
  return queue;
}

async function restorePersistentConnections(discordClient) {
  client = discordClient;
  for (const [guildId, data] of Object.entries(stateStore.getAllGuilds())) {
    if (!data.voice24hChannelId) continue;
    const channel = await discordClient.channels.fetch(data.voice24hChannelId).catch(() => null);
    if (!channel?.isVoiceBased()) {
      console.warn(`Saved 24/7 voice channel is unavailable for guild ${guildId}.`);
      continue;
    }
    const queue = getOrCreateQueue(channel.guild);
    queue.persistent24h = true;
    await connect(channel.guild, channel).catch((error) => {
      console.error(`Could not reconnect to voice channel in guild ${guildId}:`, error.message);
    });
  }
}

async function handleVoiceStateUpdate(oldState, newState) {
  if (!client || newState.id !== client.user?.id) return;
  const queue = queues.get(newState.guild.id);
  if (!queue) return;
  if (!newState.channelId) {
    queue.connection = null;
    queue.channelId = null;
    if (queue.persistent24h) {
      const data = stateStore.getGuild(newState.guild.id);
      const channel = await client.channels.fetch(data.voice24hChannelId).catch(() => null);
      if (channel?.isVoiceBased()) await connect(channel.guild, channel);
    }
    return;
  }
  queue.channelId = newState.channelId;
}

function disconnect(guildId) {
  const queue = queues.get(guildId);
  if (!queue) return;
  queue.persistent24h = false;
  queue.tracks = [];
  queue.current = null;
  queue.player.stop(true);
  queue.source?.destroy?.();
  queue.ffmpeg?.kill('SIGKILL');
  queue.connection?.destroy();
  queue.connection = null;
  queue.channelId = null;
}

module.exports = {
  initialize,
  getQueue,
  searchTracks,
  enqueue,
  connect,
  getOrCreateQueue,
  setPersistent24h,
  restorePersistentConnections,
  handleVoiceStateUpdate,
  disconnect,
  playNext,
  seek,
};
