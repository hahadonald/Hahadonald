export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/vote" && request.method === "GET") {
      return handleGetVotes(env);
    }

    if (url.pathname === "/api/vote" && request.method === "POST") {
      return handleToggleVote(request, env);
    }

    if (url.pathname === "/api/donate/create-intent" && request.method === "POST") {
      return handleCreateDonationIntent(request, env);
    }

    if (url.pathname === "/api/stripe/webhook" && request.method === "POST") {
      return handleStripeWebhook(request, env);
    }

    // Everything else is a static asset — this line doesn't run the Worker
    // logic below, so it costs no CPU-ms beyond the routing check above.
    return env.ASSETS.fetch(request);
  },
};

const VISITOR_COOKIE_RE = /vid=([a-f0-9-]{36})/;

function getOrCreateVisitorId(request) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(VISITOR_COOKIE_RE);
  if (match) return { id: match[1], isNew: false };
  return { id: crypto.randomUUID(), isNew: true };
}

async function handleGetVotes(env) {
  const { results } = await env.DB.prepare(
    "SELECT exhibit_id, COUNT(*) AS count FROM votes GROUP BY exhibit_id"
  ).all();
  const counts = {};
  for (const row of results) counts[row.exhibit_id] = row.count;
  return jsonResponse(counts);
}

async function handleToggleVote(request, env) {
  const { id: visitorId, isNew } = getOrCreateVisitorId(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const exhibitId = body && body.exhibitId;
  if (typeof exhibitId !== "string" || exhibitId.length === 0 || exhibitId.length > 32) {
    return jsonResponse({ error: "invalid exhibitId" }, 400);
  }

  const existing = await env.DB.prepare(
    "SELECT 1 FROM votes WHERE exhibit_id = ?1 AND visitor_id = ?2"
  ).bind(exhibitId, visitorId).first();

  let voted;
  if (existing) {
    await env.DB.prepare(
      "DELETE FROM votes WHERE exhibit_id = ?1 AND visitor_id = ?2"
    ).bind(exhibitId, visitorId).run();
    voted = false;
  } else {
    await env.DB.prepare(
      "INSERT INTO votes (exhibit_id, visitor_id, created_at) VALUES (?1, ?2, ?3)"
    ).bind(exhibitId, visitorId, Math.floor(Date.now() / 1000)).run();
    voted = true;
  }

  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM votes WHERE exhibit_id = ?1"
  ).bind(exhibitId).first();

  const response = jsonResponse({ exhibitId, voted, count: row.count });
  if (isNew) {
    response.headers.append(
      "Set-Cookie",
      `vid=${visitorId}; Max-Age=31536000; Path=/; HttpOnly; Secure; SameSite=Lax`
    );
  }
  return response;
}

// Creates a Stripe PaymentIntent server-side, using the secret key that
// lives only as a Cloudflare secret (env.STRIPE_SECRET_KEY) — never in
// client code or in this repo.
async function handleCreateDonationIntent(request, env) {
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({ error: "donations not configured yet" }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid JSON body" }, 400);
  }

  const amount = body && body.amount;
  const currency = (body && body.currency) || "usd";

  // Basic sanity bounds: $1 minimum, $1,000 maximum, whole-cent integer only.
  if (!Number.isInteger(amount) || amount < 100 || amount > 100000) {
    return jsonResponse({ error: "invalid amount" }, 400);
  }

  const params = new URLSearchParams();
  params.set("amount", String(amount));
  params.set("currency", currency);
  params.append("automatic_payment_methods[enabled]", "true");

  const stripeRes = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!stripeRes.ok) {
    return jsonResponse({ error: "stripe request failed" }, 502);
  }

  const intent = await stripeRes.json();
  return jsonResponse({ clientSecret: intent.client_secret });
}

// Verifies the Stripe-Signature header manually (no Stripe SDK needed in
// the Workers runtime), then records the event ID for idempotency before
// Stripe's automatic retries can cause it to be processed twice.
async function handleStripeWebhook(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return new Response("webhook not configured yet", { status: 503 });
  }

  const signatureHeader = request.headers.get("Stripe-Signature");
  const rawBody = await request.text();
  if (!signatureHeader) {
    return new Response("missing signature", { status: 400 });
  }

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parts.t;
  const expectedSigFromStripe = parts.v1;
  if (!timestamp || !expectedSigFromStripe) {
    return new Response("bad signature format", { status: 400 });
  }

  // Reject stale events — limits replay risk if a signature ever leaked.
  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (ageSeconds > 300) {
    return new Response("timestamp too old", { status: 400 });
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(signedPayload)
  );
  const computedSig = [...new Uint8Array(sigBuffer)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedSig !== expectedSigFromStripe) {
    return new Response("signature mismatch", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("bad JSON", { status: 400 });
  }

  const alreadyProcessed = await env.DB.prepare(
    "SELECT 1 FROM stripe_events WHERE event_id = ?1"
  ).bind(event.id).first();

  if (alreadyProcessed) {
    return jsonResponse({ received: true, duplicate: true });
  }

  await env.DB.prepare(
    "INSERT INTO stripe_events (event_id, processed_at) VALUES (?1, ?2)"
  ).bind(event.id, Math.floor(Date.now() / 1000)).run();

  // MVP: record receipt only. Stripe's own dashboard is the source of
  // truth for actual payment records — extend here later if an on-site
  // running total or donor-thanks feature is wanted.

  return jsonResponse({ received: true });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
