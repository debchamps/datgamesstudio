const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const analytics = fs.readFileSync(path.join(root, 'assets/analytics.js'), 'utf8');

function page(file = 'index.html', url = 'https://www.datgamesstudio.com/') {
  // No resources are loaded: all gtag calls are captured without network access.
  const dom = new JSDOM(fs.readFileSync(path.join(root, file), 'utf8'), { url, runScripts: 'outside-only' });
  const events = [];
  dom.window.gtag = (kind, name, params) => events.push({ kind, name, ...params });
  dom.window.eval(analytics);
  dom.window.document.addEventListener('click', e => e.preventDefault());
  return { dom, window: dom.window, document: dom.window.document, events };
}
const count = (events, name) => events.filter(e => e.name === name).length;

test('clicks identify game and placement, including nested icons and store developer links', () => {
  const { dom, document: d, events } = page();
  d.querySelector('.hero-play a span').click();
  assert.equal(events.at(-1).name, 'play_click');
  assert.equal(events.at(-1).game, 'callbreak');
  assert.equal(events.at(-1).placement, 'hero');
  d.querySelector('#game-hearts a[href*="apps.apple.com"]').click();
  assert.equal(events.at(-1).game, 'hearts');
  assert.equal(events.at(-1).store, 'app_store');
  assert.equal(events.at(-1).placement, 'game_card');
  d.querySelector('.site-footer a[href*="apps.apple.com"]').click();
  assert.equal(events.at(-1).game, 'all_games');
  assert.equal(events.at(-1).placement, 'footer');
  d.querySelector('a[href="#game-twentynine"]').click();
  assert.equal(events.at(-1).game, 'twenty-nine');
  d.querySelector('[data-filter="card"]').click();
  assert.equal(events.at(-1).action, 'filter_card');
  assert.equal(count(events, 'play_click'), 1);
  assert.ok(events.every(e => e.send_to === 'G-677P55P83T'));
  dom.window.close();
});

test('guide links distinguish sidebar from bottom download section', () => {
  const { dom, document: d, events } = page('how-to-play/hearts/index.html', 'https://www.datgamesstudio.com/how-to-play/hearts/');
  d.querySelector('.guide-side a[href*="play.google.com"]').click();
  assert.equal(events.at(-1).placement, 'guide_sidebar');
  assert.equal(events.at(-1).page_type, 'guide');
  d.querySelector('.guide-cta a[href*="play.google.com"]').click();
  assert.equal(events.at(-1).placement, 'guide_download');
  assert.equal(events.at(-1).game, 'hearts');
  assert.ok(!events.at(-1).link_url.includes('?'));
  dom.window.close();
});

test('match lifecycle deduplicates results and resets engagement on replay', () => {
  const { dom, window: w, events } = page('play/bray/index.html', 'https://www.datgamesstudio.com/play/bray/');
  const a = w.DATAnalytics;
  a.startMatch();
  assert.equal(count(events, 'game_engaged'), 0);
  a.cardPlayed(); a.cardPlayed();
  a.roundFinish({ round_number: 1, result: 'clean' });
  a.roundFinish({ round_number: 1, result: 'clean' });
  a.finishMatch({ result: 'won' }); a.finishMatch({ result: 'won' });
  assert.equal(count(events, 'game_engaged'), 1);
  assert.equal(count(events, 'round_finish'), 1);
  assert.equal(count(events, 'match_finish'), 1);
  assert.equal(events.at(-1).cards_played, 2);
  assert.equal(events.at(-1).rounds_completed, 1);
  const again = w.document.createElement('button'); again.setAttribute('data-again', '');
  a.startMatch({ currentTarget: again }); a.cardPlayed();
  assert.equal(count(events, 'game_engaged'), 2);
  assert.equal(events.findLast(e => e.name === 'game_start').action, 'play_again');
  a.startMatch({ currentTarget: w.document.querySelector('[data-new]') });
  assert.equal(count(events, 'match_restart'), 1);
  assert.ok(events.every(e => e.game === 'bray'));
  dom.window.close();
});

