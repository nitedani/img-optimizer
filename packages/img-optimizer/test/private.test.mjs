import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createOptimizer } from 'img-optimizer/server';
import { noisyJpeg, solidJpeg, photoStore } from './fixtures.mjs';

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

    store.etag = 'v2';
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
      [
        404,
        'Not found',
        {
          'Content-Type': 'text/plain',
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      ]
    );
    assert.deepEqual(
      [...new Set(store.calls.map(([src]) => src))],
      ['/photos/5/image']
    );
    assert.deepEqual(
      store.calls.map(([, etag]) => etag),
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
    [...Array(6).fill('200 W/"v1-webp-640-65"'), '304 W/"v1-webp-640-65"']
  );
  assert.deepEqual(
    store.calls.map(([, etag]) => etag),
    [undefined, undefined, undefined, 'fake', undefined, undefined, undefined]
  );

  store.calls = [];
  const repeated = await request(640, ['"other"', 'W/"v1-webp-640-65"']);
  assert.deepEqual(
    [repeated.status, store.calls],
    [304, [['/photos/5/image', 'v1']]]
  );
  store.data = null;
  assert.equal((await request(640, '*')).status, 404);
});

test('an etag holding a comma matches its ETag, warm or cold', async () => {
  const store = await photoStore();
  store.etag = 'v1,2';
  const request = (optimize, ifNoneMatch) =>
    optimize({
      url: '/photos/5/image?size=640',
      headers: { accept: 'image/webp', 'if-none-match': ifNoneMatch },
    });
  const optimize = createOptimizer({ load: store.load });
  const { headers } = await request(optimize);
  assert.equal(headers.ETag, 'W/"v1,2-webp-640-65"');
  const warm = await request(optimize, headers.ETag);
  const cold = await request(
    createOptimizer({ load: store.load }),
    `"x", ${headers.ETag}`
  );
  assert.deepEqual([warm.status, cold.status], [304, 304]);
  assert.deepEqual(
    store.calls.map(([, etag]) => etag),
    [undefined, 'v1,2', 'v1,2']
  );
});

test('a 304 keeps its variant recently used', async () => {
  const data = await noisyJpeg(1200, 800);
  const variant = await sharp(data)
    .resize({ width: 640 })
    .webp({ quality: 65 })
    .toBuffer();
  const fullReads = [];
  const optimize = createOptimizer({
    cacheSizeMb: (variant.length * 2.5) / 1024 / 1024,
    load: (src, etag) => {
      if (etag === 'v1') return { etag: 'v1' };
      fullReads.push(src);
      return { etag: 'v1', data };
    },
  });
  const request = (id, ifNoneMatch) =>
    optimize({
      url: `/photos/${id}/image?size=640`,
      headers: { accept: 'image/webp', 'if-none-match': ifNoneMatch },
    });
  await request('a');
  await request('b');
  const revalidated = await request('a', 'W/"v1-webp-640-65"');
  await request('c');
  const again = await request('a');
  assert.deepEqual([revalidated.status, again.status], [304, 200]);
  assert.deepEqual(fullReads, [
    '/photos/a/image',
    '/photos/b/image',
    '/photos/c/image',
  ]);
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
    load: async (src, etag) => {
      if (src === '/photos/6/image') return { etag: 'o', data: other };
      if (etag) await checking;
      return store.load(src, etag);
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
    store.calls.map(([, etag]) => etag),
    [undefined, 'v1', undefined]
  );
});

test('load answers a narrower image at its own width, never redirecting', async () => {
  const narrow = await solidJpeg(500, 300, 'blue');
  const { status, body } = await createOptimizer()({
    url: '/photos/5/image?size=640',
    headers: { accept: 'image/avif' },
    load: () => ({ etag: 'v1', data: new Uint8Array(narrow).buffer }),
  });
  assert.equal(status, 200);
  const { width, format } = await sharp(body).metadata();
  assert.deepEqual([width, format], [500, 'heif']);
});

