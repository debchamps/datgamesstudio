// Public country-only API. CORS limits browser callers, not access to a secret;
// requests without Origin are also safe because this contains no private data.
export default {
  fetch(request, env = {}) {
    const origin = request.headers.get("Origin");
    const allowed = (env.ALLOWED_ORIGINS || "https://www.datgamesstudio.com,https://datgamesstudio.com")
      .split(",").map(value => value.trim()).filter(Boolean);
    const headers = new Headers({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
    });
    if (origin && !allowed.includes(origin)) return new Response('{"error":"origin not allowed"}', { status: 403, headers });
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    const url = new URL(request.url);
    if (!["/", "/api/region"].includes(url.pathname)) return new Response('{"error":"not found"}', { status: 404, headers });
    headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (!["GET", "HEAD"].includes(request.method)) {
      headers.set("Allow", "GET, HEAD, OPTIONS");
      return new Response('{"error":"method not allowed"}', { status: 405, headers });
    }
    const value = request.cf?.country;
    const country = typeof value === "string" && /^[A-Z]{2}$/.test(value) && !["XX", "ZZ"].includes(value) ? value : null;
    // Never echo request headers, IP, coordinates, query parameters or URLs.
    return new Response(request.method === "HEAD" ? null : JSON.stringify({ country }), { headers });
  },
};
