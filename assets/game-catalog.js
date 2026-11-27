// One registry for recommendation copy and routes. Asset names intentionally
// differ from URL slugs for Twenty Nine and Snake Uncoil.
(() => {
  const games = {
    hearts: { name: "Hearts", description: "Dodge hearts. Shoot the moon.", asset: "hearts" },
    spades: { name: "Spades", description: "Bid together. Win as partners.", asset: "spades" },
    callbreak: { name: "Callbreak", description: "Call your tricks. Spades are trump.", asset: "callbreak" },
    "twenty-nine": { name: "29", description: "Bid, choose trump, chase points.", asset: "twentynine" },
    bray: { name: "Bray", description: "Hearts-style strategy, Bengali flavour.", asset: "bray" },
    tarneeb: { name: "Tarneeb", description: "Partnership bidding. Your-choice trump.", asset: "tarneeb" },
    hokm: { name: "Hokm", description: "Name the trump. Race to seven tricks.", asset: "hokm" },
    whist: { name: "Whist", description: "Pure partnership trick-taking.", asset: "whist" },
    "snake-uncoil": { name: "Snake Uncoil", description: "A change of pace: free every snake.", asset: "snakeuncoil" },
  };
  for (const [slug, game] of Object.entries(games)) {
    game.play = `/play/${slug}/`;
    game.icon = `/assets/img/icons/${game.asset}.png`;
    game.screen = `/assets/img/screens/${game.asset}.webp`;
    Object.freeze(game);
  }
  const profiles = {
    us: ["hearts", "spades", "snake-uncoil"],
    india: ["callbreak", "twenty-nine", "snake-uncoil"],
    bangladesh: ["twenty-nine", "bray", "snake-uncoil"],
    "middle-east": ["tarneeb", "hokm", "snake-uncoil"],
    iran: ["hokm", "tarneeb", "snake-uncoil"],
    global: ["hearts", "callbreak", "snake-uncoil"],
  };
  Object.values(profiles).forEach(Object.freeze);
  // Explicit market choices, not a geographic access restriction. Every game
  // remains available everywhere. Egypt joins the Arabic-speaking profile.
  const arabicMarkets = new Set(["AE", "BH", "EG", "IQ", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "YE"]);
  const regionFor = (country) => {
    if (country === "US") return "us";
    if (country === "IN" || country === "NP") return "india";
    if (country === "BD") return "bangladesh";
    if (country === "IR") return "iran";
    return arabicMarkets.has(country) ? "middle-east" : "global";
  };
  window.DATGameCatalog = Object.freeze({ games: Object.freeze(games), profiles: Object.freeze(profiles), regionFor });
})();
