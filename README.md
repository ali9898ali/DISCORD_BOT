# Discord Starter Bot

A Discord bot with welcome messages, server/member information, and moderation commands (`/kick`, `/ban`, `/mute`, `/unmute`).

## Run in this Replit project

The bot runs as the **Discord Bot** console workflow. Its token and application ID are stored as Replit Secrets (`DISCORD_TOKEN` and `CLIENT_ID`); do not put them in source files or commit a `.env` file.

To start the bot, run the **Discord Bot** workflow. Slash commands must be registered once with:

```sh
pnpm --filter discord-starter-bot run deploy
```

Registering commands uses Discord's bulk overwrite endpoint for the selected scope. If `GUILD_ID` is set, it replaces that guild's commands; otherwise, it replaces the application's global commands. Do not run this against an application that has other commands you need to keep.

## Discord setup

1. In the Discord Developer Portal, create an application and a bot.
2. Add the Application ID as the `CLIENT_ID` secret and the bot token as `DISCORD_TOKEN`.
3. Enable **Server Members Intent** under the application's Bot settings for welcome messages.
4. Invite the bot with the `bot` and `applications.commands` scopes and the permissions it needs: View Channels, Send Messages, Embed Links, Kick Members, Ban Members, and Moderate Members.
5. Move the bot's role above the roles it needs to moderate.

## Commands

- `/setwelcome` configures the welcome channel and message. Placeholders: `{user}`, `{username}`, `{server}`, and `{count}`. Run without options to view current settings.
- `/serverinfo` and `/userinfo` show server and member details.
- `/kick`, `/ban`, `/mute`, and `/unmute` are restricted to members with the corresponding moderation permissions.
- `/ping` replies with `Pong`.

The command dispatcher defers responses before commands that may call Discord's API, then edits the deferred response when the work finishes. Keep `immediate: true` only for commands that can reply immediately.

## Run outside Replit

Install dependencies from the project root with `pnpm install`. For local development, copy `.env.example` to `.env`, fill in the values locally, then run:

```sh
pnpm --filter discord-starter-bot run deploy
pnpm --filter discord-starter-bot run start
```

Never commit `.env`. Per-server welcome settings are stored in `data/settings.json` on the bot process's local disk.

## Project files

- `index.js` — bot connection, slash-command handling, and welcome events
- `deploy-commands.js` — registers slash commands
- `commands/` — one file per command
- `config.js` — default welcome message and embed color
- `utils/settings.js` — per-server settings persistence
