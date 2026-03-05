import { getStore } from "@netlify/blobs";

export const config = {
  schedule: "*/2 * * * *", // toutes les 2 minutes (cron UTC)
};

function chunk(str, size = 1900) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

async function fetchLatestSteamNews(appId) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=5&maxlength=0`;
  const res = await fetch(url, { headers: { "User-Agent": "cs2-netlify-bot/1.0" } });
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.appnews?.newsitems ?? [];
  items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return items[0] ?? null;
}

function htmlToPlainText(html) {
  // conversion simple (suffit souvent). Si tu veux mieux, on ajoute une lib.
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function postDiscord(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
}

export default async () => {
  const appId = process.env.APP_ID ?? "730";
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  const storeName = process.env.STORE_NAME ?? "cs2-update";
  if (!webhookUrl) throw new Error("Missing DISCORD_WEBHOOK_URL");

  const store = getStore(storeName);

  const latest = await fetchLatestSteamNews(appId);
  if (!latest?.gid) return;

  const lastGid = await store.get("lastGid");
  if (lastGid === latest.gid) return; // déjà posté

  const title = latest.title ?? "Counter-Strike 2 Update";
  const url = latest.url ?? "";
  const body = htmlToPlainText(latest.contents ?? "");
  const full = `**${title}**\n${url}\n\n${body}`;

  // découpe en plusieurs messages (Discord limite 2000 chars)
  const parts = chunk(full, 1900);
  for (let i = 0; i < parts.length; i++) {
    const prefix = parts.length > 1 ? `*(part ${i + 1}/${parts.length})*\n` : "";
    await postDiscord(webhookUrl, prefix + parts[i]);
  }

  // mémorise le dernier gid
  await store.set("lastGid", latest.gid);
};