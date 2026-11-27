import { defu } from 'defu';
import { EncodedVariant, ImageCache, Original } from './cache.js';
import { encode, readWidth } from './encode.js';
import {
  OptimizerOptions,
  Format,
  OptimizerResult,
  OptimizerInput,
  ImageLoader,
  PrivateOptimizerInput,
  PrivateOptimizerResult,
  PublicOptimizerInput,
} from './types.js';
import { loadBuffer, parseHeaders } from './utils.js';

class SizeError extends Error {}

const parsePort = (port: string | number | undefined) => {
  if (typeof port === 'string') {
    try {
      return parseInt(port, 10);
    } catch (error) {
      return undefined;
    }
  } else if (typeof port === 'number') {
    return port;
  } else {
    return undefined;
  }
};

const parseUrl = (url: string | URL) => {
  if (url instanceof URL) {
    return url;
  }

  const portMatch = /^[A-Z]+?:\/\/[A-Z\d\.-]{2,}\.[A-Z]{2,}:(\d{2,5})?/i.exec(
    url
  );
  let port: number | undefined = undefined;
  if (portMatch?.length === 2) {
    port = parsePort(portMatch[1]);
  }

  const { pathname, search } = new URL(url, 'http://localhost');
  const parsedUrl = new URL(
    'http://localhost' + (port ? `:${port}` : '') + pathname + search
  );

  return parsedUrl;
};

const parseRequest = (url: string | URL, headers: Record<string, string>) => {
  const parsedOriginalUrl = parseUrl(url);
  const host = headers['host'] || parsedOriginalUrl.host;
  const splitHost = host?.split(':');
  const portFromHost = splitHost?.length === 2 ? splitHost[1] : undefined;
  const port = parsePort(
    parsedOriginalUrl.port || portFromHost || process.env.PORT
  );

  const protocol = port === 443 ? 'https://' : 'http://';

  const src = parsedOriginalUrl.searchParams.get('src');
  const sizeStr = parsedOriginalUrl.searchParams.get('size');
  const qualityStr = parsedOriginalUrl.searchParams.get('quality');

  const srcUrl =
    src && new URL(src.startsWith('/') ? protocol + host + src : src);

  return {
    url: srcUrl || undefined,
    pathname: parsedOriginalUrl.pathname,
    port,
    src,
    size: sizeStr ? parseInt(sizeStr, 10) : undefined,
    quality: qualityStr,
  };
};

