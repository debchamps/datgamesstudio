// Kill switch retains the three static HTML choices. A deployed country Worker
// can replace this URL; recommendations.js accepts either country text or JSON.
window.DATRecommendationsConfig = Object.freeze({
  enabled: true,
  endpoint: "https://get.geojs.io/v1/ip/country",
  updateBudgetMs: 600,
  requestTimeoutMs: 3000,
  cacheTtlMs: 24 * 60 * 60 * 1000,
});
