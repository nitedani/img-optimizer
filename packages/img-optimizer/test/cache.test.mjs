import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createOptimizer } from 'img-optimizer/server';
import { ImageCache } from '../lib/server/cache.js';
import { noisyJpeg } from './fixtures.mjs';

test('a redirect counts against cacheSizeMb, so 0 keeps none', async () => {
  const narrow = await noisyJpeg(500, 300);
  for (const [cacheSizeMb, expectedLoads] of [
    [0, 2],
    [1 / 1024, 1],
  ]) {
    let loads = 0;
    const optimize = createOptimizer({ cacheSizeMb });
    for (let i = 0; i < 2; i++) {
      const { status } = await optimize({
        url: '/img-optimizer?src=/narrow.jpg&size=640',
        headers: { accept: 'image/webp' },
        loadStaticAsset: () => {
          loads++;
          return narrow;
        },
      });
      assert.equal(status, 302);
    }
    assert.equal(loads, expectedLoads, `cacheSizeMb: ${cacheSizeMb}`);
  }
});

test('a photo reuses its cached original across widths beside cached variants', async () => {
  const [filler, photo] = await Promise.all([
    noisyJpeg(1200, 800),
    noisyJpeg(1200, 800),
  ]);
  let loads = 0;
  const optimize = createOptimizer();
  const request = (src, size) =>
    optimize({
      url: `/img-optimizer?src=${src}&size=${size}`,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => {
        if (src !== '/photo.jpg') return filler;
        loads++;
        return photo;
      },
    });
  for (let i = 0; i < 12; i++) {
    assert.equal((await request(`/filler-${i}.jpg`, 640)).status, 200);
  }
  const readsAfterEach = [];
  for (const size of [1024, 640, 360]) {
    assert.equal((await request('/photo.jpg', size)).status, 200);
    readsAfterEach.push(loads);
  }
  assert.deepEqual(readsAfterEach, [1, 1, 1]);
});

test('a large original never evicts warm thumbnails to stay cached', async () => {
  const [large, ...thumbnails] = await Promise.all([
    noisyJpeg(1600, 1100),
    ...Array.from({ length: 4 }, () => noisyJpeg(450, 300)),
  ]);
  const photos = [...thumbnails, large];
  const request = (optimize, i) =>
    optimize({
      url: `/img-optimizer?src=/photo-${i}.jpg&size=360`,
      headers: { accept: 'image/webp' },
    });
  const measure = createOptimizer({
    loadStaticAsset: src => photos[src.match(/\d+/)[0]],
  });
  const variants = [];
  for (const i of photos.keys()) {
    variants.push((await request(measure, i)).body.length);
  }
  // Room for the large original beside its own variant, not beside all five.
  const cacheBytes = large.length + variants[4] + Math.min(...variants) / 2;
  const loads = [0, 0, 0, 0, 0];
  const optimize = createOptimizer({
    cacheSizeMb: cacheBytes / 1024 / 1024,
    loadStaticAsset: src => {
      const i = src.match(/\d+/)[0];
      loads[i]++;
      return photos[i];
    },
  });
  for (const i of photos.keys()) {
    assert.equal((await request(optimize, i)).status, 200);
  }
  const revisits = await Promise.all(
    [0, 1, 2, 3].map(i => request(optimize, i))
  );
  assert.ok(revisits.every(r => r.status === 200));
  assert.deepEqual(loads.slice(0, 4), [1, 1, 1, 1]);
});

test('an original is kept in the room left once a new variant evicts others', async () => {
  const [wide, photo] = await Promise.all([
    noisyJpeg(1024, 720),
    noisyJpeg(850, 580),
  ]);
  const sources = { '/wide.jpg': wide, '/photo.jpg': photo };
  const queries = [
    'src=/wide.jpg&size=1024&quality=100',
    'src=/photo.jpg&size=360',
    'src=/photo.jpg&size=640',
  ];
  const request = (optimize, query) =>
    optimize({
      url: `/img-optimizer?${query}`,
      headers: { accept: 'image/webp' },
    });
  const measure = createOptimizer({ loadStaticAsset: src => sources[src] });
  const sizes = [];
  for (const query of queries) {
    sizes.push((await request(measure, query)).body.length);
  }
  // The 360 variant evicts the wide one; the photo then fits beside its two.
  const cacheBytes = sizes[0] + sizes[1] / 2;
  assert.ok(photo.length + sizes[1] + sizes[2] <= cacheBytes);
  const loads = [];
  const optimize = createOptimizer({
    cacheSizeMb: cacheBytes / 1024 / 1024,
    loadStaticAsset: src => {
      loads.push(src);
      return sources[src];
    },
  });
  for (const query of queries) {
    assert.equal((await request(optimize, query)).status, 200);
  }
  assert.deepEqual(loads, ['/wide.jpg', '/photo.jpg']);
});

