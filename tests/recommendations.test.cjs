const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = name => fs.readFileSync(path.join(root, 'assets', name), 'utf8');
const CACHE = 'dat:country:v1';
const ENTRY = 'dat:recommendation-entry:v1';
const flush = () => new Promise(resolve => setImmediate(resolve));

function page(options = {}) {
  const dom = new JSDOM(fs.readFileSync(path.join(root, options.file || 'index.html'), 'utf8'), {
    url: options.url || 'https://www.datgamesstudio.com/', runScripts: 'outside-only', pretendToBeVisual: true,
  });
  const w = dom.window;
  let time = Date.now();
  let nextTimer = 0;
  const timers = new Map();
  const events = [];
  const requests = [];
  w.Date.now = () => time;
  w.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { at: time + delay, fn }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.gtag = (_, name, params) => events.push({ name, ...params });
  Object.defineProperty(w.navigator, 'languages', { value: options.languages || ['en'] });
  if (options.cache) w.sessionStorage.setItem(CACHE, JSON.stringify({ country: options.cache, at: time - (options.cacheAge || 0) }));
  if (options.entry) w.sessionStorage.setItem(ENTRY, JSON.stringify(options.entry));
  if (options.blockStorage) Object.defineProperty(w, 'sessionStorage', { get() { throw new Error('blocked'); } });
  w.fetch = (...args) => {
    requests.push(args);
    return options.fetch ? options.fetch(...args) : Promise.resolve({ ok: true, text: async () => options.country || 'IN\n' });
  };
  w.eval(source('analytics.js'));
  w.document.addEventListener('click', event => event.preventDefault());
  if (!options.analyticsOnly) {
    w.eval(source('game-catalog.js'));
    w.eval(source('recommendations-config.js'));
    w.DATRecommendationsConfig = { ...w.DATRecommendationsConfig, ...options.config };
    w.eval(source('recommendations.js'));
  }
  const advance = async ms => {
    time += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= time && timers.delete(id)) timer.fn();
    await flush();
  };
  const featured = () => [...w.document.querySelectorAll('[data-featured-game]')].map(el => el.dataset.featuredGame);
  return { dom, w, events, requests, advance, featured, elapse: ms => { time += ms; } };
}

test('country profiles change hero copy, catalog order and existing play links together', async () => {
  const scenarios = {
    US: ['hearts', 'spades'], IN: ['callbreak', 'twenty-nine'], BD: ['twenty-nine', 'bray'],
    SA: ['tarneeb', 'hokm'], AE: ['tarneeb', 'hokm'], EG: ['tarneeb', 'hokm'],
    IR: ['hokm', 'tarneeb'], NP: ['callbreak', 'twenty-nine'], GB: ['hearts', 'callbreak'],
  };
  for (const [country, pair] of Object.entries(scenarios)) {
    const p = page({ country });
    await flush();
    const featured = [...pair, 'snake-uncoil'];
    assert.deepEqual(p.featured(), featured, country);
    assert.equal(p.w.DATRecommendationContext.recommendation_source, 'ip');
    assert.equal(p.w.document.querySelector('[data-recommendations]').dataset.recommendationStatus, 'ready');
    assert.deepEqual([...p.w.document.querySelectorAll('.play-tile')].slice(0, 3).map(el => el.getAttribute('href')), featured.map(slug => `/play/${slug}/`));
    assert.equal(p.w.document.querySelectorAll('.game-card').length, 11);
    assert.equal(p.w.document.querySelectorAll('.play-tile').length, 9);
    assert.deepEqual([...p.w.document.querySelectorAll('[data-regional-screen]')].map(el => el.getAttribute('src')), [pair[1], pair[0], 'snake-uncoil'].map(slug => p.w.DATGameCatalog.games[slug].screen));
    assert.equal(p.events.filter(event => event.name === 'recommendation_view').length, 1);
    for (const game of Object.values(p.w.DATGameCatalog.games)) {
      for (const asset of [game.icon, game.screen, `${game.play}index.html`]) assert.ok(fs.existsSync(path.join(root, asset)), asset);
    }
    assert.equal(p.requests[0][1].credentials, 'omit');
    assert.equal(p.requests[0][1].referrerPolicy, 'no-referrer');
    p.dom.window.close();
  }
});