test('a size or quality load is not configured for is a bad request', async () => {
  const store = await photoStore();
  const answers = await Promise.all(
    [
      'size=500',
      'size=abc',
      'size=640.0',
      'size=+640',
      '',
      'size=640&quality=0',
      'size=640&quality=101',
      'size=640&quality=60.5',
      'size=640&quality=60abc',
      'size=640&quality=1e2',
      'size=640&quality=100.9',
    ].map(query =>
      createOptimizer({ load: store.load })({ url: `/photos/5/image?${query}` })
    )
  );
  assert.deepEqual(
    answers.map(r => [r.status, r.body, r.headers]),
    Array(11).fill([
      400,
      'Bad request',
      {
        'Content-Type': 'text/plain',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    ])
  );
  assert.deepEqual(store.calls, []);
});

test('a failing load or encode rejects and is not kept', async () => {
  const jpeg = await solidJpeg(1200, 800, 'blue');
  let loads = 0;
  let answer = () => {
    throw new Error('storage timed out');
  };
  const optimize = createOptimizer({
    load: () => {
      loads++;
      return answer();
    },
  });
  const request = () => optimize({ url: '/photos/5/image?size=640' });
  await assert.rejects(request(), /storage timed out/);
  answer = () => ({ etag: 'v1', data: Buffer.from('not an image') });
  await Promise.all([assert.rejects(request()), assert.rejects(request())]);
  answer = () => ({ etag: 'v1', data: jpeg });
  assert.equal((await request()).status, 200);
  assert.equal(loads, 3);
});

test('distinct pathnames on one optimizer serve their own images', async () => {
  const routes = [
    ['/items/5/image', await solidJpeg(1200, 800, 'blue')],
    ['/partners/5/image', await solidJpeg(1200, 800, 'red')],
  ];
  const optimize = createOptimizer();
  const answers = await Promise.all(
    routes.map(([path, data]) =>
      optimize({
        url: `${path}?size=640`,
        headers: { accept: 'image/webp' },
        load: () => ({ etag: 'v1', data }),
      })
    )
  );
  const pixels = await Promise.all(
    answers.map(async ({ body }) =>
      [...(await sharp(body).raw().toBuffer()).subarray(0, 3)].map(channel =>
        channel < 128 ? 0 : 255
      )
    )
  );
  assert.deepEqual(pixels, [
    [0, 0, 255],
    [255, 0, 0],
  ]);
});

test('a colon in the path or etag never shares a read with another pair', async () => {
  const calls = [];
  const optimize = createOptimizer({
    load: async (src, etag) => {
      calls.push([src, etag]);
      return { etag };
    },
  });
  const answers = await Promise.all(
    [
      ['/a:b', 'c'],
      ['/a', 'b:c'],
    ].map(([path, etag]) =>
      optimize({
        url: `${path}?size=640`,
        headers: {
          accept: 'image/webp',
          'if-none-match': `W/"${etag}-webp-640-65"`,
        },
      })
    )
  );
  assert.deepEqual(
    answers.map(r => r.status),
    [304, 304]
  );
  assert.deepEqual(calls, [
    ['/a:b', 'c'],
    ['/a', 'b:c'],
  ]);
});

test('an empty source etag never shares a read with a load that has none', async () => {
  const data = await solidJpeg(1200, 800, 'blue');
  let failConditional;
  const conditional = new Promise((_, reject) => (failConditional = reject));
  const calls = [];
  const optimize = createOptimizer({
    load: async (src, etag) => {
      calls.push(etag);
      return etag === '' ? conditional : { etag: '', data };
    },
  });
  const request = (size, ifNoneMatch) =>
    optimize({
      url: `/photo?size=${size}`,
      headers: { accept: 'image/webp', 'if-none-match': ifNoneMatch },
    });
  const warm = await request(360);
  const answers = Promise.allSettled([
    request(360, warm.headers.ETag),
    request(640),
  ]);
  failConditional(new Error('conditional request failed'));
  const [conditionalAnswer, coldAnswer] = await answers;
  assert.equal(conditionalAnswer.status, 'rejected');
  assert.equal(coldAnswer.value?.status, 200);
  assert.deepEqual(calls, [undefined, '', undefined]);
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

test('unlisted and omitted qualities share one cached copy, listed ones get their own', async t => {
  const jpeg = await noisyJpeg(1200, 800);
  const encodes = t.mock.method(sharp.prototype, 'toBuffer');
  const request = (optimize, query) =>
    optimize({
      url: `/img-optimizer?src=/photo.jpg&size=640${query}`,
      headers: { accept: 'image/webp' },
      loadStaticAsset: () => jpeg,
    });
  const optimize = createOptimizer();
  const eighty = await request(optimize, '&quality=80');
  const omitted = await request(optimize, '');
  const sweep = await Promise.all(
    Array.from({ length: 100 }, (_, i) =>
      request(optimize, `&quality=${i + 1}`)
    )
  );
  assert.ok(sweep.every(r => r.body === eighty.body));
  const [empty, ...invalid] = await Promise.all(
    ['&quality=', '&quality=0', '&quality=101', '&quality=abc'].map(query =>
      request(optimize, query)
    )
  );
  assert.deepEqual(
    [omitted.body === eighty.body, empty.body === eighty.body],
    [true, true]
  );
  assert.deepEqual(
    invalid.map(r => r.status),
    [400, 400, 400]
  );
  assert.equal(encodes.mock.callCount(), 1);

  const listed = createOptimizer({ qualities: [60, 80] });
  const seventy = await request(listed, '&quality=70');
  const [sixty, eightyListed, omittedListed] = await Promise.all(
    ['&quality=60', '&quality=80', ''].map(query => request(listed, query))
  );
  const freshSeventy = await request(createOptimizer(), '&quality=70');
  assert.deepEqual(
    [
      omittedListed.body === seventy.body,
      eightyListed.body.equals(eighty.body),
      sixty.body.equals(seventy.body),
      seventy.body.equals(freshSeventy.body),
    ],
    [true, true, false, true]
  );
  assert.equal(encodes.mock.callCount(), 5);

  const withDefault = createOptimizer({ qualities: [65, 80] });
  const unlisted = await request(withDefault, '&quality=70');
  const omittedDefault = await request(withDefault, '');
  const sixtyFive = await request(withDefault, '&quality=65');
  assert.deepEqual(
    [
      omittedDefault.body.equals(unlisted.body),
      omittedDefault.body === sixtyFive.body,
    ],
    [false, true]
  );
  assert.equal(encodes.mock.callCount(), 7);
});

test("a load answer's ETag names the quality it was encoded at", async () => {
  const store = await photoStore();
  const optimize = createOptimizer({ load: store.load });
  const etags = [];
  for (const quality of [60, 77]) {
    const { headers } = await optimize({
      url: `/photos/5/image?size=640&quality=${quality}`,
      headers: { accept: 'image/webp' },
    });
    etags.push(headers.ETag);
  }
  assert.deepEqual(etags, ['W/"v1-webp-640-60"', 'W/"v1-webp-640-60"']);
});
