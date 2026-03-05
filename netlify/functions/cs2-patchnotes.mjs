import { getStore } from "@netlify/blobs";

export const config = {
  schedule: "*/3 * * * *", // toutes les 3 minutes (UTC)
};

function chunk(str, size = 1900) {
  const out = [];
  for (let i = 0; i < str.length; i += size) out.push(str.slice(i, i + size));
  return out;
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

  // [url="..."]text[/url] -> text (url)
  s = s.replace(/\[url="([^"]+)"\]([\s\S]*?)\[\/url\]/gi, (_, url, text) => {
    const t = String(text).trim() || url;
    return `${t} (${url})`;
  });

  // Paragraphs
  s = s.replace(/\[\/?p\]/gi, "\n");

  // Lists
  s = s.replace(/\[list\]/gi, "\n").replace(/\[\/list\]/gi, "\n");

  // Bullets: Steam often uses [] ... [/]
  s = s.replace(/\[\*\]/g, "\n- ");
  s = s.replace(/\[\]\s*/g, "\n- ");
  s = s.replace(/\[\/\]/g, "");

  // Section headers: [ MISC ] etc.
  s = s.replace(/\[\s*([A-Z0-9 \-_/]+)\s*\]/g, (m, title) => {
    const t = String(title).trim();
    if (!t || t.length > 40) return m;
    return `\n\n__**${t}**__\n`;
  });

  // Remove remaining tags [xxx]
  s = s.replace(/\[[^\]]+\]/g, "");

  // Cleanup
  s = s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Icons for known sections
  s = s
    .replace(/__\*\*MISC\*\*__/g, "__**🧩 MISC**__")
    .replace(/__\*\*MAPS\*\*__/g, "__**🗺️ MAPS**__")
    .replace(/__\*\*MAP SCRIPTING\*\*__/g, "__**🧠 MAP SCRIPTING**__")
    .replace(/__\*\*UI\*\*__/g, "__**🧭 UI**__")
    .replace(/__\*\*WORKSHOP\*\*__/g, "__**🛠️ WORKSHOP**__");

  return s;
}

function boldMapNames(text) {
  const lines = String(text ?? "").split("\n");
  return lines
    .map((line) => {
      const t = line.trim();
      if (
        t &&
        !t.startsWith("-") &&
        !t.startsWith("__**") &&
        t.length <= 28 &&
        /^[A-Za-z0-9 '’:-]+$/.test(t)
      ) {
        return `**${t}**`;
      }
      return line;
    })
    .join("\n");
}

async function fetchLatestSteamNews(appId) {
  const url =
    `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/` +
    `?appid=${encodeURIComponent(appId)}&count=5&maxlength=0`;

  const res = await fetch(url, { headers: { "User-Agent": "cs2-netlify/1.0" } });
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);

  const data = await res.json();
  const items = data?.appnews?.newsitems ?? [];
  items.sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  return items[0] ?? null;
}

async function postWebhook(webhookUrl, content, roleId = "") {
  const payload = {
    content,
    // n'autorise que la mention du rôle voulu
    allowed_mentions: roleId ? { roles: [roleId] } : { parse: [] },
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Discord webhook HTTP ${res.status}${txt ? ` - ${txt}` : ""}`);
  }
}

export default async () => {
  try {
    const appId = process.env.APP_ID ?? "730";

    const webhookUrls = (process.env.DISCORD_WEBHOOK_URLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const roleIds = (process.env.ROLE_CS2_IDS ?? "")
      .split(",")
      .map((s) => s.trim()); // peut être plus court, on gère

    if (!webhookUrls.length) {
      console.error("Missing DISCORD_WEBHOOK_URLS");
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
    const srcUrl = latest.url ?? "";
    let body = steamBbcodeToDiscord(latest.contents ?? "");
    body = boldMapNames(body);

    const header = `**${title}**\n${srcUrl}\n\n`;
    const full = header + (body || "_(contenu vide)_");

    const parts = chunk(full, 1900);

    // Envoi sur chaque webhook avec le rôle correspondant (même index)
    for (let w = 0; w < webhookUrls.length; w++) {
      const wh = webhookUrls[w];
      const roleId = roleIds[w] || "";

      for (let i = 0; i < parts.length; i++) {
        // Mention uniquement sur la 1ère partie
        const mention = i === 0 && roleId ? `<@&${roleId}>\n` : "";
        const prefix = parts.length > 1 ? `*(part ${i + 1}/${parts.length})*\n` : "";
        await postWebhook(wh, mention + prefix + parts[i], roleId);
      }
    }

    await store.set("lastGid", latest.gid);
    console.log("Posted new gid:", latest.gid);
    return;
  } catch (e) {
    console.error("Scheduled function error:", e?.stack ?? e);
    return;
  }
};