test('the play hub uses the same regional order without removing rules or puzzle links', async () => {
  const p = page({ file: 'play/index.html', url: 'https://www.datgamesstudio.com/play/', country: 'BD' });
  await flush();
  assert.deepEqual([...p.w.document.querySelectorAll('.phc-main')].slice(0, 3).map(el => el.getAttribute('href')), ['/play/twenty-nine/', '/play/bray/', '/play/snake-uncoil/']);
  assert.equal(p.w.document.querySelectorAll('.play-hub-card').length, 9);
  assert.ok(p.w.document.querySelector('.phc-daily[data-daily-teaser="twenty-nine"]'));
  p.dom.window.close();
});

test('fresh cached IP wins over locale without another request; expired country is refreshed', async () => {
  const p = page({ cache: 'BD', languages: ['en-US'] });
  assert.deepEqual(p.featured().slice(0, 2), ['twenty-nine', 'bray']);
  assert.equal(p.w.DATRecommendationContext.recommendation_source, 'cache');
  assert.equal(p.requests.length, 0);
  p.dom.window.close();
  const expired = page({ cache: 'BD', cacheAge: 24 * 60 * 60 * 1000 + 1, country: 'SA' });
  await flush();
  assert.deepEqual(expired.featured().slice(0, 2), ['tarneeb', 'hokm']);
  expired.dom.window.close();
});

test('unavailable lookups, invalid responses and blocked storage retain playable choices', async () => {
  for (const options of [
    { fetch: () => Promise.reject(new Error('offline')) },
    { country: '<script>bad</script>' }, { country: 'XX' },
    { fetch: async () => ({ ok: false }) }, { blockStorage: true },
  ]) {
    const p = page({ ...options, languages: ['bn-BD'] });
    await flush();
    assert.equal(p.featured().length, 3);
    for (const link of p.w.document.querySelectorAll('.hero-game-play')) assert.ok(link.pathname.startsWith('/play/'));
    if (!options.blockStorage) assert.deepEqual(p.featured().slice(0, 2), ['twenty-nine', 'bray']);
    assert.equal(p.w.document.querySelector('[data-recommendations]').dataset.recommendationStatus, 'ready');
    p.dom.window.close();
  }
});

test('lookup deadline freezes choices but saves a late country for the next navigation', async () => {
  let resolve;
  const p = page({ languages: ['en-US'], fetch: () => new Promise(done => { resolve = done; }) });
  await p.advance(601);
  const before = p.w.document.querySelector('.hero-game-play');
  resolve({ ok: true, text: async () => 'BD' });
  await flush();
  assert.strictEqual(p.w.document.querySelector('.hero-game-play'), before);
  assert.deepEqual(p.featured().slice(0, 2), ['hearts', 'spades']);
  assert.equal(JSON.parse(p.w.sessionStorage.getItem(CACHE)).country, 'BD');
  assert.equal(p.events.find(event => event.name === 'recommendation_lookup').result, 'late');
  p.dom.window.close();
});

test('touch, hover and keyboard focus cannot have their destination replaced by a response', async () => {
  for (const kind of ['pointerdown', 'touchstart', 'pointerover', 'focusin']) {
    let resolve;
    const p = page({ languages: ['en-US'], fetch: () => new Promise(done => { resolve = done; }) });
    const link = p.w.document.querySelector('.hero-game-play');
    link.dispatchEvent(new p.w.Event(kind, { bubbles: true }));
    resolve({ ok: true, text: async () => 'BD' });
    await flush();
    assert.strictEqual(p.w.document.querySelector('.hero-game-play'), link, kind);
    assert.equal(link.pathname, '/play/hearts/');
    p.dom.window.close();
  }
});

