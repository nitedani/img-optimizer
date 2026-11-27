import { createInFlight, ImageCache } from './cache.js';
import { browserEtag, browserHas, variantTag } from './etag.js';
import { Image, openImage } from './image.js';
import { parseUrl, pickEncoding } from './request.js';
import { Config, ImageLoader, PrivateOptimizerResult } from './types.js';

/** What load answered for a source, its data opened as an image. */
interface Source {
  etag: string;
  /** Unset when load answered without data. */
  image?: Image;
}

const textAnswer = (status: number, body: string) => ({
  status,
  body,
  headers: {
    'Content-Type': 'text/plain',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

/**
 * Answers a request the app has already authorized with the image `load`
 * reads at its pathname: private to the browser, revalidated by ETag.
 */
export const privateOptimizer = (config: Config, cache: ImageCache) => {
  const shareLoad = createInFlight<Source | null>();

  return async (
    url: string | URL,
    headers: Record<string, string>,
    load: ImageLoader
  ): Promise<PrivateOptimizerResult> => {
    const { pathname: src, searchParams } = parseUrl(url);
    const sizeStr = searchParams.get('size') ?? '';
    const size = Number(sizeStr);
    const qualityStr = searchParams.get('quality');
    const encoding = pickEncoding(config, headers, qualityStr);
    if (
      !/^\d+$/.test(sizeStr) ||
      (qualityStr && !/^\d+$/.test(qualityStr)) ||
      !config.sizes.includes(size) ||
      !encoding
    ) {
      return textAnswer(400, 'Bad request');
    }
    const { format, quality, qualityKey } = encoding;
    const key = JSON.stringify(['private', src, format, size, qualityKey]);
    const ifNoneMatch = headers['if-none-match'];
    // A variant's tag names the quality it was encoded at, which a shared slot may hold.
    const tagOf = (etag: string) =>
      variantTag(etag, format, size, cache.quality(key, etag) ?? quality);

    const originalKey = JSON.stringify(['private', src]);
    const original = cache.original<Required<Source>>(originalKey);

    let releaseLoad = () => {};
    // A load that opened an image stays shared until the request that started it settles.
    const loadOnce = async (etag?: string) => {
      const shared = shareLoad(
        JSON.stringify([src, etag ?? null]),
        async () => {
          const loaded = await load(src, etag);
          return (
            loaded && {
              etag: loaded.etag,
              image: loaded.data && openImage(loaded.data),
            }
          );
        }
      );
      releaseLoad = shared.release;
      const source = await shared.pending;
      if (!source?.image) {
        shared.release();
      }
      return source;
    };

    try {
      // An etag the cache or the browser holds lets load answer without the data.
      let source = await loadOnce(
        original?.etag ??
          cache.etag(key) ??
          browserEtag(ifNoneMatch, format, size, quality)
      );
      if (!source) {
        return textAnswer(404, 'Not found');
      }
      let image =
        original?.etag === source.etag ? original.image : source.image;
      if (
        !image &&
        cache.etag(key) !== source.etag &&
        !browserHas(ifNoneMatch, tagOf(source.etag))
      ) {
        source = await loadOnce();
        if (!source) {
          return textAnswer(404, 'Not found');
        }
        if (!source.image) {
          throw new Error(`load returned no data for ${src}`);
        }
        image = source.image;
      }
      const { etag } = source;
      const answerHeaders: Record<string, string> = {
        ETag: `W/${tagOf(etag)}`,
        'Cache-Control':
          searchParams.get('v') === etag
            ? 'private, max-age=86400'
            : 'private, no-cache',
        Vary: 'Accept',
      };
      if (browserHas(ifNoneMatch, tagOf(etag))) {
        cache.touchVariant(key, etag);
        // Replaces a stale original, so the next revalidation passes this etag.
        if (image) {
          cache.setOriginal(originalKey, { image, etag });
        }
        return { status: 304, body: null, headers: answerHeaders };
      }
      // With no image the variant is cached still: nothing awaited since the check.
      const variant = await cache.variant(key, etag, quality, async () => ({
        data: await image!.encode(format, size, quality),
      }));
      // Kept in the space the variants leave, so only once this one is counted.
      if (image) {
        cache.setOriginal(originalKey, { image, etag });
      }
      return {
        status: 200,
        body: variant.data,
        headers: {
          ...answerHeaders,
          'Content-Type': `image/${format}`,
          'X-Content-Type-Options': 'nosniff',
        },
      };
    } finally {
      releaseLoad();
    }
  };
};
