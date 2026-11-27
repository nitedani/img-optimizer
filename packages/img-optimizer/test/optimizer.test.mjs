import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { createOptimizer } from 'img-optimizer/server';
import { ImageCache } from '../lib/server/cache.js';

const noisyJpeg = (width, height) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .jpeg()
    .toBuffer();

const solidJpeg = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

// An S3-like store: `held` still current answers without bytes.
const photoStore = async () => {
  const store = {
    version: 'v1',
    data: await solidJpeg(1200, 800, 'blue'),
    calls: [],
  };
  store.load = async (src, held) => {
    store.calls.push([src, held]);
    if (!store.data) return null;
    if (held === store.version) return { version: store.version };
    const bytes = new Uint8Array(store.data.length + 8);
    bytes.set(store.data, 8);
    return { version: store.version, data: bytes.subarray(8) };
  };
  return store;
};

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

test('a second width of an image reuses the original read for the first', async () => {
  const jpeg = await noisyJpeg(1200, 800);
  let loads = 0;
  const optimize = createOptimizer();
  for (const size of [360, 640, 1024]) {
    const { status } = await optimize({
      url: `/img-optimizer?src=/photo.jpg&size=${size}`,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => {
        loads++;
        return jpeg;
      },
    });
    assert.equal(status, 200);
  }
  assert.equal(loads, 1);
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

test('the cache stays within its bytes and evicts originals before variants', async () => {
  const cache = new ImageCache(100);
  const bytes = () => cache.variantBytes + cache.originalBytes;
  const encoded = size => async () => ({ data: Buffer.alloc(size) });
  const original = size => ({
    version: '',
    data: Buffer.alloc(size),
    originalWidth: 1,
  });
  cache.setOriginal('a', original(40));
  await cache.variant('a 1', '', 1, encoded(20));
  cache.setOriginal('b', original(40));
  await cache.variant('b 1', '', 1, encoded(20));
  assert.deepEqual(
    [cache.original('a', ''), !!cache.original('b', ''), bytes()],
    [undefined, true, 80]
  );
  await cache.variant('c 1', '', 1, encoded(30));
  await cache.variant('d 1', '', 1, encoded(30));
  assert.deepEqual(
    [
      cache.original('b', ''),
      ['a 1', 'b 1', 'c 1', 'd 1'].map(k => cache.held(k)),
      bytes(),
    ],
    [undefined, ['', '', '', ''], 100]
  );
  await cache.variant('e 1', '', 1, encoded(30));
  assert.deepEqual(
    ['a 1', 'b 1', 'c 1', 'e 1'].map(k => cache.held(k)),
    [undefined, undefined, '', '']
  );
  assert.equal(bytes(), 90);
  const oversized = await cache.variant('f 1', '', 1, encoded(101));
  assert.equal(oversized.data.length, 101);
  cache.setOriginal('f', original(101));
  assert.deepEqual(
    [cache.held('f 1'), cache.original('f', ''), cache.held('e 1'), bytes()],
    [undefined, undefined, '', 90]
  );
  await assert.rejects(
    cache.variant('g 1', '', 1, async () => {
      throw new Error('corrupt image');
    })
  );
  assert.equal(cache.held('g 1'), undefined);
});

test('load serves the image at the pathname, given as an option or per call', async () => {
  for (const via of ['options', 'per call']) {
    const store = await photoStore();
    const optimizer =
      via === 'options'
        ? createOptimizer({ load: store.load })
        : createOptimizer();
    const request = (query, headers = {}) =>
      optimizer({
        url: `/photos/5/image?${query}`,
        headers: { accept: 'image/webp', ...headers },
        ...(via === 'per call' && { load: store.load }),
      });

    const first = await request('size=640&src=/other.jpg');
    assert.equal(first.status, 200, via);
    assert.deepEqual(first.headers, {
      'Content-Type': 'image/webp',
      ETag: 'W/"v1-webp-640-65"',
      'Cache-Control': 'private, no-cache',
      Vary: 'Accept',
      'X-Content-Type-Options': 'nosniff',
    });
    assert.equal((await sharp(first.body).metadata()).width, 640);
    const versioned = await request('size=640&v=v1');
    assert.deepEqual(
      [versioned.status, versioned.headers['Cache-Control']],
      [200, 'private, max-age=86400']
    );
    const notModified = await request('size=640', {
      'if-none-match': 'W/"v1-webp-640-65"',
    });
    assert.deepEqual(
      [notModified.status, notModified.body, notModified.headers.ETag],
      [304, null, 'W/"v1-webp-640-65"']
    );
    const response = new Response(notModified.body, notModified);
    assert.equal(response.status, 304);

    store.version = 'v2';
    store.data = await solidJpeg(1200, 800, 'red');
    const replaced = await request('size=640', {
      'if-none-match': 'W/"v1-webp-640-65"',
    });
    assert.deepEqual(
      [replaced.status, replaced.headers.ETag],
      [200, 'W/"v2-webp-640-65"']
    );
    assert.notDeepEqual(replaced.body, first.body);

    store.data = null;
    const deleted = await request('size=640');
    assert.deepEqual(
      [deleted.status, deleted.body, deleted.headers],
      [404, 'Not found', { 'Content-Type': 'text/plain' }]
    );
    assert.deepEqual(
      [...new Set(store.calls.map(([src]) => src))],
      ['/photos/5/image']
    );
    assert.deepEqual(
      store.calls.map(([, held]) => held),
      [undefined, 'v1', 'v1', 'v1', 'v2']
    );
  }
});

test('an ETag the browser kept answers 304 without encoding, even on a cold cache', async t => {
  const store = await photoStore();
  const encodes = t.mock.method(sharp.prototype, 'toBuffer');
  const request = (size, ifNoneMatch) =>
    createOptimizer({ load: store.load })({
      url: `/photos/5/image?size=${size}`,
      headers: { Accept: 'image/webp', 'If-None-Match': ifNoneMatch },
    });
  const cold = await request(640, 'W/"v1-webp-640-65"');
  assert.deepEqual([cold.status, cold.body], [304, null]);
  assert.deepEqual(store.calls, [['/photos/5/image', 'v1']]);
  assert.equal(encodes.mock.callCount(), 0);

  store.calls = [];
  const answers = await Promise.all(
    [
      'W/"v1-webp-360-65"',
      'W/"v1-avif-640-65"',
      'W/"v1-webp-640-80"',
      'W/"fake-webp-640-65"',
      'W/"*-webp-640-65"',
      'W/"v"1-webp-640-65"',
      '*',
    ].map(ifNoneMatch => request(640, ifNoneMatch))
  );
  assert.deepEqual(
    answers.map(r => `${r.status} ${r.headers.ETag}`),
    Array(7).fill('200 W/"v1-webp-640-65"')
  );
  assert.deepEqual(
    store.calls.map(([, held]) => held),
    [undefined, undefined, undefined, 'fake', undefined, undefined, undefined]
  );
});

test('a variant evicted while load checked it is read again', async () => {
  const store = await photoStore();
  store.data = await noisyJpeg(1200, 800);
  const other = await noisyJpeg(1200, 800);
  const variant = await sharp(store.data)
    .resize({ width: 640 })
    .webp({ quality: 65 })
    .toBuffer();
  let release;
  const checking = new Promise(resolve => (release = resolve));
  const optimize = createOptimizer({
    cacheSizeMb: (variant.length * 1.5) / 1024 / 1024,
    load: async (src, held) => {
      if (src === '/photos/6/image') return { version: 'o', data: other };
      if (held) await checking;
      return store.load(src, held);
    },
  });
  const request = id =>
    optimize({
      url: `/photos/${id}/image?size=640`,
      headers: { accept: 'image/webp' },
    });
  const first = await request(5);
  const again = request(5);
  await request(6);
  release();
  const answer = await again;
  assert.deepEqual([answer.status, answer.body], [200, first.body]);
  assert.deepEqual(
    store.calls.map(([, held]) => held),
    [undefined, 'v1', undefined]
  );
});

test('load answers a narrower image at its own width, never redirecting', async () => {
  const narrow = await solidJpeg(500, 300, 'blue');
  const { status, body } = await createOptimizer()({
    url: '/photos/5/image?size=640',
    headers: { accept: 'image/avif' },
    load: () => ({ version: 'v1', data: new Uint8Array(narrow).buffer }),
  });
  assert.equal(status, 200);
  const { width, format } = await sharp(body).metadata();
  assert.deepEqual([width, format], [500, 'heif']);
});

test('a size load is not configured for is a bad request', async () => {
  const store = await photoStore();
  const answers = await Promise.all(
    ['size=500', 'size=abc', 'size=640.0', 'size=+640', ''].map(query =>
      createOptimizer({ load: store.load })({ url: `/photos/5/image?${query}` })
    )
  );
  assert.deepEqual(
    answers.map(r => [r.status, r.body, r.headers['Content-Type']]),
    Array(5).fill([400, 'Bad request', 'text/plain'])
  );
  assert.deepEqual(store.calls, []);
});

test('a failing load or encode rejects and is not kept', async () => {
  let failing = true;
  const jpeg = await solidJpeg(1200, 800, 'blue');
  const optimize = createOptimizer({
    load: () => {
      if (failing) throw new Error('storage timed out');
      return { version: 'v1', data: jpeg };
    },
  });
  const request = () => optimize({ url: '/photos/5/image?size=640' });
  await assert.rejects(request(), /storage timed out/);
  failing = false;
  assert.equal((await request()).status, 200);
  await assert.rejects(
    createOptimizer()({
      url: '/photos/5/image?size=640',
      load: () => ({ version: 'v1', data: Buffer.from('not an image') }),
    })
  );
});

test('a public ?src= of the same path and load never share a cache entry', async () => {
  const store = await photoStore();
  const publicJpeg = await solidJpeg(1200, 800, 'green');
  let publicLoads = 0;
  const optimize = createOptimizer();
  const publicRequest = () =>
    optimize({
      url: '/img-optimizer?src=/photos/5/image&size=640',
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => {
        publicLoads++;
        return publicJpeg;
      },
    });
  const [before, secret] = await Promise.all([
    publicRequest(),
    optimize({
      url: '/photos/5/image?size=640',
      headers: { accept: 'image/webp' },
      load: store.load,
    }),
  ]);
  const after = await publicRequest();
  assert.deepEqual(
    [before.status, secret.status, after.status],
    [200, 200, 200]
  );
  assert.notDeepEqual(secret.body, before.body);
  assert.equal(after.body, before.body);
  assert.deepEqual(store.calls, [['/photos/5/image', undefined]]);
  assert.equal(publicLoads, 1);
});

test('the types keep 0.0.4 callers unchanged and give load a nullable body', async () => {
  const tsc = new URL('../node_modules/.bin/tsc', import.meta.url).pathname;
  const types = new URL('./types.ts', import.meta.url).pathname;
  await promisify(execFile)(tsc, [
    '--noEmit',
    '--strict',
    '--module',
    'nodenext',
    '--moduleResolution',
    'nodenext',
    '--types',
    'node',
    types,
  ]);
});
