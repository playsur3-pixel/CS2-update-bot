import { getStore } from "@netlify/blobs";

function chunk(str, size = 1900) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
}

async function fetchLatestSteamNews(appId) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appId}&count=5&maxlength=0`;
  const res = await fetch(url);
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
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function postWebhook(webhookUrl, content) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

export default async () => {
  const appId = process.env.APP_ID ?? "730";
  const urlsRaw = process.env.DISCORD_WEBHOOK_URLS ?? "";
  const webhookUrls = urlsRaw.split(",").map(s => s.trim()).filter(Boolean);
  const store = getStore("cs2-update");

  const latest = await fetchLatestSteamNews(appId);
  if (!latest?.gid) return new Response("ok", { status: 200 });

  // Force post even if same gid? -> tu choisis :
  // const lastGid = await store.get("lastGid");
  // if (lastGid === latest.gid) return { statusCode: 200, body: "already posted" };

  const title = latest.title ?? "Counter-Strike 2 Update";
  const url = latest.url ?? "";
  const body = htmlToPlainText(latest.contents ?? "");
  const full = `**${title}**\n${url}\n\n${body}`;
  const parts = chunk(full, 1900);

  for (const wh of webhookUrls) {
    for (let i = 0; i < parts.length; i++) {
      const prefix = parts.length > 1 ? `*(part ${i + 1}/${parts.length})*\n` : "";
      await postWebhook(wh, prefix + parts[i]);
    }
  }

  await store.set("lastGid", latest.gid);
  return { statusCode: 200, body: "posted" };
};