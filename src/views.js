// Page templates for hahadonald.com. Plain template literals, no build step.
// Data comes from the D1 `exhibits` table (see handlers in index.js).

export const SITE = "https://hahadonald.com";
export const OG_IMAGE =
  "https://images.unsplash.com/photo-1505682634904-d7c8d95cdc50?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&q=75&w=1200&h=630";
export const STRIPE_PUBLISHABLE_KEY =
  "pk_test_51UEsnOH2PuEwLZfcgeYOnOE6JzojYaPjVvm4nnYrTVn6t43osobBnkCWaZTUKUawRM2gEEIUXRxrZ9fcnToCwlph00p4kvdwtT";

// Crypto addresses stay hidden until real ones are filled in here.
const BTC_ADDRESS = "";
const ETH_ADDRESS = "";

// Editorial flags. Curated by slug; everything else is classified automatically.
const CLASSICS = new Set([
  "the-sharpie-amendment", "covfefe", "person-woman-man-camera-tv", "tim-apple",
  "welcome-to-nambia", "very-stable-genius", "paper-towels", "the-light-bulb-idea",
  "two-corinthians", "eclipse-but-make-it-ill-advised", "windmills-will-get-you",
]);
const WTFS = new Set([
  "tariffs-on-the-penguins", "pope-donald-i", "darth-trump", "the-moon-part-of-mars",
  "finland-rakes-the-forest", "prince-of-whales", "wet-from-the-standpoint-of-water",
  "the-gulf-of-america", "the-continental-army-takes-the-airports", "the-100-movie-tariff",
  "trump-gaza-the-ai-resort", "king-trump-fighter-pilot", "triple-sabotage-at-the-un",
  "the-white-house-tesla-showroom", "medal-of-honor-now-with-dog",
]);
const NEW_FROM_NUMBER = 99;

// Visitor-facing topic groups. Raw `topic` values in D1 stay as they are;
// unknown topics fall back to their own name so nothing disappears.
const TOPIC_GROUPS = {
  "Foreign Policy": "Foreign Affairs",
  "Personal Conduct": "Personal Conduct",
  "Media & Communications": "Words & Media",
  "Public Health": "COVID & Health",
  "Government & Justice": "Government & Law",
  "Government & Military": "Government & Law",
  "Immigration": "Government & Law",
  "Economy & Trade": "Economy & Trade",
  "History & Facts": "Science & History",
  "Science & Space": "Science & History",
  "Environment & Energy": "Science & History",
  "Environment & Weather": "Science & History",
};
export function groupOf(topic) {
  return TOPIC_GROUPS[topic] || topic || "Other";
}

// ---------------------------------------------------------------- helpers

export function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function plain(html) {
  return String(html || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function excerpt(html, max) {
  const t = plain(html);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,.;:—-]+$/, "") + "…";
}

function pad(n) {
  return String(n).padStart(3, "0");
}

function yearsOf(ex) {
  return String(ex.year || "").split("|").map((s) => parseInt(s, 10)).filter((n) => !isNaN(n));
}

export function termOf(ex) {
  const ys = yearsOf(ex);
  if (ys.some((y) => y >= 2025)) return "second";
  return "first";
}

function badgesFor(ex) {
  const out = [];
  out.push(
    termOf(ex) === "second"
      ? '<span class="badge t-second">2nd term</span>'
      : '<span class="badge t-first">1st term</span>'
  );
  if (ex.number >= NEW_FROM_NUMBER) out.push('<span class="badge b-new">New</span>');
  else if (CLASSICS.has(ex.slug)) out.push('<span class="badge b-classic">Classic</span>');
  else if (WTFS.has(ex.slug)) out.push('<span class="badge b-wtf">WTF</span>');
  else if (ex.claimtype) out.push(`<span class="badge">${esc(ex.claimtype)}</span>`);
  return out.join("");
}

function verdictText(ex) {
  // Verdicts are stored with their own surrounding quotation marks.
  return esc(String(ex.verdict || "").replace(/^["“]|["”]$/g, ""));
}

