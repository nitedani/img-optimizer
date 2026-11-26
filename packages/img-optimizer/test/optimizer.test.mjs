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