test('elapsed budget is enforced even when a busy main thread delays timeout callbacks', async () => {
  let resolve;
  const p = page({ languages: ['en-US'], fetch: () => new Promise(done => { resolve = done; }) });
  p.elapse(700);
  resolve({ ok: true, text: async () => 'BD' });
  await flush();
  assert.deepEqual(p.featured().slice(0, 2), ['hearts', 'spades']);
  assert.equal(p.events.find(event => event.name === 'recommendation_lookup').result, 'late');
  p.dom.window.close();
});

test('a hung request is aborted, and generic English does not infer a US country', async () => {
  const p = page({ fetch: (_, options) => new Promise((_, reject) => options.signal.addEventListener('abort', () => reject({ name: 'AbortError' }))) });
  assert.deepEqual(p.featured(), ['hearts', 'callbreak', 'snake-uncoil']);
  assert.equal(p.w.DATRecommendationContext.recommendation_source, 'default');
  await p.advance(3001);
  assert.equal(p.events.find(event => event.name === 'recommendation_lookup').result, 'timeout');
  assert.equal(p.w.document.querySelector('[data-recommendations]').dataset.recommendationStatus, 'ready');
  p.dom.window.close();
});

test('disabled recommendations and local previews make no external requests', () => {
  for (const options of [{ config: { enabled: false }, languages: ['en-US'] }, { url: 'http://127.0.0.1:8000/' }]) {
    const p = page(options);
    assert.equal(p.requests.length, 0);
    assert.equal(p.featured().length, 3);
    p.dom.window.close();
  }
});

test('JSON country responses support the optional Worker', async () => {
  const p = page({ country: '{"country":"IR"}' });
  await flush();
  assert.deepEqual(p.featured().slice(0, 2), ['hokm', 'tarneeb']);
  p.dom.window.close();
});

test('recommendation click attribution survives navigation and follows actual engagement', async () => {
  const home = page({ country: 'BD' });
  await flush();
  home.w.document.querySelectorAll('.hero-game-play')[1].click();
  const click = home.events.findLast(event => event.name === 'play_click');
  assert.equal(click.game, 'bray');
  assert.equal(click.placement, 'hero_featured');
  assert.equal(click.recommendation_position, 2);
  const entry = JSON.parse(home.w.sessionStorage.getItem(ENTRY));
  const game = page({ file: 'play/bray/index.html', url: 'https://www.datgamesstudio.com/play/bray/', analyticsOnly: true, entry });
  game.w.DATAnalytics.startMatch();
  game.w.DATAnalytics.cardPlayed();
  const engaged = game.events.find(event => event.name === 'game_engaged');
  assert.equal(engaged.recommendation_region, 'bangladesh');
  assert.equal(engaged.recommendation_position, 2);
  assert.equal(engaged.entry_placement, 'hero_featured');
  assert.ok(game.events.every(event => !JSON.stringify(event).includes('"ip":')));
  for (const changed of [{ ...entry, game: 'hearts' }, { ...entry, at: Date.now() - 31 * 60 * 1000 }, { ...entry, recommendation_set: 'untrusted' }]) {
    const unrelated = page({ file: 'play/bray/index.html', url: 'https://www.datgamesstudio.com/play/bray/', analyticsOnly: true, entry: changed });
    unrelated.w.DATAnalytics.startMatch();
    assert.equal(unrelated.events[0].recommendation_region, undefined);
    unrelated.dom.window.close();
  }
  game.dom.window.close(); home.dom.window.close();
});

test('static HTML provides three working choices when JavaScript is unavailable', () => {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
  assert.equal(dom.window.document.querySelectorAll('.hero-game-play').length, 3);
  assert.equal(dom.window.document.querySelector('.hero-play-more'), null);
  dom.window.close();
});
