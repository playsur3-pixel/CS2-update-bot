import { getStore } from "@netlify/blobs";

export const config = {
  schedule: "*/3 * * * *", // toutes les 3 minutes (UTC)
};

function chunk(str, size = 1900) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

async function fetchLatestSteamNews(appId) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=5&maxlength=0`;
  const res = await fetch(url, { headers: { "User-Agent": "cs2-netlify/1.0" } });
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.appnews?.newsitems ?? [];
  items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return items[0] ?? null;
}

function htmlToPlainText(html) {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function postWebhook(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
}

export default async () => {
  const appId = process.env.APP_ID ?? "730";
  const urlsRaw = process.env.DISCORD_WEBHOOK_URLS ?? "";
  const webhookUrls = urlsRaw.split(",").map(s => s.trim()).filter(Boolean);
  if (webhookUrls.length === 0) throw new Error("Missing DISCORD_WEBHOOK_URLS");

  const store = getStore("cs2-update");

  const latest = await fetchLatestSteamNews(appId);
  if (!latest?.gid) return;

  const lastGid = await store.get("lastGid");
  if (lastGid === latest.gid) return;

  const title = latest.title ?? "Counter-Strike 2 Update";
  const url = latest.url ?? "";
  const body = htmlToPlainText(latest.contents ?? "");
  const full = `**${title}**\n${url}\n\n${body}`;

  const parts = chunk(full, 1900);

  // Poste sur chaque webhook
  for (const wh of webhookUrls) {
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.length > 1 ? `*(part ${i + 1}/${parts.length})*\n` : "";
      await postWebhook(wh, prefix + parts[i]);
    }
  }

  await store.set("lastGid", latest.gid);
};