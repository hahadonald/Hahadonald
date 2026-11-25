import { SITE, plain, renderHomepage, renderExhibitPage, renderNotFound } from "./views.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/vote" && request.method === "GET") {
      return handleGetVotes(request, env);
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

    if (url.pathname.startsWith("/files/") && request.method === "GET") {
      const slug = url.pathname.slice("/files/".length).replace(/\/$/, "");
      return handleExhibitPage(slug, env);
    }

    if (url.pathname === "/random" && request.method === "GET") {
      return handleRandomExhibit(env, url);
    }

    if (url.pathname === "/sitemap.xml" && request.method === "GET") {
      return handleSitemap(env);
    }

    if (url.pathname === "/robots.txt" && request.method === "GET") {
      return handleRobots();
    }

    if (url.pathname === "/rss.xml" && request.method === "GET") {
      return handleRss(env);
    }

    if (url.pathname === "/" && request.method === "GET") {
      return handleHomepage(request, env);
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

async function handleGetVotes(request, env) {
  const { results } = await env.DB.prepare(
    "SELECT exhibit_id, COUNT(*) AS count FROM votes GROUP BY exhibit_id"
  ).all();
  const counts = {};
  for (const row of results) counts[row.exhibit_id] = row.count;

  // Which exhibits this visitor (anonymous cookie) has already voted for.
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(VISITOR_COOKIE_RE);
  let mine = [];
  if (match) {
    const res = await env.DB.prepare(
      "SELECT exhibit_id FROM votes WHERE visitor_id = ?1"
    ).bind(match[1]).all();
    mine = res.results.map((r) => r.exhibit_id);
  }
  const response = jsonResponse({ counts, mine });
  response.headers.set("Cache-Control", "no-store");
  return response;
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

  // $1 minimum, $50,000 maximum, whole-cent integer only — high enough
  // to let a serious donor through, sane enough to catch a stray typo.
  if (!Number.isInteger(amount) || amount < 100 || amount > 5000000) {
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
    const errBody = await stripeRes.json().catch(() => null);
    const detail = errBody && errBody.error && errBody.error.message
      ? errBody.error.message
      : `stripe returned ${stripeRes.status}`;
    return jsonResponse({ error: detail }, 502);
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

// ---------------------------------------------------------------------
// Pages. Everything below reads from the D1 `exhibits` table
// (is_current = 1 is the live version of each exhibit).
// ---------------------------------------------------------------------

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };

async function loadVoteCounts(env) {
  const { results } = await env.DB.prepare(
    "SELECT exhibit_id, COUNT(*) AS c FROM votes GROUP BY exhibit_id"
  ).all();
  const counts = {};
  for (const r of results) counts[r.exhibit_id] = r.c;
  return counts;
}

async function handleHomepage(request, env) {
  const { results: rows } = await env.DB.prepare(
    "SELECT * FROM exhibits WHERE is_current = 1 ORDER BY number ASC"
  ).all();
  const voteCounts = await loadVoteCounts(env);

  // "File of the Day": deterministic per UTC date, so everyone sees the same one.
  const dayIndex = Math.floor(Date.now() / 86400000);
  const featured = rows[dayIndex % rows.length];
  const today = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  const html = renderHomepage({ rows, voteCounts, featured, today });
  return new Response(html, {
    headers: { ...HTML_HEADERS, "Cache-Control": "public, max-age=0, must-revalidate" },
  });
}

async function handleExhibitPage(slug, env) {
  const ex = await env.DB.prepare(
    "SELECT * FROM exhibits WHERE slug = ?1 AND is_current = 1"
  ).bind(slug).first();

  if (!ex) {
    return new Response(renderNotFound(), { status: 404, headers: HTML_HEADERS });
  }

  const voteCounts = await loadVoteCounts(env);
  const [prev, next, relatedSame, relatedAny] = await Promise.all([
    env.DB.prepare(
      "SELECT slug, title FROM exhibits WHERE is_current = 1 AND number < ?1 ORDER BY number DESC LIMIT 1"
    ).bind(ex.number).first(),
    env.DB.prepare(
      "SELECT slug, title FROM exhibits WHERE is_current = 1 AND number > ?1 ORDER BY number ASC LIMIT 1"
    ).bind(ex.number).first(),
    env.DB.prepare(
      "SELECT * FROM exhibits WHERE is_current = 1 AND topic = ?1 AND number <> ?2 ORDER BY RANDOM() LIMIT 3"
    ).bind(ex.topic, ex.number).all(),
    env.DB.prepare(
      "SELECT * FROM exhibits WHERE is_current = 1 AND number <> ?1 ORDER BY RANDOM() LIMIT 3"
    ).bind(ex.number).all(),
  ]);

  const related = relatedSame.results.slice();
  for (const r of relatedAny.results) {
    if (related.length >= 3) break;
    if (!related.some((x) => x.number === r.number)) related.push(r);
  }

  const html = renderExhibitPage({
    ex, voteCount: voteCounts[ex.legacy_id] || 0, related, prev, next, voteCounts,
  });
  return new Response(html, { headers: HTML_HEADERS });
}

async function handleRandomExhibit(env, url) {
  const row = await env.DB.prepare(
    "SELECT slug FROM exhibits WHERE is_current = 1 ORDER BY RANDOM() LIMIT 1"
  ).first();
  if (!row) return new Response("No exhibits found.", { status: 404 });
  return Response.redirect(new URL("/files/" + row.slug, url).toString(), 302);
}

// ---------------------------------------------------------------------
// Discoverability: sitemap, robots.txt, RSS. All read from D1, so adding
// an exhibit row updates them automatically.
// ---------------------------------------------------------------------

async function handleSitemap(env) {
  const { results } = await env.DB.prepare(
    "SELECT slug, created_at FROM exhibits WHERE is_current = 1 ORDER BY number ASC"
  ).all();

  const urls = [`  <url>\n    <loc>${SITE}/</loc>\n    <changefreq>daily</changefreq>\n  </url>`]
    .concat(
      results.map((r) => {
        const date = new Date((r.created_at || 0) * 1000).toISOString().slice(0, 10);
        return `  <url>\n    <loc>${SITE}/files/${r.slug}</loc>\n    <lastmod>${date}</lastmod>\n  </url>`;
      })
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

function handleRobots() {
  const body = `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function handleRss(env) {
  const { results } = await env.DB.prepare(
    "SELECT * FROM exhibits WHERE is_current = 1 ORDER BY number DESC LIMIT 30"
  ).all();

  const xmlEscape = (s) =>
    String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const items = results
    .map((ex) => {
      const pubDate = new Date((ex.created_at || 0) * 1000).toUTCString();
      return `  <item>
    <title>${xmlEscape(ex.title)}</title>
    <link>${SITE}/files/${ex.slug}</link>
    <guid>${SITE}/files/${ex.slug}</guid>
    <pubDate>${pubDate}</pubDate>
    <description>${xmlEscape(plain(ex.body))} ${xmlEscape(ex.source)}</description>
  </item>`;
    })
    .join("\n");

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>The Donald Files</title>
  <link>${SITE}/</link>
  <description>Real events. Real sources. No invented quotes.</description>
${items}
</channel>
</rss>`;
  return new Response(rss, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
