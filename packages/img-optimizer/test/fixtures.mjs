import sharp from 'sharp';

export const noisyJpeg = (width, height) =>
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

export const solidJpeg = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } })
    .jpeg()
    .toBuffer();

// An S3-like store: `etag` still current answers without bytes.
export const photoStore = async () => {
  const store = {
    etag: 'v1',
    data: await solidJpeg(1200, 800, 'blue'),
    calls: [],
  };
  store.load = async (src, etag) => {
    store.calls.push([src, etag]);
    if (!store.data) return null;
    if (etag === store.etag) return { etag: store.etag };
    const bytes = new Uint8Array(store.data.length + 8);
    bytes.set(store.data, 8);
    return { etag: store.etag, data: bytes.subarray(8) };
  };
  return store;
};