function voteButton(ex, count) {
  return `<button class="vote-btn" type="button" data-id="${esc(ex.legacy_id)}" aria-pressed="false" aria-label="Upvote this file"><span class="thumb">👍</span><span class="vote-count">${count > 0 ? count : ""}</span></button>`;
}

function shareLinks(ex) {
  const url = `${SITE}/files/${ex.slug}`;
  const text = encodeURIComponent(`${ex.title} — The Donald Files`);
  const u = encodeURIComponent(url);
  return `<a class="btn btn-sm" href="https://twitter.com/intent/tweet?url=${u}&text=${text}" target="_blank" rel="noopener">Share on X</a>
    <a class="btn btn-sm" href="https://api.whatsapp.com/send?text=${text}%20${u}" target="_blank" rel="noopener">WhatsApp</a>
    <a class="btn btn-sm" href="https://bsky.app/intent/compose?text=${text}%20${u}" target="_blank" rel="noopener">Bluesky</a>
    <button class="btn btn-sm" type="button" data-copy="${esc(url)}">Copy link</button>`;
}

function fileContent(ex, count, headingTag) {
  const h = headingTag === "h1" ? `<h1>${esc(ex.title)}</h1>` : `<h2 class="file-title">${esc(ex.title)}</h2>`;
  return `<div class="file">
    <div class="file-meta"><span>Exhibit ${pad(ex.number)}</span><span>${esc(ex.date_label)}</span></div>
    <div class="badges" style="margin-top:12px">${badgesFor(ex)}</div>
    ${h}
    <div class="file-body"><p>${ex.body}</p></div>
    <p class="source">${esc(ex.source)}</p>
    <blockquote class="verdict">${verdictText(ex)}<cite>Curator&rsquo;s take</cite></blockquote>
    <div class="file-actions">${voteButton(ex, count)}<span class="label">Share</span>${shareLinks(ex)}</div>
  </div>`;
}

// ---------------------------------------------------------------- layout