test('localhost and file previews do not emit events', () => {
  for (const url of ['http://localhost:8000/', 'http://127.0.0.1:8000/', 'file:///tmp/index.html']) {
    const { dom, window: w, events } = page('index.html', url);
    w.datTrack('test_event');
    assert.equal(events.length, 0);
    dom.window.close();
  }
});

test('every tagged page loads one shared tracker before its game module', () => {
  function check(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (['.git', 'node_modules'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { check(file); continue; }
      if (!file.endsWith('.html')) continue;
      const html = fs.readFileSync(file, 'utf8');
      if (!html.includes('G-677P55P83T')) continue;
      assert.equal((html.match(/src="\/assets\/analytics.js\?v=1"/g) || []).length, 1, file);
      assert.ok(!html.includes('var DAT_APPS'), file);
      const module = html.indexOf('<script type="module"');
      if (module !== -1) assert.ok(html.indexOf('/assets/analytics.js') < module, file);
    }
  }
  check(root);
});

// Execute the real ES modules in a DOM, with short timers and no browser/server.
// This catches missing hooks, wrong state fields and Bray/Hearts attribution.
async function loadGame(dom, game) {
  const context = dom.getInternalVMContext();
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const mod = new vm.SourceTextModule(fs.readFileSync(file, 'utf8'), { context, identifier: file });
    cache.set(file, mod);
    return mod;
  };
  const entry = load(path.join(root, 'play', game === 'bray' ? 'hearts' : game, 'app.js'));
  await entry.link((specifier, parent) => load(path.resolve(path.dirname(parent.identifier), specifier)));
  const schedule = dom.window.setTimeout.bind(dom.window);
  dom.window.setTimeout = (fn) => schedule(fn, 0);
  await entry.evaluate();
}
const delay = () => new Promise(r => setTimeout(r, 2));
const visible = el => el && !el.disabled && !el.closest('[hidden]');

for (const game of ['callbreak', 'twenty-nine', 'hearts', 'spades', 'bray', 'tarneeb', 'hokm', 'whist']) {
  test(`${game}: real game play emits engagement, round result, and controls`, async () => {
    const { dom, document: d, events } = page(`play/${game}/index.html`, `https://www.datgamesstudio.com/play/${game}/?fast`);
    const errors = [];
    dom.window.addEventListener('error', e => errors.push(e.error));
    try {
      await loadGame(dom, game);
      assert.equal(count(events, 'game_start'), 1);
      assert.equal(count(events, 'game_engaged'), 0);
      for (let i = 0; i < 40000 && !count(events, 'match_finish'); i++) {
        const pass = d.querySelector('[data-pass]');
        if (pass && !pass.hidden) {
          d.querySelector('[data-hint]').click();
          d.querySelector('[data-pass-btn]').click();
        } else {
          const button = [...d.querySelectorAll('.hand-card.is-legal, .bid-pass, .bid-no, .bid-btn, .suit-btn, [data-reveal], [data-next]')].find(visible);
          if (button) button.click();
        }
        await delay();
      }
      assert.deepEqual(errors, []);
      assert.equal(count(events, 'game_engaged'), 1);
      assert.ok(count(events, 'round_finish') >= 1);
      assert.equal(count(events, 'match_finish'), 1);
      const finish = events.find(e => e.name === 'match_finish');
      assert.equal(finish.rounds_completed, count(events, 'round_finish'));
      assert.ok(finish.cards_played > 0);
      assert.equal(events.find(e => e.name === 'round_finish').round_number, 1);
      assert.ok(events.every(e => e.game === game));
      d.querySelector('[data-next]').click();
      assert.equal(count(events, 'match_finish'), 1, 'viewing final result must not duplicate completion');
      d.querySelector('[data-new]').click();
      assert.equal(events.findLast(e => e.name === 'game_control').action, 'new_match');
      assert.equal(events.findLast(e => e.name === 'game_start').action, 'new_match');
    } finally { dom.window.close(); }
  });
}
