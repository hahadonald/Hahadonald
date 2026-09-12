export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/vote" && request.method === "GET") {
      return handleGetVotes(env);
    }

    if (url.pathname === "/api/vote" && request.method === "POST") {
      return handleToggleVote(request, env);
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

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
