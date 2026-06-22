const {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags
} = require("discord.js");
const config = require("./config.json");

// --- PoD control API client (localhost) ----------------------------------
const POD = config.podApi.url.replace(/\/$/, "");
const SECRET = config.podApi.secret;

async function podGet(p) {
  const res = await fetch(POD + p, { headers: { "x-pod-secret": SECRET } });
  return res.json();
}
async function podPost(p, body) {
  const res = await fetch(POD + p, {
    method: "POST",
    headers: { "x-pod-secret": SECRET, "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  return res.json();
}

// --- Slash command definitions -------------------------------------------
const commands = [
  new SlashCommandBuilder()
    .setName("play").setDescription("Search Plex and stream it to your voice channel")
    .addStringOption(o => o.setName("title").setDescription("Movie or show name")
      .setRequired(true).setAutocomplete(true)),
  new SlashCommandBuilder().setName("next").setDescription("Skip to the next episode (TV)"),
  new SlashCommandBuilder().setName("back").setDescription("Go to the previous episode (TV)"),
  new SlashCommandBuilder().setName("stop").setDescription("Stop streaming and disconnect"),
  new SlashCommandBuilder().setName("nowplaying").setDescription("Show what's currently playing"),
  new SlashCommandBuilder()
    .setName("autoplay").setDescription("Toggle auto-advance to the next episode")
    .addStringOption(o => o.setName("state").setDescription("on or off").setRequired(true)
      .addChoices({ name: "on", value: "on" }, { name: "off", value: "off" })),
  new SlashCommandBuilder()
    .setName("qp").setDescription("Jump to a specific episode (TV)")
    .addIntegerOption(o => o.setName("season").setDescription("Season number").setRequired(true))
    .addIntegerOption(o => o.setName("episode").setDescription("Episode number").setRequired(true))
].map(c => c.toJSON());

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

client.once("clientReady", async () => {
  console.log("Companion bot ready as", client.user.tag);
  try {
    const rest = new REST({ version: "10" }).setToken(config.botToken);
    // Guild commands register instantly (vs ~1h for global) and scope to our server.
    await rest.put(Routes.applicationGuildCommands(client.user.id, config.guildId), { body: commands });
    console.log(`Registered ${commands.length} slash commands to guild ${config.guildId}`);
  } catch (e) {
    console.error("Command registration failed:", e.message);
  }
});

// --- UI helpers ----------------------------------------------------------
function controls() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("pod:back").setLabel("Back").setEmoji("⏮️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("pod:next").setLabel("Next").setEmoji("⏭️").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("pod:stop").setLabel("Stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("pod:autoplay").setLabel("Autoplay").setEmoji("📺").setStyle(ButtonStyle.Secondary)
  );
}

function nowEmbed(r, footer) {
  const e = new EmbedBuilder().setColor(0xe5a00d).setTitle("▶️ Now Playing")
    .setDescription(r.title || "—");
  if (r.S != null && r.E != null) e.addFields({ name: "Episode", value: `S${r.S}E${r.E}`, inline: true });
  if (footer) e.setFooter({ text: footer });
  return e;
}

const EPH = { flags: MessageFlags.Ephemeral };

// --- Interaction handling ------------------------------------------------
client.on("interactionCreate", async (interaction) => {
  try {
    // Only operate in the configured stream guild.
    if (config.guildId && interaction.guildId !== config.guildId) {
      if (interaction.isRepliable()) return interaction.reply({ content: "This bot only works in the stream server.", ...EPH });
      return;
    }

    // Autocomplete for /play title — live Plex search via the control API.
    if (interaction.isAutocomplete()) {
      const focused = interaction.options.getFocused();
      let choices = [];
      try {
        const r = await podGet(`/search?q=${encodeURIComponent(focused || "")}`);
        choices = (r.results || []).slice(0, 25).map(m => ({
          name: `${m.type === "show" ? "📺" : "🎬"} ${m.title}${m.year ? ` (${m.year})` : ""}`.slice(0, 100),
          value: String(m.title).slice(0, 100)
        }));
      } catch (e) { /* control API down -> empty suggestions */ }
      return interaction.respond(choices);
    }

    if (interaction.isChatInputCommand()) {
      const name = interaction.commandName;
      const title = interaction.options.getString?.("title");
      console.log(`[cmd] /${name}${title ? ` "${title}"` : ""} by ${interaction.user.tag}`);

      if (name === "play") {
        const vc = interaction.member?.voice?.channel;
        if (!vc) return interaction.reply({ content: "⚠️ Join a voice channel first!", ...EPH });
        const title = interaction.options.getString("title");
        await interaction.deferReply();
        const r = await podPost("/play", {
          query: title, guildId: interaction.guildId, channelId: vc.id, textChannelId: interaction.channelId
        });
        if (r.ok) return interaction.editReply({ embeds: [nowEmbed(r)], components: [controls()] });
        if (r.reason === "ep-not-found") return interaction.editReply(`❌ Found "${r.title}" but not S${r.epTarget.season}E${r.epTarget.episode}.`);
        if (r.reason === "not-found") {
          const list = (r.suggestions || []).map(m => `• ${m.title}${m.year ? ` (${m.year})` : ""}`).join("\n");
          return interaction.editReply(list ? `❓ No exact match. Did you mean:\n${list}` : `❌ No Plex match for "${r.query}".`);
        }
        if (r.reason === "no-voice") return interaction.editReply("⚠️ Join a voice channel first!");
        return interaction.editReply("❌ Couldn't play that.");
      }

      if (name === "next" || name === "back") {
        await interaction.deferReply();
        const r = await podPost("/" + name, {});
        if (r.ok) return interaction.editReply({ embeds: [nowEmbed(r)], components: [controls()] });
        return interaction.editReply(r.reason === "end" ? "⚠️ No more items." : "❌ Nothing playing.");
      }

      if (name === "stop") {
        await podPost("/stop", {});
        return interaction.reply("⏹️ Stream stopped.");
      }

      if (name === "nowplaying") {
        const r = await podGet("/nowplaying");
        if (!r.playing) return interaction.reply({ content: "Nothing is playing.", ...EPH });
        return interaction.reply({ embeds: [nowEmbed(r, `Autoplay ${r.autoplay ? "on" : "off"}`)], components: [controls()] });
      }

      if (name === "autoplay") {
        const on = interaction.options.getString("state") === "on";
        const r = await podPost("/autoplay", { on });
        return interaction.reply(`📺 Autoplay **${r.autoplay ? "on" : "off"}**.`);
      }

      if (name === "qp") {
        const season = interaction.options.getInteger("season");
        const episode = interaction.options.getInteger("episode");
        await interaction.deferReply();
        const r = await podPost("/qp", { season, episode });
        if (r.ok) return interaction.editReply({ embeds: [nowEmbed(r)], components: [controls()] });
        return interaction.editReply(r.reason === "not-found" ? `❌ S${season}E${episode} not found.` : "❌ Nothing playing.");
      }
    }

    // Buttons under the Now Playing card.
    if (interaction.isButton()) {
      const action = interaction.customId.split(":")[1];
      console.log(`[btn] ${action} by ${interaction.user.tag}`);
      if (action === "next" || action === "back") {
        await interaction.deferUpdate();
        const r = await podPost("/" + action, {});
        if (r.ok) return interaction.editReply({ embeds: [nowEmbed(r)], components: [controls()] });
        return interaction.followUp({ content: r.reason === "end" ? "⚠️ No more items." : "❌ Nothing playing.", ...EPH });
      }
      if (action === "stop") {
        await interaction.deferUpdate();
        await podPost("/stop", {});
        return interaction.editReply({ content: "⏹️ Stopped.", embeds: [], components: [] });
      }
      if (action === "autoplay") {
        await interaction.deferUpdate();
        const cur = await podGet("/nowplaying");
        const r = await podPost("/autoplay", { on: !cur.autoplay });
        return interaction.followUp({ content: `📺 Autoplay **${r.autoplay ? "on" : "off"}**.`, ...EPH });
      }
    }
  } catch (err) {
    console.error("interaction error:", err);
    if (interaction.isRepliable()) {
      const m = { content: "❌ Something went wrong talking to the streamer.", ...EPH };
      if (interaction.deferred || interaction.replied) interaction.followUp(m).catch(() => {});
      else interaction.reply(m).catch(() => {});
    }
  }
});

client.login(config.botToken);
