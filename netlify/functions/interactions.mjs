import nacl from "tweetnacl";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}

export default async (req) => {
  // Discord envoie toujours ces 2 headers
  const signature = req.headers["x-signature-ed25519"];
  const timestamp = req.headers["x-signature-timestamp"];

  if (!signature || !timestamp) {
    return json(401, { error: "Missing signature headers" });
  }

  const publicKeyHex = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKeyHex) {
    return json(500, { error: "Missing DISCORD_PUBLIC_KEY env var" });
  }

  const rawBody = req.body ?? "";

  // message = timestamp + rawBody
  const message = new TextEncoder().encode(timestamp + rawBody);

  // Convert hex -> Uint8Array
  const sig = Uint8Array.from(signature.match(/.{1,2}/g).map((b) => parseInt(b, 16)));
  const pk = Uint8Array.from(publicKeyHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

  const ok = nacl.sign.detached.verify(message, sig, pk);
  if (!ok) {
    return json(401, { error: "Invalid request signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  // PING (type 1) => doit répondre { type: 1 }
  if (payload.type === 1) {
    return json(200, { type: 1 });
  }

  // Pour l’instant : réponse générique (tu pourras ajouter des commandes plus tard)
  return json(200, {
    type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
    data: { content: "✅ Interactions endpoint OK (setup en cours)." },
  });
};