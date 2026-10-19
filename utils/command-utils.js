function canActOnMember(interaction, target) {
  if (!target) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  return target.roles.highest.position < interaction.member.roles.highest.position;
}

async function fetchMember(guild, user) {
  return guild.members.fetch(user.id).catch(() => null);
}

function displayName(userOrMember) {
  return userOrMember.displayName || userOrMember.user?.tag || userOrMember.tag || userOrMember.id;
}

function formatDuration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const units = [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ];
  let remaining = seconds;
  const parts = [];
  for (const [label, size] of units) {
    const count = Math.floor(remaining / size);
    if (count) {
      parts.push(`${count}${label}`);
      remaining %= size;
    }
  }
  return parts.join(' ') || '0s';
}

function clampText(value, max = 1000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

module.exports = { canActOnMember, fetchMember, displayName, formatDuration, clampText };
