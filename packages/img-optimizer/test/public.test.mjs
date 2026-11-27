import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createOptimizer } from 'img-optimizer/server';
import { noisyJpeg, solidJpeg, photoStore } from './fixtures.mjs';

test('a public answer keeps its headers, and each load answer gets its own', async () => {
  const jpeg = await solidJpeg(720, 500, 'blue');
  const optimize = createOptimizer();
  let loads = 0;
  const publicAnswers = await Promise.all(
    [0, 1].map(() =>
      optimize({
        url: '/img-optimizer?src=/photo.jpg&size=360',
        headers: { accept: 'image/webp' },
        loadStaticAsset: () => {
          loads++;
          return jpeg;
        },
      })
    )
  );
  assert.equal(loads, 1);
  assert.deepEqual(
    publicAnswers.map(r => r.headers),
    Array(2).fill({
      'Content-Type': 'image/webp',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
  );
  const store = await photoStore();
  const privateAnswers = await Promise.all(
    ['size=360', 'size=360&v=v1', 'size=360&v=v0'].map(query =>
      optimize({
        url: `/photos/5/image?${query}`,
        headers: { accept: 'image/webp' },
        load: store.load,
      })
    )
  );
  assert.equal(store.calls.length, 1);
  assert.deepEqual(
    privateAnswers.map(
      r => `${r.status} ${r.headers['Cache-Control']} ${r.headers.Vary}`
    ),
    [
      '200 private, no-cache Accept',
      '200 private, max-age=86400 Accept',
      '200 private, no-cache Accept',
    ]
  );
});

test('a narrower image redirects to its width on the same path', async () => {
  const jpeg = await solidJpeg(1200, 800, 'blue');
  const optimize = createOptimizer();
  const query = '?src=/photo.jpg&size=1600';
  const requests = [
    ['/photos/a' + query, '/photos/a'],
    ['/img-optimizer' + query, '/img-optimizer'],
    ['/gallery/img-optimizer' + query, '/gallery/img-optimizer'],
    ['http://localhost:3041/gallery/photo' + query, '/gallery/photo'],
    ['http://app.example.com:3041/gallery/photo' + query, '/gallery/photo'],
    [
      new URL('/gallery/img-optimizer' + query, 'http://localhost'),
      '/gallery/img-optimizer',
    ],
    [
      'http://localhost//evil.com/img-optimizer' + query,
      '/evil.com/img-optimizer',
    ],
  ];
  const answers = await Promise.all(
    requests.map(([url]) =>
      optimize({
        url,
        headers: { accept: 'image/webp' },
        loadStaticAsset: () => jpeg,
      })
    )
  );
  assert.deepEqual(
    answers.map(({ status, headers }) => `${status} ${headers.Location}`),
    requests.map(([, path]) => `302 ${path}?src=%2Fphoto.jpg&size=1200`)
  );
});

test('a redirect keeps the quality asked for, even with another cached', async () => {
  const jpeg = await noisyJpeg(1200, 800);
  const request = (optimize, url) =>
    optimize({
      url,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => jpeg,
    });
  const optimize = createOptimizer({ qualities: [30] });
  const warm = await request(optimize, '/photos/a?src=/photo.jpg&size=1200');
  const [redirect, unlisted] = await Promise.all(
    [30, 70].map(quality =>
      request(optimize, `/photos/a?src=/photo.jpg&size=1600&quality=${quality}`)
    )
  );
  assert.deepEqual(
    [redirect.headers.Location, unlisted.headers.Location],
    [
      '/photos/a?src=%2Fphoto.jpg&size=1200&quality=30',
      '/photos/a?src=%2Fphoto.jpg&size=1200&quality=70',
    ]
  );
  const followed = await request(optimize, redirect.headers.Location);
  const direct = await request(
    createOptimizer(),
    '/photos/a?src=/photo.jpg&size=1200&quality=30'
  );
  assert.equal(followed.body.length, direct.body.length);
  assert.notEqual(followed.body.length, warm.body.length);
});

test('a redirect keeps an src that has its own query', async () => {
  const jpeg = await solidJpeg(1200, 800, 'blue');
  const src = '/photos/6?v=1&w=2';
  const { status, headers } = await createOptimizer()({
    url: `/photos/6/image?src=${encodeURIComponent(src)}&size=1600`,
    headers: { accept: 'image/webp' },
    loadStaticAsset: () => jpeg,
  });
  assert.equal(status, 302);
  const location = new URL(headers.Location, 'http://localhost');
  assert.equal(location.searchParams.get('src'), src);
  assert.equal(location.searchParams.get('size'), '1200');
});

test('a failed load is not kept, so the next request loads again', async t => {
  t.mock.method(console, 'error', () => {});
  const jpeg = await solidJpeg(720, 500, 'blue');
  let loads = 0;
  let failing = true;
  const loadStaticAsset = async () => {
    loads++;
    if (failing) throw new Error('storage timed out');
    return jpeg;
  };
  const optimize = createOptimizer();
  const request = (size = 360) =>
    optimize({
      url: `/img-optimizer?src=/photo.jpg&size=${size}`,
      headers: { accept: 'image/webp' },
      loadStaticAsset,
    });
  const failed = await Promise.all([request(360), request(640)]);
  assert.deepEqual(
    failed.map(r => r.status),
    [400, 400]
  );
  assert.equal(loads, 1);
  failing = false;
  assert.equal((await request()).status, 200);
  assert.equal((await request(640)).status, 200);
  assert.equal(loads, 2);
});

test('simultaneous requests share one read and one encode per variant', async t => {
  const jpeg = await noisyJpeg(1200, 800);
  const encodes = t.mock.method(sharp.prototype, 'toBuffer');
  let loads = 0;
  const optimize = createOptimizer();
  const answers = await Promise.all(
    [360, 360, 360, 360, 640, 640].map(size =>
      optimize({
        url: `/img-optimizer?src=/photo.jpg&size=${size}`,
        headers: { accept: 'image/webp' },
        loadStaticAsset: async () => {
          loads++;
          return jpeg;
        },
      })
    )
  );
  assert.deepEqual(
    answers.map(r => r.status),
    [200, 200, 200, 200, 200, 200]
  );
  assert.equal(loads, 1);
  assert.equal(encodes.mock.callCount(), 2);
});

test('a width asked for while another encodes shares its read', async t => {
  const photo = await noisyJpeg(1200, 800);
  const toBuffer = sharp.prototype.toBuffer;
  let encodeStarted;
  const encoding = new Promise(resolve => (encodeStarted = resolve));
  t.mock.method(sharp.prototype, 'toBuffer', function (...args) {
    encodeStarted();
    return toBuffer.apply(this, args);
  });
  let loads = 0;
  // Too small to cache the original, so only the in-flight read can be shared.
  const optimize = createOptimizer({
    cacheSizeMb: photo.length / 2 / 1024 / 1024,
  });
  const request = size =>
    optimize({
      url: `/img-optimizer?src=/photo.jpg&size=${size}`,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => {
        loads++;
        return photo;
      },
    });
  const first = request(1024);
  await encoding;
  assert.equal((await request(500)).status, 400);
  const answers = await Promise.all([first, request(640)]);
  assert.deepEqual(
    answers.map(r => r.status),
    [200, 200]
  );
  assert.equal(loads, 1);
});
