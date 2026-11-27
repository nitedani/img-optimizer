import { ImageCache } from './cache.js';
import { browserEtag, browserHas, variantTag } from './etag.js';
import { Image, openImage } from './image.js';
import { parseUrl, pickEncoding } from './request.js';
import { Config, ImageLoader, PrivateOptimizerResult } from './types.js';

/** What load answered for a source, its data opened once for every width. */
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
  const inFlightLoads = new Map<string, Promise<Source | null>>();
  // Concurrent misses for the same source and etag share one load and image.
  const loadOnce = (load: ImageLoader, src: string, etag?: string) => {
    const key = JSON.stringify([src, etag ?? null]);
    let pending = inFlightLoads.get(key);
    if (!pending) {
      pending = (async () => {
        const loaded = await load(src, etag);
        return (
          loaded && {
            etag: loaded.etag,
            image: loaded.data && openImage(loaded.data),
          }
        );
      })().finally(() => inFlightLoads.delete(key));
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

    const originalKey = JSON.stringify(['private', src]);
    const original = cache.original<Required<Source>>(originalKey);
    const notFound = () => {
      cache.deleteOriginal(originalKey);
      return textAnswer(404, 'Not found');
    };

    // An etag the cache or the browser holds lets load answer without the data.
    let source = await loadOnce(
      load,
      src,
      cache.etag(key) ??
        original?.etag ??
        browserEtag(ifNoneMatch, format, size, quality)
    );
    if (!source) {
      return notFound();
    }
    let image = original?.etag === source.etag ? original.image : source.image;
    if (
      !image &&
      cache.etag(key) !== source.etag &&
      !browserHas(ifNoneMatch, tagOf(source.etag))
    ) {
      source = await loadOnce(load, src);
      if (!source) {
        return notFound();
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
  };
};