function head({ title, description, canonical, ogType, extra }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#0b0c10">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:site_name" content="The Donald Files">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${OG_IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<link rel="alternate" type="application/rss+xml" title="The Donald Files" href="/rss.xml">
${extra || ""}
</head>
<body>`;
}

function nav() {
  return `<header class="nav"><div class="nav-in">
  <a class="brand" href="/"><span class="brand-dot"></span>THE DONALD FILES</a>
  <nav class="nav-links" aria-label="Main">
    <a href="/#archive">Archive</a>
    <a href="/random">Random</a>
    <a href="/#archive" data-nav-sort="votes">Top voted</a>
    <a href="/#contact">Send a file</a>
  </nav>
  <a class="nav-donate" href="/#support"><span class="long">☕ Keep this nonsense online — </span><span class="short">☕ </span>$3</a>
</div></header>`;
}

function footer() {
  return `<footer>
  <p>Satire and commentary based on publicly reported events. Filed for entertainment, not for the historical record.</p>
  <p class="footer-tagline">Satire. Real events. Sources provided.</p>
  <p>© 2026 hahadonald.com · <a href="/#contact">Contact</a> · <a href="/#contact">Corrections</a> · <a href="/rss.xml">RSS</a></p>
</footer>`;
}

function midNudge(kind) {
  if (kind === "a") {
    return `<div class="mid-nudge"><div><strong>Enjoying the files?</strong><span>Buy the archivist a coffee. Takes ten seconds.</span></div><a class="btn btn-primary" href="/#support">☕ Keep it going — $3</a></div>`;
  }
  return `<div class="mid-nudge"><div><strong>Dozens of files, zero paywall.</strong><span>If it made you laugh, throw a few dollars into the evidence locker.</span></div><a class="btn btn-primary" href="/#support">Help keep the files open — $3</a></div>`;
}

function supportSection() {
  const crypto =
    BTC_ADDRESS || ETH_ADDRESS
      ? `<div class="crypto-tip"><h3>Or send crypto</h3>
        ${BTC_ADDRESS ? `<p class="crypto-label">BTC</p><code class="wallet-address">${esc(BTC_ADDRESS)}</code>` : ""}
        ${ETH_ADDRESS ? `<p class="crypto-label">ETH</p><code class="wallet-address">${esc(ETH_ADDRESS)}</code>` : ""}
      </div>`
      : "";
  return `<section class="support-sec" id="support"><div class="wrap"><div class="support">
    <h2>No Judgment Zone</h2>
    <p class="support-blurb">You don&rsquo;t have to be a little relaxed to enjoy stories about paper towels and Mars logistics. But if you are &mdash; hey, no judgment. A few bucks keeps the servers running either way.</p>
    <div class="amount-row" id="amountRow">
      <button class="amount-btn" data-amount="200" type="button">$2</button>
      <button class="amount-btn is-selected" data-amount="300" type="button">$3</button>
      <button class="amount-btn" data-amount="500" type="button">$5</button>
      <button class="amount-btn" data-amount="1000" type="button">$10</button>
    </div>
    <div class="dare-row">
      <span class="dare-label">Feeling like a big shot? We dare you.</span>
      <div class="custom-amount-box"><span class="dollar-prefix">$</span><input type="number" id="customAmount" min="1" max="50000" step="1" placeholder="10,000" aria-label="Custom amount in dollars"></div>
    </div>
    <div id="expressWrap" hidden>
      <div id="express-checkout"></div>
      <p class="or-divider"><span>or pay by card</span></p>
    </div>
    <div id="payment-element"></div>
    <button id="submitDonate" class="donate-submit" type="button">Continue — $3</button>
    <p id="donateStatus" class="donate-status" role="status"></p>
    ${crypto}
  </div></div></section>`;
}

function contactSection() {
  return `<section class="contact-files" id="contact"><div class="wrap">
    <h2>Questions, corrections, tips</h2>
    <div class="contact-grid">
      <div class="contact-item"><span class="contact-prompt">Got a real story for the files?</span><a href="mailto:files@hahadonald.com">files@hahadonald.com</a></div>
      <div class="contact-item"><span class="contact-prompt">Spot a correction?</span><a href="mailto:corrections@hahadonald.com">corrections@hahadonald.com</a></div>
      <div class="contact-item"><span class="contact-prompt">Want to reach out?</span><a href="mailto:hello@hahadonald.com">hello@hahadonald.com</a></div>
    </div>
  </div></section>`;
}

// ---------------------------------------------------------------- homepage

function card(ex, count) {
  const take = verdictText(ex);
  const haystack = [ex.title, plain(ex.body), take, ex.topic, ex.claimtype, ex.source].join(" ").toLowerCase();
  const facets = ["claimtype", "country", "leader", "adversary", "state", "city"]
    .map((k) => `data-${k}="${esc(ex[k])}"`)
    .join(" ");
  return `<article class="card" data-id="${esc(ex.legacy_id)}" data-num="${ex.number}" data-n="${pad(ex.number)}" data-term="${termOf(ex)}" data-topic="${esc(ex.topic)}" data-group="${esc(groupOf(ex.topic))}" ${facets} data-text="${esc(haystack)}">
  <a class="card-link" href="/files/${ex.slug}" data-open>
    <div class="card-top"><span>№ ${pad(ex.number)}</span><span>${esc(ex.date_label)}</span></div>
    <div class="badges">${badgesFor(ex)}</div>
    <h3>${esc(ex.title)}</h3>
    <p class="take">&ldquo;${take}&rdquo;</p>
  </a>
  <div class="card-foot"><a class="read" href="/files/${ex.slug}" data-open>Read the file →</a>${voteButton(ex, count)}</div>
  <template class="detail"><div class="d-body">${ex.body}</div><p class="d-source">${esc(ex.source)}</p></template>
</article>`;
}

export function renderHomepage({ rows, voteCounts, featured, today }) {
  const total = rows.length;
  const ordered = rows.slice().sort((a, b) => b.number - a.number);
  const topics = new Map();
  for (const r of rows) topics.set(groupOf(r.topic), (topics.get(groupOf(r.topic)) || 0) + 1);
  const topicPills = [...topics.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<button class="pill" type="button" data-topic-pill="${esc(t)}">${esc(t)} <span class="count">${n}</span></button>`)
    .join("");

  const firstCount = rows.filter((r) => termOf(r) === "first").length;
  const secondCount = total - firstCount;
  const fCount = voteCounts[featured.legacy_id] || 0;

  const desc =
    "Real events. Real sources. No invented quotes. An archive of documented Trump incidents, each one sourced, and each one a bit hard to believe.";

  return `${head({
    title: "The Donald Files — real events, real sources, no invented quotes",
    description: desc,
    canonical: SITE + "/",
    ogType: "website",
    extra: '<script src="https://js.stripe.com/v3/" defer></script><script src="/app.js" defer></script>',
  })}
${nav()}

<section class="hero"><div class="wrap">
  <div class="stamp-corner">DECLASSIFIED</div>
  <p class="eyebrow"><span class="pulse"></span>Updated ${esc(today)} · ${total} files and counting</p>
  <h1>The Donald<br><em>Files</em></h1>
  <p class="promise">Real events. Real sources. No invented quotes.</p>
  <p class="sub">${total} documented incidents. Two terms. Still counting.</p>
  <form class="search" role="search" onsubmit="return false">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <label class="sr-only" for="q">Search the files</label>
    <input id="q" type="search" autocomplete="off" placeholder="Search: penguins, Sharpie, Greenland…">
  </form>
  <div class="cta-row">
    <a class="btn btn-primary" href="/random">🎲 Show me a random Donald</a>
    <a class="btn" href="#archive">Browse the archive</a>
  </div>
  <ul class="stats">
    <li><b>${total}</b>files</li>
    <li><b>${firstCount}</b>first term</li>
    <li><b>${secondCount}</b>second term</li>
    <li><b>100%</b>sourced</li>
  </ul>
</div></section>

<section class="featured"><div class="wrap"><div class="featured-card">
  <div class="featured-label"><span class="pulse"></span>Today&rsquo;s declassified file · ${esc(today)}</div>
  <h2><a href="/files/${featured.slug}" data-open data-id="${esc(featured.legacy_id)}">${esc(featured.title)}</a></h2>
  <p class="featured-body">${esc(excerpt(featured.body, 280))}</p>
  <blockquote class="verdict">${verdictText(featured)}<cite>Curator&rsquo;s take</cite></blockquote>
  <div class="featured-actions" style="margin-top:24px">
    <a class="btn btn-primary" href="/files/${featured.slug}" data-open data-id="${esc(featured.legacy_id)}">Read the file →</a>
    ${voteButton(featured, fCount)}
    <a class="btn btn-ghost" href="/random">🎲 Another one</a>
  </div>
  <div class="ghost-num">${pad(featured.number)}</div>
</div></div></section>

<section class="archive wrap" id="archive">
  <div class="archive-head"><h2>The archive</h2><span id="resultsCount" aria-live="polite"></span></div>
  <div class="controls">
    <div class="seg" id="sortSeg">
      <button class="pill is-active" type="button" data-sort="latest">Latest</button>
      <button class="pill" type="button" data-sort="votes">Top voted</button>
      <span style="flex:0 0 12px"></span>
      <button class="pill" type="button" data-term-pill="first">First term <span class="count">${firstCount}</span></button>
      <button class="pill" type="button" data-term-pill="second">Second term <span class="count">${secondCount}</span></button>
    </div>
    <div class="topic-row" id="topicRow">${topicPills}</div>
    <details class="more-filters" id="filterPanel"><summary>More filters</summary><div id="filterGroups"></div><button class="clear-btn" id="clearBtn" type="button">Clear all filters</button></details>
  </div>
  <div class="grid" id="grid">
${ordered.map((ex) => card(ex, voteCounts[ex.legacy_id] || 0)).join("\n")}
  </div>
  <template id="nudgeA">${midNudge("a")}</template>
  <template id="nudgeB">${midNudge("b")}</template>
  <div class="empty" id="empty" hidden>No files match that. Try fewer filters, or a different word.</div>
  <div class="load-more"><button class="btn" id="loadMore" type="button">Load 12 more files</button></div>
</section>

${supportSection()}
${contactSection()}
${footer()}

<dialog class="file-modal" id="fileModal" aria-label="Exhibit"><button class="modal-close" type="button" id="modalClose" aria-label="Close">✕</button><div class="modal-in" id="modalBody"></div></dialog>
<script>window.__STRIPE_PK__=${JSON.stringify(STRIPE_PUBLISHABLE_KEY)};</script>
</body>
</html>`;
}

