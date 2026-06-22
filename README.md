# PoD Companion

A small, **ToS-compliant** Discord bot that gives users native **slash commands**
(`/play`, `/next`, `/stop`, …) with autocomplete and buttons, and drives the
[PoD](https://github.com/StonyTark1117/PoD) selfbot to actually stream Plex into a
Discord voice channel.

## Why two bots?

Discord's `/` slash commands and command picker require a **registered bot
application** — a user account (selfbot) can't own them. But a real bot **can't**
do Go-Live video streaming (that's a user-account-only capability), which is the
whole reason PoD is a selfbot. So:

- **PoD** (selfbot) does the actual streaming and exposes a localhost control API.
- **PoD Companion** (this bot, a real application) owns the slash-command UX and
  relays each command to PoD over `http://127.0.0.1:8742`.

Both run on the same host (CT 138), so the control API never leaves localhost.

## Commands

- `/play title:<autocomplete>` — search Plex & stream to your voice channel. Title
  autocompletes live from your library (Doplarr-style); also understands
  `house s3e1` style episode targets.
- `/next` · `/back` — next / previous episode.
- `/qp season:<n> episode:<n>` — jump to a specific episode.
- `/autoplay state:on|off` — toggle auto-advance.
- `/nowplaying` — show the current item.
- Every "Now Playing" card has **Back / Next / Stop / Autoplay** buttons.

## Setup

1. **Create a bot application**: https://discord.com/developers/applications → New
   Application → Bot → Reset Token (copy it). Invite it with OAuth2 scopes
   `bot` + `applications.commands` (no special permissions needed — PoD handles voice).
2. **Install**: `npm install`
3. **Configure**: copy `config.example.json` → `config.json` and fill in:
   - `botToken` — the bot application token
   - `guildId` — the stream server's ID
   - `podApi.secret` — must match PoD's `config.json` → `controlApi.secret`
4. **Run**: `npm start` (or install the `pod-bot.service` systemd unit).

Slash commands register to the guild automatically on startup (instant).

## Notes

- `config.json` holds the bot token + control secret — it is gitignored; **never commit it**.
- Requires Node 18+ (uses global `fetch`). Deployed on Node 22.
- Depends on PoD running with `controlApi.enabled: true` on the same host.
