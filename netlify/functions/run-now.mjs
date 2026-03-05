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

  s = s.replace(/\[url="([^"]+)"\]([\s\S]*?)\[\/url\]/gi, (_, url, text) => {
    const t = String(text).trim() || url;
    return `${t} (${url})`;
  });

  s = s.replace(/\[\/?p\]/gi, "\n");
  s = s.replace(/\[list\]/gi, "\n").replace(/\[\/list\]/gi, "\n");
  s = s.replace(/\[\*\]/g, "\n- ");
  s = s.replace(/\[\]\s*/g, "\n- ");
  s = s.replace(/\[\/\]/g, "");

  s = s.replace(/\[\s*([A-Z0-9 \-_/]+)\s*\]/g, (m, title) => {
    const t = String(title).trim();
    if (!t || t.length > 40) return m;
    return `\n\n__**${t}**__\n`;
  });

  s = s.replace(/\[[^\]]+\]/g, "");

  s = s
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

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
    `?appid=${encodeURIComponent(appId)}&count=1&maxlength=0`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Steam HTTP ${res.status}`);

  const data = await res.json();
  const items = data?.appnews?.newsitems ?? [];
  return items[0] ?? null;
}

async function postWebhook(webhookUrl, content, roleId = "") {
  const payload = {
    content,
    allowed_mentions: roleId ? { roles: [roleId] } : { parse: [] },
  };

  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, body: txt.slice(0, 200) };
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
      .map((s) => s.trim());

    if (!webhookUrls.length) {
      return new Response(JSON.stringify({ error: "Missing DISCORD_WEBHOOK_URLS" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    const latest = await fetchLatestSteamNews(appId);
    if (!latest) {
      return new Response(JSON.stringify({ error: "No Steam news found" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    const title = latest.title ?? "Counter-Strike 2 Update";
    const srcUrl = latest.url ?? "";
    let body = steamBbcodeToDiscord(latest.contents ?? "");
    body = boldMapNames(body);

    const full = `**${title}**\n${srcUrl}\n\n${body}`;
    const parts = chunk(full, 1900);

    // TEST: on envoie seulement la 1ère partie à chaque serveur
    const results = [];
    for (let w = 0; w < webhookUrls.length; w++) {
      const wh = webhookUrls[w];
      const roleId = roleIds[w] || "";
      const mention = roleId ? `<@&${roleId}>\n` : "";
      const prefix = parts.length > 1 ? `*(part 1/${parts.length})*\n` : "";
      const r = await postWebhook(wh, mention + prefix + (parts[0] ?? "✅ test"), roleId);
      results.push({ idx: w, roleId: roleId || null, ...r });
    }

    return new Response(
      JSON.stringify(
        {
          steam: { gid: latest.gid, title, url: srcUrl, length: full.length, parts: parts.length },
          discord: results,
          note: "run-now n’envoie que la PART 1. Le cron cs2-patchnotes enverra tout.",
        },
        null,
        2
      ),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};