const {
  AttachmentBuilder,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

function imageName(value) {
  const cleaned = String(value || '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);
  return cleaned || `image_${Date.now().toString(36)}`;
}

function emojiSource(value) {
  const match = value?.match(/^<?(a?):([A-Za-z0-9_]{2,32}):(\d{17,20})>?$/);
  if (match) {
    return {
      name: match[2],
      url: `https://cdn.discordapp.com/emojis/${match[3]}.${match[1] ? 'gif' : 'png'}?size=256&quality=lossless`,
    };
  }
  return { name: null, url: value };
}

module.exports = [
  {
    data: new SlashCommandBuilder()
      .setName('addemojis')
      .setDescription('Add a custom emoji from another server or an image')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('source').setDescription('Custom emoji mention or HTTPS image URL').setMaxLength(500))
      .addAttachmentOption((o) => o.setName('image').setDescription('Image attachment to add'))
      .addStringOption((o) => o.setName('name').setDescription('Emoji name (optional for a custom emoji mention)').setMaxLength(32)),
    ephemeral: true,
    async execute(interaction) {
      const attachment = interaction.options.getAttachment('image');
      const sourceValue = interaction.options.getString('source');
      if (Boolean(attachment) === Boolean(sourceValue)) {
        return interaction.editReply({ content: 'Provide either an emoji mention/image URL or an image attachment.' });
      }
      const parsed = emojiSource(sourceValue);
      const url = attachment?.url || parsed.url;
      if (!url?.startsWith('https://')) return interaction.editReply({ content: 'Use a secure HTTPS image URL.' });
      const name = imageName(interaction.options.getString('name') || parsed.name || attachment?.name);
      const emoji = await interaction.guild.emojis.create({ attachment: url, name, reason: `Added by ${interaction.user.tag}` });
      await interaction.editReply({ content: `Added ${emoji} as \`:${emoji.name}:\`.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('addstickers')
      .setDescription('Add a sticker from an image or sticker URL')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
      .setDMPermission(false)
      .addStringOption((o) => o.setName('name').setDescription('Sticker name').setRequired(true).setMinLength(2).setMaxLength(30))
      .addStringOption((o) => o.setName('description').setDescription('Sticker description').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('tags').setDescription('Emoji tag (for example: 🙂)').setRequired(true).setMaxLength(20))
      .addStringOption((o) => o.setName('source').setDescription('HTTPS sticker/image URL').setMaxLength(500))
      .addAttachmentOption((o) => o.setName('image').setDescription('Image attachment to add')),
    ephemeral: true,
    async execute(interaction) {
      const attachment = interaction.options.getAttachment('image');
      const source = interaction.options.getString('source');
      if (Boolean(attachment) === Boolean(source)) return interaction.editReply({ content: 'Provide either an HTTPS source URL or an image attachment.' });
      const url = attachment?.url || source;
      if (!url.startsWith('https://')) return interaction.editReply({ content: 'Use a secure HTTPS image URL.' });
      const sticker = await interaction.guild.stickers.create({
        file: url,
        name: interaction.options.getString('name', true),
        description: interaction.options.getString('description', true),
        tags: interaction.options.getString('tags', true),
        reason: `Added by ${interaction.user.tag}`,
      });
      await interaction.editReply({ content: `Added sticker **${sticker.name}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('vote')
      .setDescription('Open the bot’s voting page and check voting availability'),
      // The user can check their vote window on the linked listing page.
    async execute(interaction) {
      const botId = interaction.client.user.id;
      const url = `https://top.gg/bot/${botId}/vote`;
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Vote for this bot')
        .setDescription(`Open [the Top.gg voting page](${url}) to check whether your account can vote and when voting is available again.`);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('debug')
      .setDescription('Show bot runtime information for this server')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .setDMPermission(false),
    async execute(interaction) {
      const memory = process.memoryUsage();
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Bot debug — ${interaction.guild.name}`)
        .addFields(
          { name: 'Bot', value: `${interaction.client.user.tag} (${interaction.client.user.id})` },
          { name: 'WebSocket ping', value: `${interaction.client.ws.ping} ms`, inline: true },
          { name: 'Uptime', value: `${Math.floor(process.uptime() / 3600)}h ${Math.floor((process.uptime() % 3600) / 60)}m`, inline: true },
          { name: 'Guild members', value: `${interaction.guild.memberCount}`, inline: true },
          { name: 'Loaded commands', value: `${interaction.client.commands.size}`, inline: true },
          { name: 'Memory', value: `${Math.round(memory.rss / 1024 / 1024)} MB RSS`, inline: true },
        )
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription('Show a member’s or this server’s avatar')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member (default: you)'))
      .addBooleanOption((o) => o.setName('server').setDescription('Show this server’s icon instead')),
    async execute(interaction) {
      const showServer = interaction.options.getBoolean('server') ?? false;
      const user = interaction.options.getUser('user') || interaction.user;
      const url = showServer ? interaction.guild.iconURL({ size: 1024, extension: 'png' }) : user.displayAvatarURL({ size: 1024, extension: 'png' });
      if (!url) return interaction.editReply({ content: showServer ? 'This server has no icon.' : 'That user has no avatar.' });
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(showServer ? `${interaction.guild.name} avatar` : `${user.username}’s avatar`)
        .setImage(url)
        .setURL(url);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('banner')
      .setDescription('Show a member’s or this server’s banner')
      .setDMPermission(false)
      .addUserOption((o) => o.setName('user').setDescription('Member (default: you)'))
      .addBooleanOption((o) => o.setName('server').setDescription('Show this server’s banner instead')),
    async execute(interaction) {
      const showServer = interaction.options.getBoolean('server') ?? false;
      const user = interaction.options.getUser('user') || interaction.user;
      const url = showServer
        ? interaction.guild.bannerURL({ size: 1024, extension: 'png' })
        : (await user.fetch()).bannerURL({ size: 1024, extension: 'png' });
      if (!url) return interaction.editReply({ content: showServer ? 'This server has no banner.' : 'That user has no public banner.' });
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(showServer ? `${interaction.guild.name} banner` : `${user.username}’s banner`)
        .setImage(url)
        .setURL(url);
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('colors').setDescription('List colored roles in this server').setDMPermission(false),
    async execute(interaction) {
      const roles = interaction.guild.roles.cache
        .filter((role) => role.id !== interaction.guild.id && role.hexColor !== '#000000')
        .sort((a, b) => b.position - a.position)
        .first(25);
      const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`Server colors — ${interaction.guild.name}`);
      embed.setDescription(roles.length ? roles.map((role) => `• ${role} — \`${role.hexColor}\``).join('\n') : 'No colored roles were found.');
      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('color')
      .setDescription('Set or remove your personal color role')
      .setDMPermission(false)
      .addStringOption((o) => o.setName('hex').setDescription('Hex color such as #5865F2').setMaxLength(7))
      .addBooleanOption((o) => o.setName('clear').setDescription('Remove your personal color role')),
    ephemeral: true,
    async execute(interaction) {
      if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return interaction.editReply({ content: 'The bot needs Manage Roles permission to set a personal color.' });
      }
      const clear = interaction.options.getBoolean('clear') ?? false;
      const hex = interaction.options.getString('hex');
      const roleName = `Color-${interaction.user.id}`;
      let role = interaction.guild.roles.cache.find((item) => item.name === roleName);
      if (clear) {
        if (!role || !interaction.member.roles.cache.has(role.id)) return interaction.editReply({ content: 'You do not have a personal color role.' });
        await interaction.member.roles.remove(role);
        await role.delete('Personal color cleared');
        return interaction.editReply({ content: 'Removed your personal color role.' });
      }
      const match = hex?.match(/^#?([0-9a-fA-F]{6})$/);
      if (!match) return interaction.editReply({ content: 'Provide a six-digit hex color, or set `clear` to true.' });
      const color = Number.parseInt(match[1], 16);
      if (!role) {
        role = await interaction.guild.roles.create({ name: roleName, color, permissions: [], reason: `Personal color for ${interaction.user.tag}` });
      } else {
        await role.setColor(color);
      }
      await role.setPosition(Math.min(interaction.member.roles.highest.position + 1, interaction.guild.members.me.roles.highest.position - 1));
      await interaction.member.roles.add(role, 'Personal color selected');
      await interaction.editReply({ content: `Your personal color is now **#${match[1].toUpperCase()}**.` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('create_invite')
      .setDescription('Create a server invite link')
      .setDMPermission(false)
      .addChannelOption((o) =>
        o.setName('channel').setDescription('Invite destination (defaults to this channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildAnnouncement),
      )
      .addIntegerOption((o) => o.setName('max_uses').setDescription('Maximum uses (0 means unlimited)').setMinValue(0).setMaxValue(100))
      .addIntegerOption((o) => o.setName('max_age_hours').setDescription('Expiry in hours (0 means never)').setMinValue(0).setMaxValue(168)),
    ephemeral: true,
    async execute(interaction) {
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      const maxUses = interaction.options.getInteger('max_uses') ?? 0;
      const maxAgeHours = interaction.options.getInteger('max_age_hours') ?? 24;
      const invite = await channel.createInvite({
        maxUses,
        maxAge: maxAgeHours * 3600,
        reason: `Invite created by ${interaction.user.tag}`,
      });
      await interaction.editReply({ content: `Invite for <#${channel.id}>: ${invite.url}` });
    },
  },
];
