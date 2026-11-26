import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createOptimizer } from 'img-optimizer/server';

test('an EXIF-rotated or mirrored photo comes out upright in both formats', async () => {
  const jpeg = await sharp({
    create: { width: 720, height: 500, channels: 3, background: 'blue' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const quadrants = Buffer.alloc(720 * 500 * 3);
  for (let i = 0; i < quadrants.length; i += 3) {
    quadrants[i + ((i / 3) % 720 < 360 ? 0 : 2)] = 255;
    quadrants[i + 1] = i / 3 < 720 * 250 ? 0 : 255;
  }
  const mirrored = await sharp(quadrants, {
    raw: { width: 720, height: 500, channels: 3 },
  })
    .jpeg()
    .withMetadata({ orientation: 2 })
    .toBuffer();
  const pixels = image => sharp(image).raw().toBuffer();
  const optimize = createOptimizer();
  for (const accept of ['image/avif', 'image/webp']) {
    const request = size =>
      optimize({
        url: `/img-optimizer?src=/photo.jpg&size=${size}`,
        headers: { accept },
        loadStaticAsset: () => jpeg,
      });
    const { status, body } = await request(360);
    assert.equal(status, 200);
    const { format, width, height } = await sharp(body).metadata();
    assert.deepEqual(
      [format, width, height],
      [{ 'image/avif': 'heif', 'image/webp': 'webp' }[accept], 360, 518]
    );
    const wider = await request(640);
    assert.equal(wider.status, 302, accept);
    assert.equal(
      wider.headers.Location,
      '/img-optimizer?src=%2Fphoto.jpg&size=500'
    );
    const unmirrored = await optimize({
      url: '/img-optimizer?src=/mirrored.jpg&size=360',
      headers: { accept },
      loadStaticAsset: () => mirrored,
    });
    const [, codec] = accept.split('/');
    const upright = await sharp(mirrored)
      .rotate()
      .resize({ width: 360 })
      [codec]({ quality: { avif: 45, webp: 65 }[codec] })
      .toBuffer();
    const actual = await pixels(unmirrored.body);
    assert.ok(actual.equals(await pixels(upright)), accept);
  }
});

test('a semi-transparent image keeps its colours in both formats', async () => {
  const png = await sharp({
    create: {
      width: 720,
      height: 500,
      channels: 4,
      background: { r: 48, g: 96, b: 144, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const optimize = createOptimizer();
  for (const accept of ['image/avif', 'image/webp']) {
    const { body } = await optimize({
      url: '/img-optimizer?src=/glass.png&size=360',
      headers: { accept },
      loadStaticAsset: () => png,
    });
    const { data, info } = await sharp(body)
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [360, 250, 4]);
    const middle = (125 * 360 + 180) * 4;
    const pixel = [...data.subarray(middle, middle + 4)];
    const expected = [48, 96, 144, 128];
    assert.ok(
      pixel.every((channel, i) => Math.abs(channel - expected[i]) <= 8),
      `${accept}: ${pixel}`
    );
  }
});

test('each caller gets the Cache-Control it asks for', async () => {
  const jpeg = await sharp({
    create: { width: 720, height: 500, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
  const optimize = createOptimizer();
  let loads = 0;
  const request = cacheControl =>
    optimize({
      url: '/img-optimizer?src=/photo.jpg&size=360',
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => {
        loads++;
        return jpeg;
      },
      cacheControl,
    });
  const concurrent = await Promise.all(
    ['private, no-cache', 'public, max-age=60'].map(request)
  );
  const cached = [
    await request('private, max-age=0'),
    await request(undefined),
  ];
  const answers = [...concurrent, ...cached];
  assert.equal(loads, 1);
  assert.deepEqual(
    answers.map(r => `${r.status} ${r.headers['Cache-Control']}`),
    [
      '200 private, no-cache',
      '200 public, max-age=60',
      '200 private, max-age=0',
      '200 public, max-age=31536000, immutable',
    ]
  );
  assert.ok(answers.every(r => r.headers.Vary === 'Accept'));
});

test('a narrower image redirects to its width on the same path', async () => {
  const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
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
  const jpeg = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg()
    .toBuffer();
  const request = (optimize, url) =>
    optimize({
      url,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => jpeg,
    });
  const optimize = createOptimizer();
  const warm = await request(optimize, '/photos/a?src=/photo.jpg&size=1200');
  const redirect = await request(
    optimize,
    '/photos/a?src=/photo.jpg&size=1600&quality=30'
  );
  assert.equal(
    redirect.headers.Location,
    '/photos/a?src=%2Fphoto.jpg&size=1200&quality=30'
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
  const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
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
  const jpeg = await sharp({
    create: { width: 720, height: 500, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
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
