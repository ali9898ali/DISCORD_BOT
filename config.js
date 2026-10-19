// Default settings. Server admins can override the welcome channel/message with /setwelcome.
module.exports = {
  embedColor: 0x5865f2,
  welcome: {
    enabled: true,
    // Placeholders: {user} (mention), {username}, {server}, {count} (member number)
    message: 'Welcome to **{server}**, {user}! 🎉 You are member #{count}.',
  },
};