// The quoted tags of an If-None-Match list, which may hold commas, weak or not.
const entityTags = (ifNoneMatch = '') =>
  Array.from(
    ifNoneMatch.matchAll(/(?:^|,)\s*(?:W\/)?("[^"]*")(?=\s*(?:,|$))/g),
    match => match[1]
  );

const privateTextAnswer = (status: number, body: string) => ({
  status,
  body,
  headers: {
    'Content-Type': 'text/plain',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  },
});

// never for an argument without a loader, which the public overload takes.
type LoadMayBeGiven<T> = T extends { load?: infer Load }
  ? [Load] extends [undefined]
    ? never
    : unknown
  : never;

export function createOptimizer(
  optimizerOptions: OptimizerOptions & { load: ImageLoader }
): (
  input: OptimizerInput & { load?: ImageLoader }
) => Promise<PrivateOptimizerResult>;
export function createOptimizer<
  T extends OptimizerOptions & { load?: ImageLoader }
>(
  optimizerOptions: T & LoadMayBeGiven<T>
): (
  input: OptimizerInput & { load?: ImageLoader }
) => Promise<OptimizerResult | PrivateOptimizerResult>;
export function createOptimizer(
  optimizerOptions?: OptimizerOptions & { load?: undefined }
): {
  (input: PrivateOptimizerInput): Promise<PrivateOptimizerResult>;
  <T extends OptimizerInput & { load?: ImageLoader }>(
    input: T & LoadMayBeGiven<T>
  ): Promise<OptimizerResult | PrivateOptimizerResult>;
  (input: PublicOptimizerInput): Promise<OptimizerResult>;
};
export function createOptimizer(
  optimizerOptions?: OptimizerOptions & { load?: ImageLoader }
) {
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
  // Concurrent misses for the same source and etag share one read.
  const readOnce = <T>(key: string, read: () => Promise<T>) => {
    let pending = inFlightLoads.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = read().finally(() => inFlightLoads.delete(key));
      inFlightLoads.set(key, pending);
    }
    return pending;
  };

  // Unlisted qualities share one slot, so a ?quality= sweep can't fill the cache.
  const pickEncoding = (
    headers: Record<string, string>,
    requestedQuality: string | null
  ) => {
    const accept = headers['accept'] ?? 'webp';
    const { format, quality } =
      _optimizerOptions.formats.find(f => accept.includes(f.format)) ||
      _optimizerOptions.formats[0];
    if (!requestedQuality) {
      return { format, quality, qualityKey: 'default' };
    }
    const requested = parseInt(requestedQuality, 10);
    if (!(requested >= 1 && requested <= 100)) {
      return null;
    }
    const qualityKey = _optimizerOptions.qualities?.includes(requested)
      ? String(requested)
      : 'unlisted';
    return { format, quality: requested, qualityKey };
  };

  const optimizePrivate = async (
    url: string | URL,
    headers: Record<string, string>,
    load: ImageLoader
  ): Promise<PrivateOptimizerResult> => {
    const { pathname: src, searchParams } = parseUrl(url);
    const sizeStr = searchParams.get('size') ?? '';
    const size = Number(sizeStr);
    const qualityStr = searchParams.get('quality');
    const encoding = pickEncoding(headers, qualityStr);
    if (
      !/^\d+$/.test(sizeStr) ||
      (qualityStr && !/^\d+$/.test(qualityStr)) ||
      !_optimizerOptions.sizes.includes(size) ||
      !encoding
    ) {
      return privateTextAnswer(400, 'Bad request');
    }
    const { format, quality, qualityKey } = encoding;

    const key = JSON.stringify(['private', src, format, size, qualityKey]);
    const tags = entityTags(headers['if-none-match']);
    // A candidate source etag from a browser tag matching this variant.
    const suffix = `-${format}-${size}-${quality}"`;
    const browserEtag = tags
      .filter(tag => tag.endsWith(suffix))
      .map(tag => tag.slice(1, -suffix.length))
      .find(etag => /^[^*\x00-\x1f\x7f]+$/.test(etag));
    const read = (etag?: string) =>
      readOnce(JSON.stringify(['private', src, etag ?? '']), async () =>
        load(src, etag)
      );
    let loaded = await read(cache.etag(key) ?? browserEtag);
    if (!loaded) {
      return privateTextAnswer(404, 'Not found');
    }
    const tagOf = (etag: string) =>
      `"${etag}-${format}-${size}-${cache.quality(key, etag) ?? quality}"`;
    if (
      loaded.data === undefined &&
      cache.etag(key) !== loaded.etag &&
      !tags.includes(tagOf(loaded.etag))
    ) {
      loaded = await read();
      if (!loaded) {
        return privateTextAnswer(404, 'Not found');
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
    if (tags.includes(tagOf(etag))) {
      cache.touchVariant(key, etag);
      return { status: 304, body: null, headers: answerHeaders };
    }
    const image = await cache.variant(key, etag, quality, async () => ({
      data: await encode(data!, format, quality, size),
    }));
    return {
      status: 200,
      body: (image as { data: Buffer }).data,
      headers: {
        ...answerHeaders,
        'Content-Type': `image/${format}`,
        'X-Content-Type-Options': 'nosniff',
      },
    };
  };

  const optimize = async (
    optimizeOptions: OptimizerInput & { load?: ImageLoader }
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

    const encoding = pickEncoding(headers, requestedQuality);
    if (!encoding) {
      return { status: 400, body: 'Bad request', headers: {} };
    }
    const { format, quality, qualityKey } = encoding;

    const originalKey = JSON.stringify(['public', src]);
    const readOriginal = async (): Promise<Original> => {
      const data = await loadBuffer({
        src,
        headers,
        loadStaticAsset:
          optimizeOptions.loadStaticAsset ?? _optimizerOptions.loadStaticAsset,
        port,
      });
      const original = {
        data,
        originalWidth: await readWidth(data),
      };
      cache.setOriginal(originalKey, original);
      return original;
    };
    const sizeImage = async (): Promise<EncodedVariant> => {
      const { data, originalWidth } =
        cache.original(originalKey) ??
        (await readOnce(originalKey, readOriginal));
      if (size !== originalWidth && !_optimizerOptions.sizes.includes(size)) {
        throw new SizeError();
      }
      if (size > originalWidth) {
        return { redirectTo: originalWidth };
      }
      return { data: await encode(data, format, quality, size) };
    };

    let image: EncodedVariant;
    try {
      image = await cache.variant(
        JSON.stringify(['public', src, format, size, qualityKey]),
        '',
        quality,
        sizeImage,
        originalKey
      );
    } catch (error) {
      if (!(error instanceof SizeError)) {
        console.error(error);
      }
      return {
        status: 400,
        body: 'Bad request',
        headers: {},
      };
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
          (qualityKey === 'default' ? '' : `&quality=${quality}`),
      },
      body: '',
    };
  };

  return optimize;
}
