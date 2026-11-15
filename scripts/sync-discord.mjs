// Pulls messages from two Discord channels into data/*.json and builds art/manifest.json.
import { mkdir, writeFile, readdir, rm, access } from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
if (!TOKEN) { console.error("Missing DISCORD_BOT_TOKEN secret"); process.exit(1); }

const CHANNELS = {
  news: "1550275286438772876",          // "updates" channel
  announcements: "1550275219883823204",
};
const MAX_MESSAGES = 200;               // newest messages kept per channel
const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
const API = "https://discord.com/api/v10";
const MEDIA_DIR = "data/media";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const exists = (p) => access(p).then(() => true, () => false);

async function api(p, attempt = 0) {
  const r = await fetch(API + p, { headers: { Authorization: `Bot ${TOKEN}`, "User-Agent": "DiscordBot (https://triggerpush.github.io, 1.0)" } });
  if (r.status === 429 && attempt < 5) {
    const j = await r.json();
    await sleep((j.retry_after || 1) * 1000 + 250);
    return api(p, attempt + 1);
  }
  if (!r.ok) throw new Error(`Discord ${r.status} on ${p}: ${await r.text()}`);
  return r.json();
}

// Discord CDN links for attachments expire, so images are copied into the repo.
const usedMedia = new Set();
async function mirror(url, key) {
  if (!url) return url;
  try {
    const ext = (path.extname(new URL(url).pathname).toLowerCase().replace(/[^.a-z0-9]/g, "")) || ".bin";
    const name = `${key}${ext}`;
    const file = path.join(MEDIA_DIR, name);
    usedMedia.add(name);
    if (!(await exists(file))) {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_MEDIA_BYTES) throw new Error("file too large to mirror");
      await writeFile(file, buf);
    }
    return `${MEDIA_DIR}/${name}`;
  } catch (e) {
    console.warn(`Could not mirror ${url}: ${e.message}`);
    return url;
  }
}

const avatarOf = (u) => u.avatar
  ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`
  : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(u.id) >> 22n) % 6n)}.png`;

async function fetchMessages(channelId) {
  const out = [];
  let before;
  while (out.length < MAX_MESSAGES) {
    const batch = await api(`/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`);
    out.push(...batch);
    if (batch.length < 100) break;
    before = batch[batch.length - 1].id;
  }
  return out.slice(0, MAX_MESSAGES);
}

async function convert(m) {
  const mentions = {};
  for (const u of m.mentions || []) mentions[u.id] = u.global_name || u.username;
  const attachments = [];
  for (const a of m.attachments || []) {
    attachments.push({
      url: await mirror(a.url, `${m.id}-${a.id}`),
      name: a.filename, type: a.content_type || "", width: a.width || null, height: a.height || null,
    });
  }
  const embeds = [];
  let i = 0;
  for (const e of m.embeds || []) {
    const n = i++;
    embeds.push({
      title: e.title || null, description: e.description || null, url: e.url || null, color: e.color ?? null,
      author: e.author?.name || null, footer: e.footer?.text || null,
      image: await mirror(e.image?.url, `${m.id}-e${n}-img`),
      thumbnail: await mirror(e.thumbnail?.url, `${m.id}-e${n}-thumb`),
      fields: (e.fields || []).map((f) => ({ name: f.name, value: f.value })),
    });
  }
  return {
    id: m.id, timestamp: m.timestamp, edited: m.edited_timestamp,
    author: { name: m.author.global_name || m.author.username, avatar: avatarOf(m.author) },
    content: m.content || "", mentions, attachments, embeds,
  };
}

async function syncChannel(key, id) {
  const info = await api(`/channels/${id}`);
  const lookup = { roles: {}, channels: {} };
  if (info.guild_id) {
    try { for (const r of await api(`/guilds/${info.guild_id}/roles`)) lookup.roles[r.id] = { name: r.name }; } catch (e) { console.warn("roles:", e.message); }
    try { for (const c of await api(`/guilds/${info.guild_id}/channels`)) lookup.channels[c.id] = c.name; } catch (e) { console.warn("channels:", e.message); }
  }
  const raw = (await fetchMessages(id)).filter((m) => m.type === 0 || m.type === 19);
  const messages = [];
  for (const m of raw) {
    if (!m.content && !m.attachments?.length && !m.embeds?.length) continue;
    messages.push(await convert(m));
  }
  await writeFile(`data/${key}.json`, JSON.stringify({ channel: { id, name: info.name }, lookup, messages }, null, 1) + "\n");
  console.log(`${key}: ${messages.length} messages`);
}

async function buildArtManifest() {
  const exts = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg"]);
  const files = (await readdir("art", { recursive: true })).filter((f) => exts.has(path.extname(f).toLowerCase()));
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const images = files.map((f) => ({
    src: `art/${f.split(path.sep).join("/")}`,
    name: path.basename(f, path.extname(f)).replace(/[_-]+/g, " "),
  }));
  await writeFile("art/manifest.json", JSON.stringify({ images }, null, 1) + "\n");
  console.log(`art: ${images.length} images`);
}

await mkdir(MEDIA_DIR, { recursive: true });
await buildArtManifest();
let failed = false;
for (const [key, id] of Object.entries(CHANNELS)) {
  try { await syncChannel(key, id); } catch (e) { failed = true; console.error(`${key} failed: ${e.message}`); }
}
if (!failed) {
  for (const f of await readdir(MEDIA_DIR)) if (f !== ".gitkeep" && !usedMedia.has(f)) await rm(path.join(MEDIA_DIR, f));
}
if (failed) process.exit(1);
