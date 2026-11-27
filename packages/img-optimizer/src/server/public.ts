import {
  createInFlight,
  EncodedVariant,
  ImageCache,
  Original,
} from './cache.js';
import { openImage } from './image.js';
import { loadBuffer } from './loadBuffer.js';
import { parseRequest, pickEncoding } from './request.js';
import { Config, OptimizerResult, StaticAssetLoader } from './types.js';

/** An original with its upright width, which a requested width is checked against. */
interface SizedOriginal extends Original {
  width: number;
}

/** A width that is neither in `sizes` nor the image's own. */
class SizeError extends Error {}

const badRequest = (body = 'Bad request'): OptimizerResult => ({
  status: 400,
  body,
  headers: {},
});

/**
 * Answers a `?src=` request: the image of an allowed domain, kept by
 * browsers for good, or a redirect to its own width when narrower.
 */
export const publicOptimizer = (config: Config, cache: ImageCache) => {
  const shareRead = createInFlight<SizedOriginal>();

  return async (
    requestUrl: string | URL,
    headers: Record<string, string>,
    loadStaticAsset: StaticAssetLoader | undefined
  ): Promise<OptimizerResult> => {
    const {
      pathname,
      port,
      src,
      size,
      url,
      quality: requestedQuality,
    } = parseRequest(requestUrl, headers);

    if (!src || !size || !url) {
      return badRequest();
    }

    const allowedDomains = config.domains;

    if (allowedDomains !== true) {
      const isAllowed =
        Array.isArray(allowedDomains) &&
        allowedDomains.some(domain => url.hostname.endsWith(domain));
      if (!isAllowed) {
        return badRequest(
          `Bad request, the domain ${url.hostname} is not allowed`
        );
      }
    }

    const encoding = pickEncoding(config, headers, requestedQuality);
    if (!encoding) {
      return badRequest();
    }
    const { format, quality, qualityKey } = encoding;

    const originalKey = JSON.stringify(['public', src]);
    const readOriginal = async (): Promise<SizedOriginal> => {
      const image = openImage(
        await loadBuffer({ src, headers, loadStaticAsset, port })
      );
      return { image, width: await image.width() };
    };
    let original: SizedOriginal | undefined;
    let releaseRead = () => {};
    // Runs when the variant is not cached: a cached one needs no original.
    const sizeImage = async (): Promise<EncodedVariant> => {
      original = cache.original<SizedOriginal>(originalKey);
      if (!original) {
        // Other widths share this read until the request that started it settles.
        const read = shareRead(originalKey, readOriginal);
        releaseRead = read.release;
        original = await read.pending;
      }
      if (size !== original.width && !config.sizes.includes(size)) {
        cache.setOriginal(originalKey, original);
        throw new SizeError();
      }
      if (size > original.width) {
        return { redirectTo: original.width };
      }
      return { data: await original.image.encode(format, size, quality) };
    };

    let image: EncodedVariant;
    try {
      image = await cache.variant(
        JSON.stringify(['public', src, format, size, qualityKey]),
        '',
        quality,
        sizeImage
      );
      // Kept in the space the variants leave, so only once this one is counted.
      if (original) {
        cache.setOriginal(originalKey, original);
      }
    } catch (error) {
      if (!(error instanceof SizeError)) {
        console.error(error);
      }
      return badRequest();
    } finally {
      releaseRead();
    }
    if ('data' in image) {
      return {
        body: image.data,
        headers: {
          'Content-Type': `image/${format}`,
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
        status: 200,
      };
    }
    return {
      status: 302,
      headers: {
        Location:
          `${pathname.replace(/^\/+/, '/')}?src=${encodeURIComponent(src)}` +
          `&size=${image.redirectTo}` +
          (requestedQuality ? `&quality=${quality}` : ''),
      },
      body: '',
    };
  };
};