test('a width outside sizes keeps its original for the next width, never over a variant', async () => {
  const photo = await noisyJpeg(1200, 800);
  let loads = 0;
  const request = (optimize, size) =>
    optimize({
      url: `/img-optimizer?src=/photo.jpg&size=${size}`,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => {
        loads++;
        return photo;
      },
    });
  const optimize = createOptimizer();
  const statuses = [];
  for (const size of [500, 500, 500, 640]) {
    statuses.push((await request(optimize, size)).status);
  }
  assert.deepEqual([statuses, loads], [[400, 400, 400, 200], 1]);

  const variant = (await request(createOptimizer(), 360)).body;
  // Room for the 360 variant, but not for the original beside it.
  const tight = createOptimizer({
    cacheSizeMb: (photo.length + variant.length / 2) / 1024 / 1024,
  });
  loads = 0;
  const warm = await request(tight, 360);
  assert.equal((await request(tight, 500)).status, 400);
  const revisit = await request(tight, 360);
  assert.deepEqual([revisit.body === warm.body, loads], [true, 2]);
});

test('a gallery larger than cacheSizeMb keeps every thumbnail and drops originals', async t => {
  const photos = await Promise.all(
    Array.from({ length: 24 }, () => noisyJpeg(1000, 700))
  );
  const encodes = t.mock.method(sharp.prototype, 'toBuffer');
  let loads = 0;
  const optimize = createOptimizer({ cacheSizeMb: 1 });
  const view = (size = 360, indexes = photos.keys()) =>
    Promise.all(
      [...indexes].map(i =>
        optimize({
          url: `/img-optimizer?src=/photo-${i}.jpg&size=${size}`,
          headers: { accept: 'image/webp' },
          loadStaticAsset: () => {
            loads++;
            return photos[i];
          },
        })
      )
    );
  for (const i of photos.keys()) {
    assert.equal((await view(360, [i]))[0].status, 200);
  }
  assert.deepEqual([loads, encodes.mock.callCount()], [24, 24]);
  assert.ok((await view()).every(r => r.status === 200));
  assert.deepEqual([loads, encodes.mock.callCount()], [24, 24]);
  await view(640, [23]);
  assert.equal(loads, 24);
  await view(640, [0]);
  assert.equal(loads, 25);
});

test('the cache stays within its bytes, evicting older originals before variants', async () => {
  const cache = new ImageCache(100);
  const encoded = size => async () => ({ data: Buffer.alloc(size) });
  const original = size => ({ image: { bytes: size } });
  cache.setOriginal('a', original(40));
  await cache.variant('a 1', '', 1, encoded(20));
  cache.setOriginal('b', original(40));
  await cache.variant('b 1', '', 1, encoded(20));
  assert.deepEqual(
    [cache.original('a'), !!cache.original('b'), cache.bytes],
    [undefined, true, 80]
  );
  await cache.variant('c 1', '', 1, encoded(30));
  await cache.variant('d 1', '', 1, encoded(30));
  assert.deepEqual(
    [
      cache.original('b'),
      ['a 1', 'b 1', 'c 1', 'd 1'].map(k => cache.etag(k)),
      cache.bytes,
    ],
    [undefined, ['', '', '', ''], 100]
  );
  await cache.variant('e 1', '', 1, encoded(30));
  assert.deepEqual(
    [['a 1', 'b 1', 'c 1', 'e 1'].map(k => cache.etag(k)), cache.bytes],
    [[undefined, undefined, '', ''], 90]
  );
  const oversized = await cache.variant('f 1', '', 1, encoded(101));
  assert.equal(oversized.data.length, 101);
  cache.setOriginal('f', original(101));
  assert.deepEqual(
    [cache.etag('f 1'), cache.original('f'), cache.bytes],
    [undefined, undefined, 90]
  );
  await assert.rejects(
    cache.variant('g 1', '', 1, async () => {
      throw new Error('corrupt image');
    })
  );
  assert.equal(cache.etag('g 1'), undefined);

  cache.setOriginal('h', original(40));
  assert.deepEqual([cache.original('h'), cache.bytes], [undefined, 90]);
  await cache.variant('h 1', '', 1, encoded(20));
  assert.deepEqual(
    [cache.etag('c 1'), cache.etag('d 1'), cache.bytes],
    [undefined, '', 80]
  );

  const pair = new ImageCache(100);
  await pair.variant('x 1', '', 1, encoded(20));
  await pair.variant('y 1', '', 1, encoded(10));
  pair.setOriginal('z', original(60));
  await pair.variant('z 1', '', 1, encoded(50));
  assert.deepEqual(
    [
      pair.original('z'),
      ['x 1', 'y 1', 'z 1'].map(k => pair.etag(k)),
      pair.bytes,
    ],
    [undefined, ['', '', ''], 80]
  );
});

