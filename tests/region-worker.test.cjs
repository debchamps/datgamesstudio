const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const worker = import(pathToFileURL(path.join(__dirname, '../worker/region.mjs')));

async function call({ origin, country = 'IN', method = 'GET', pathname = '/' } = {}) {
  const { default: handler } = await worker;
  const request = new Request(`https://region.example${pathname}`, { method, headers: origin ? { Origin: origin, 'CF-Connecting-IP': '192.0.2.7' } : {} });
  Object.defineProperty(request, 'cf', { value: { country, city: 'not returned', latitude: 'not returned' } });
  return handler.fetch(request);
}

test('public endpoint returns only edge country and never caches a visitor response', async () => {
  const response = await call({ origin: 'https://www.datgamesstudio.com' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { country: 'IN' });
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://www.datgamesstudio.com');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('CDN-Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Vary'), 'Origin');
  assert.deepEqual(await (await call()).json(), { country: 'IN' });
  assert.deepEqual(await (await call({ country: 'XX' })).json(), { country: null });
});

test('CORS allows the site, rejects other browser origins, and limits methods and paths', async () => {
  const denied = await call({ origin: 'https://unrelated.example' });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await call({ origin: 'https://datgamesstudio.com', method: 'OPTIONS' })).status, 204);
  assert.equal((await call({ method: 'POST' })).status, 405);
  assert.equal((await call({ pathname: '/private' })).status, 404);
  assert.equal((await call({ pathname: '/api/region' })).status, 200);
  assert.equal(await (await call({ method: 'HEAD' })).text(), '');
});
