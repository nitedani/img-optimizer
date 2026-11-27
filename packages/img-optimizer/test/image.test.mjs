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
    assert.equal(unmirrored.status, 200);
    const { data, info } = await sharp(unmirrored.body)
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.deepEqual([info.width, info.height, info.channels], [360, 250, 3]);
    const colour = (x, y) =>
      [...data.subarray((y * 360 + x) * 3, (y * 360 + x) * 3 + 3)].map(
        channel => (channel < 128 ? 0 : 255)
      );
    assert.deepEqual(
      [colour(90, 62), colour(270, 62), colour(90, 187), colour(270, 187)],
      [
        [0, 0, 255],
        [255, 0, 0],
        [0, 255, 255],
        [255, 255, 0],
      ],
      accept
    );
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
