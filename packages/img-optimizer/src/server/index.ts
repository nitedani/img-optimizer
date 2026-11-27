import { defu } from 'defu';
import { EncodedVariant, ImageCache, Original } from './cache.js';
import { openImage } from './image.js';
import { privateOptimizer } from './private.js';
import {
  OptimizerOptions,
  Format,
  OptimizerResult,
  OptimizerInput,
  ImageLoader,
  LoadMayBeGiven,
  Optimize,
  PrivateOptimizerResult,
} from './types.js';
import { loadBuffer } from './loadBuffer.js';
import { parseHeaders, parseRequest, pickEncoding } from './request.js';

class SizeError extends Error {}

export function createOptimizer(
  optimizerOptions: OptimizerOptions & { load: ImageLoader }
): (input: OptimizerInput) => Promise<PrivateOptimizerResult>;
export function createOptimizer<T extends OptimizerOptions>(
  optimizerOptions: T & LoadMayBeGiven<T>
): (input: OptimizerInput) => Promise<OptimizerResult | PrivateOptimizerResult>;
export function createOptimizer(
  optimizerOptions?: OptimizerOptions & { load?: undefined }
): Optimize;
export function createOptimizer(optimizerOptions?: OptimizerOptions) {
  const _optimizerOptions = defu(optimizerOptions, {
    sizes: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840],
    cacheSizeMb: 50,
    formats: [
      {
        format: 'avif',
        quality: 45,
      },
      {
        format: 'webp',
        quality: 65,
      },
    ] as Format[],
    domains: ['localhost'],
  });

  const cache = new ImageCache(_optimizerOptions.cacheSizeMb * 1024 * 1024);
  const inFlightLoads = new Map<string, Promise<unknown>>();
  const optimizePrivate = privateOptimizer(_optimizerOptions, cache);

  const optimize = async (
    optimizeOptions: OptimizerInput
  ): Promise<OptimizerResult | PrivateOptimizerResult> => {
    const headers = optimizeOptions.headers
      ? parseHeaders(optimizeOptions.headers)
      : {};
    const load = optimizeOptions.load ?? _optimizerOptions.load;
    if (load) {
      return optimizePrivate(optimizeOptions.url, headers, load);
    }

    const {
      pathname,
      port,
      src,
      size,
      url,
      quality: requestedQuality,
    } = parseRequest(optimizeOptions.url, headers);

    if (!src || !size || !url) {
      return { status: 400, body: 'Bad request', headers: {} };
    }

    const allowedDomains = _optimizerOptions.domains;

    if (allowedDomains !== true) {
      const isAllowed =
        Array.isArray(allowedDomains) &&
        allowedDomains.some(domain => url.hostname.endsWith(domain));
      if (!isAllowed) {
        return {
          status: 400,
          body: `Bad request, the domain ${url.hostname} is not allowed`,
          headers: {},
        };
      }
    }

    const encoding = pickEncoding(_optimizerOptions, headers, requestedQuality);
    if (!encoding) {
      return { status: 400, body: 'Bad request', headers: {} };
    }
    const { format, quality, qualityKey } = encoding;

    const originalKey = JSON.stringify(['public', src]);
    const readOriginal = async (): Promise<Original> => {
      const image = openImage(
        await loadBuffer({
          src,
          headers,
          loadStaticAsset:
            optimizeOptions.loadStaticAsset ??
            _optimizerOptions.loadStaticAsset,
          port,
        })
      );
      return { image, width: await image.width() };
    };
    let loadedOriginal: Original | undefined;
    let ownsRead = false;
    const sizeImage = async (): Promise<EncodedVariant> => {
      let original = cache.original(originalKey);
      // Other widths share this read until the request that started it settles.
      ownsRead = !original && !inFlightLoads.has(originalKey);
      if (ownsRead) {
        inFlightLoads.set(originalKey, readOriginal());
      }
      original ??= await (inFlightLoads.get(originalKey) as Promise<Original>);
      if (size !== original.width && !_optimizerOptions.sizes.includes(size)) {
        cache.setOriginal(originalKey, original);
        throw new SizeError();
      }
      loadedOriginal = original;
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
      // Admitted after variant() trims, into the space the variants leave.
      if (loadedOriginal) {
        cache.setOriginal(originalKey, loadedOriginal);
      }
    } catch (error) {
      if (!(error instanceof SizeError)) {
        console.error(error);
      }
      return {
        status: 400,
        body: 'Bad request',
        headers: {},
      };
    } finally {
      if (ownsRead) {
        inFlightLoads.delete(originalKey);
      }
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

  return optimize;
}