test('an original with no room beside cached variants evicts nothing', async () => {
  const cache = new ImageCache(100);
  const encoded = size => async () => ({ data: Buffer.alloc(size) });
  cache.setOriginal('a', { image: { bytes: 40 } });
  await cache.variant('a 1', '', 1, encoded(20));
  await cache.variant('b 1', '', 1, encoded(30));
  cache.setOriginal('b', { image: { bytes: 60 } });
  assert.deepEqual(
    [!!cache.original('a'), cache.original('b'), cache.bytes],
    [true, undefined, 90]
  );

  const [small, large] = await Promise.all([
    noisyJpeg(900, 600),
    noisyJpeg(1200, 800),
  ]);
  const sources = { '/a.jpg': small, '/b.jpg': large };
  const thumbnail = (optimize, src, size = 360) =>
    optimize({
      url: `/img-optimizer?src=${src}&size=${size}`,
      headers: { accept: 'image/webp' },
    });
  const measure = createOptimizer({ loadStaticAsset: src => sources[src] });
  const [a, b] = await Promise.all(
    ['/a.jpg', '/b.jpg'].map(async src => (await thumbnail(measure, src)).body)
  );
  // Room for the older original beside both thumbnails, not for the newer one.
  const cacheBytes = small.length + a.length + b.length + 1024;
  assert.ok(large.length + a.length + b.length > cacheBytes);
  const loads = [];
  const twoPhotos = createOptimizer({
    cacheSizeMb: cacheBytes / 1024 / 1024,
    loadStaticAsset: src => {
      loads.push(src);
      return sources[src];
    },
  });
  for (const [src, size] of [
    ['/a.jpg', 360],
    ['/b.jpg', 360],
    ['/a.jpg', 640],
  ]) {
    assert.equal((await thumbnail(twoPhotos, src, size)).status, 200);
  }
  assert.deepEqual(loads, ['/a.jpg', '/b.jpg']);

  const photo = await noisyJpeg(1200, 800);
  const request = (optimize, src) =>
    optimize({
      url: `/img-optimizer?src=${src}&size=360`,
      headers: { accept: 'image/webp' },
    });
  const variant = (
    await request(createOptimizer({ loadStaticAsset: () => photo }), '/a.jpg')
  ).body;
  const reads = [];
  // Room for both variants or for one original, never for an original and its variant.
  const optimize = createOptimizer({
    cacheSizeMb: (photo.length + variant.length / 2) / 1024 / 1024,
    loadStaticAsset: src => {
      reads.push(src);
      return photo;
    },
  });
  for (const src of ['/a.jpg', '/b.jpg', '/a.jpg']) {
    assert.equal((await request(optimize, src)).status, 200);
  }
  assert.deepEqual(reads, ['/a.jpg', '/b.jpg']);
});

test('an encode too big to cache keeps the original it came from', async () => {
  const cache = new ImageCache(100);
  const original = size => ({ image: { bytes: size } });
  cache.setOriginal('a', original(40));
  await cache.variant('a 1', '', 1, async () => ({ data: Buffer.alloc(101) }));
  cache.setOriginal('a', original(40));
  cache.setOriginal('b', original(101));
  assert.deepEqual(
    [
      !!cache.original('a'),
      cache.etag('a 1'),
      cache.original('b'),
      cache.bytes,
    ],
    [true, undefined, undefined, 40]
  );

  const photo = await sharp({
    create: {
      width: 2000,
      height: 1000,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg({ quality: 30 })
    .toBuffer();
  const request = (optimize, query) =>
    optimize({
      url: `/img-optimizer?src=/photo.jpg&${query}`,
      headers: { accept: 'image/webp' },
    });
  const queries = ['size=360', 'size=1920&quality=100', 'size=640'];
  const measure = createOptimizer({ loadStaticAsset: () => photo });
  const [small, wide, medium] = await Promise.all(
    queries.map(async query => (await request(measure, query)).body.length)
  );
  const cacheBytes = photo.length + small + medium + 1024;
  assert.ok(wide > cacheBytes);
  let loads = 0;
  const optimize = createOptimizer({
    cacheSizeMb: cacheBytes / 1024 / 1024,
    loadStaticAsset: () => {
      loads++;
      return photo;
    },
  });
  for (const query of queries) {
    assert.equal((await request(optimize, query)).status, 200);
  }
  assert.equal(loads, 1);
});