// ---------------------------------------------------------------- permalink page

function miniCard(ex, count) {
  return `<article class="card" data-id="${esc(ex.legacy_id)}" data-n="${pad(ex.number)}">
  <a class="card-link" href="/files/${ex.slug}">
    <div class="card-top"><span>№ ${pad(ex.number)}</span><span>${esc(ex.date_label)}</span></div>
    <div class="badges">${badgesFor(ex)}</div>
    <h3>${esc(ex.title)}</h3>
    <p class="take">&ldquo;${verdictText(ex)}&rdquo;</p>
  </a>
  <div class="card-foot"><a class="read" href="/files/${ex.slug}">Read the file →</a>${voteButton(ex, count)}</div>
</article>`;
}

export function renderExhibitPage({ ex, voteCount, related, prev, next, voteCounts }) {
  const description = excerpt(ex.body, 200);
  const pageUrl = `${SITE}/files/${ex.slug}`;
  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: ex.title,
    description,
    url: pageUrl,
    publisher: { "@type": "Organization", name: "The Donald Files", url: SITE },
  };
  return `${head({
    title: `${ex.title} — The Donald Files`,
    description,
    canonical: pageUrl,
    ogType: "article",
    extra: `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script><script src="/app.js" defer></script>`,
  })}
${nav()}
<main class="page">
  <div class="page-grid">
    <div>
      <a class="crumb" href="/#archive">← All files</a>
      ${fileContent(ex, voteCount, "h1")}
    </div>
    <div class="donate-card"><div><strong>Enjoyed this one?</strong><span>The archive is free and ad-free. A few dollars keeps it that way.</span></div><a class="btn btn-primary" href="/#support">☕ Keep it online — $3</a></div>
    <nav class="pager" aria-label="More files">
      ${prev ? `<a href="/files/${prev.slug}"><small>← Older file</small><b>${esc(prev.title)}</b></a>` : "<span></span>"}
      ${next ? `<a class="next" href="/files/${next.slug}"><small>Newer file →</small><b>${esc(next.title)}</b></a>` : "<span></span>"}
    </nav>
    <div style="text-align:center"><a class="btn" href="/random">🎲 Show me a random Donald</a></div>
  </div>
  ${
    related.length
      ? `<section class="more"><h2>More from the files</h2><div class="grid">${related.map((r) => miniCard(r, voteCounts[r.legacy_id] || 0)).join("")}</div></section>`
      : ""
  }
</main>
${footer()}
</body>
</html>`;
}

export function renderNotFound() {
  return `${head({
    title: "File not found — The Donald Files",
    description: "That file does not exist, or has been reclassified.",
    canonical: SITE + "/",
    ogType: "website",
  })}
${nav()}
<main class="page"><div class="page-grid" style="text-align:center;padding:60px 0">
  <div class="file-meta" style="justify-content:center"><span>Error 404</span></div>
  <h1 style="font:800 clamp(2.4rem,7vw,4.4rem)/1 var(--font-display);letter-spacing:-.04em;margin:0">This file has been <span style="color:var(--accent)">redacted</span>.</h1>
  <p style="color:var(--muted)">Or it never existed. Either way, there are plenty more.</p>
  <div><a class="btn btn-primary" href="/random">🎲 Show me a random Donald</a> <a class="btn" href="/">Back to the archive</a></div>
</div></main>
${footer()}
</body>
</html>`;
}
