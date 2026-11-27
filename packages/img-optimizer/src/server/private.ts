import { ImageCache } from './cache.js';
import { browserEtag, browserHas, variantTag } from './etag.js';
import { openImage } from './image.js';
import { parseUrl, pickEncoding } from './request.js';
import {
  Config,
  ImageLoader,
  LoadedImage,
  PrivateOptimizerResult,
} from './types.js';

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
  const inFlightLoads = new Map<string, Promise<LoadedImage | null>>();
  // Concurrent misses for the same source and etag share one load.
  const loadOnce = (load: ImageLoader, src: string, etag?: string) => {
    const key = JSON.stringify([src, etag ?? null]);
    let pending = inFlightLoads.get(key);
    if (!pending) {
      pending = (async () => load(src, etag))().finally(() =>
        inFlightLoads.delete(key)
      );
      inFlightLoads.set(key, pending);
    }
    return pending;
  };

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

    // An etag the cache or the browser holds lets load answer without the data.
    let loaded = await loadOnce(
      load,
      src,
      cache.etag(key) ?? browserEtag(ifNoneMatch, format, size, quality)
    );
    if (!loaded) {
      return textAnswer(404, 'Not found');
    }
    if (
      loaded.data === undefined &&
      cache.etag(key) !== loaded.etag &&
      !browserHas(ifNoneMatch, tagOf(loaded.etag))
    ) {
      loaded = await loadOnce(load, src);
      if (!loaded) {
        return textAnswer(404, 'Not found');
      }
      if (loaded.data === undefined) {
        throw new Error(`load returned no data for ${src}`);
      }
    }
    const { etag, data } = loaded;
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
      return { status: 304, body: null, headers: answerHeaders };
    }
    // Without data the variant is cached still: nothing awaited since the check.
    const image = await cache.variant(key, etag, quality, async () => ({
      data: await openImage(data!).encode(format, size, quality),
    }));
    return {
      status: 200,
      body: image.data,
      headers: {
        ...answerHeaders,
        'Content-Type': `image/${format}`,
        'X-Content-Type-Options': 'nosniff',
      },
    };
  };
};
