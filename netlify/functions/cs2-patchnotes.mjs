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
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${encodeURIComponent(
    appId
  )}&count=5&maxlength=0`;

  const res = await fetch(url, { headers: { "User-Agent": "cs2-netlify/1.0" } });
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);

  const data = await res.json();
  const items = data?.appnews?.newsitems ?? [];
  items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return items[0] ?? null;
}

function decodeEntities(s) {
  return (s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function steamBbcodeToDiscord(input) {
  let s = decodeEntities(input ?? "");

  // Liens [url="..."]text[/url]  ->  text (url)
  s = s.replace(/\[url="([^"]+)"\]([\s\S]*?)\[\/url\]/gi, (_, url, text) => {
    const t = String(text).trim() || url;
    return `${t} (${url})`;
  });

  // Nettoyage des tags Steam BBCode
  // [p] -> newline, [/p] -> newline
  s = s.replace(/\[\/?p\]/gi, "\n");

  // [list] ... [/list] -> garde contenu, mais avec newlines
  s = s.replace(/\[list\]/gi, "\n").replace(/\[\/list\]/gi, "\n");

  // Puces : [*] et [] (Steam met parfois [])
  s = s.replace(/\[\*\]/g, "\n- ");
  s = s.replace(/\[\]\s*/g, "\n- ");
  s = s.replace(/\[\/\]/g, ""); // fermeture vide Steam

  // Titres style [ MISC ] : on les met en header
  s = s.replace(/\[\s*([A-Z0-9 \-_/]+)\s*\]/g, (m, title) => {
    const t = String(title).trim();
    // évite de transformer les tags qui ne sont pas des headers
    if (!t || t.length > 40) return m;
    return `\n\n__**${t}**__\n`;
  });

  // Retire le reste des tags inconnus [xxx]
  s = s.replace(/\[[^\]]+\]/g, "");

  // Nettoyage des espaces / lignes
  s = s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Ajoute des icônes aux sections connues (optionnel)
  s = s
    .replace(/__\*\*MISC\*\*__/g, "__**🧩 MISC**__")
    .replace(/__\*\*MAPS\*\*__/g, "__**🗺️ MAPS**__")
    .replace(/__\*\*MAP SCRIPTING\*\*__/g, "__**🧠 MAP SCRIPTING**__")
    .replace(/__\*\*WORKSHOP\*\*__/g, "__**🛠️ WORKSHOP**__")
    .replace(/__\*\*UI\*\*__/g, "__**🧭 UI**__");

  // Petite retouche : lignes qui ne commencent pas par "-" sous une section -> on les laisse
  return s;
}

async function postWebhook(webhookUrl, content) {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook HTTP ${res.status} ${text ? `- ${text}` : ""}`);
  }
}

export default async () => {
  try {
    const appId = process.env.APP_ID ?? "730";

    const urlsRaw = process.env.DISCORD_WEBHOOK_URLS ?? "";
    const webhookUrls = urlsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (webhookUrls.length === 0) {
      console.error("Missing DISCORD_WEBHOOK_URLS env var");
      return;
    }

    const store = getStore("cs2-update");

    const latest = await fetchLatestSteamNews(appId);
    if (!latest?.gid) {
      console.log("No Steam news item found");
      return;
    }

    const lastGid = (await store.get("lastGid")) ?? "";
    if (String(lastGid) === String(latest.gid)) {
      console.log("Already posted gid:", latest.gid);
      return;
    }

    const title = latest.title ?? "Counter-Strike 2 Update";
    const url = latest.url ?? "";
    const body = steamBbcodeToDiscord(latest.contents ?? "");
    const full = `**${title}**\n${url}\n\n${body}`;

    const parts = chunk(full, 1900);

    // Poste sur chaque webhook (si un webhook échoue, on log et on continue)
    for (const wh of webhookUrls) {
      for (let i = 0; i < parts.length; i++) {
        const prefix = parts.length > 1 ? `*(part ${i + 1}/${parts.length})*\n` : "";
        try {
          await postWebhook(wh, prefix + parts[i]);
        } catch (e) {
          console.error("Webhook post failed:", e?.message ?? e);
          break; // on évite d’envoyer 20 morceaux sur un webhook qui bloque
        }
      }
    }

    await store.set("lastGid", latest.gid);
    console.log("Posted new gid:", latest.gid);
    return;
  } catch (e) {
    // Important : ne pas laisser crasher la scheduled function
    console.error("Scheduled function error:", e?.stack ?? e);
    return;
  }
};