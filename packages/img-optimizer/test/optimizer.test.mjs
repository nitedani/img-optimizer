import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createOptimizer } from 'img-optimizer/server';

test('an EXIF-rotated photo keeps its stored orientation in both formats', async () => {
  const jpeg = await sharp({
    create: { width: 720, height: 500, channels: 3, background: 'blue' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const optimize = createOptimizer();
  for (const accept of ['image/avif', 'image/webp']) {
    const { status, body } = await optimize({
      url: '/img-optimizer?src=/photo.jpg&size=360',
      headers: { accept },
      loadStaticAsset: () => jpeg,
    });
    assert.equal(status, 200);
    const { width, height } = await sharp(body).metadata();
    assert.deepEqual([width, height], [360, 250], accept);
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

test('an image answer carries the Cache-Control the caller asks for', async () => {
  const jpeg = await sharp({
    create: { width: 720, height: 500, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
  const optimize = createOptimizer();
  const request = cacheControl =>
    optimize({
      url: '/img-optimizer?src=/photo.jpg&size=360',
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => jpeg,
      cacheControl,
    });
  const own = await request('private, no-cache');
  assert.equal(own.status, 200);
  assert.equal(own.headers['Cache-Control'], 'private, no-cache');
  const fallback = await request(undefined);
  assert.equal(
    fallback.headers['Cache-Control'],
    'public, max-age=31536000, immutable'
  );
});

test('a narrower image redirects to its width on the same path', async () => {
  const jpeg = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: 'blue' },
  })
    .jpeg()
    .toBuffer();
  const optimize = createOptimizer();
  for (const path of ['/photos/a', '/img-optimizer']) {
    const { status, headers } = await optimize({
      url: `${path}?src=/photo.jpg&size=1600`,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => jpeg,
    });
    assert.equal(status, 302);
    assert.equal(headers.Location, `${path}?src=/photo.jpg&size=1200`);
  }
});
