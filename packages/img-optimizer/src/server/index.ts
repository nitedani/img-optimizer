import { defu } from 'defu';
import { EncodedVariant, ImageCache, Original } from './cache.js';
import { encode, readWidth } from './encode.js';
import {
  OptimizerOptions,
  Format,
  OptimizerResult,
  OptimizerInput,
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
    quality: qualityStr ? parseInt(qualityStr, 10) : undefined,
  };
};

export const createOptimizer = (optimizerOptions?: OptimizerOptions) => {
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
  // Concurrent misses for one source share its read.
  const readOnce = <T>(key: string, read: () => Promise<T>) => {
    let pending = inFlightLoads.get(key) as Promise<T> | undefined;
    if (!pending) {
      pending = read().finally(() => inFlightLoads.delete(key));
      inFlightLoads.set(key, pending);
    }
    return pending;
  };

  const optimize = async (
    optimizeOptions: OptimizerInput
  ): Promise<OptimizerResult> => {
    const headers = optimizeOptions.headers
      ? parseHeaders(optimizeOptions.headers)
      : {};

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

    const accept = headers['accept'] ?? 'webp';
    const { format, quality: defaultQuality } =
      _optimizerOptions.formats.find(f => accept.includes(f.format)) ||
      _optimizerOptions.formats[0];

    const quality = requestedQuality ?? defaultQuality;

    const originalKey = `public:${src}`;
    const readOriginal = async (): Promise<Original> => {
      const data = await loadBuffer({
        src,
        headers,
        loadStaticAsset:
          optimizeOptions.loadStaticAsset ?? _optimizerOptions.loadStaticAsset,
        port,
      });
      const original = {
        version: '',
        data,
        originalWidth: await readWidth(data),
      };
      cache.setOriginal(originalKey, original);
      return original;
    };
    const sizeImage = async (): Promise<EncodedVariant> => {
      const { data, originalWidth } =
        cache.original(originalKey, '') ??
        (await readOnce(`${originalKey}:`, readOriginal));
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
        `${originalKey}:${format}:${size}:${quality}`,
        '',
        quality,
        sizeImage
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
          Vary: 'Accept',
          'Cache-Control':
            optimizeOptions.cacheControl ??
            'public, max-age=31536000, immutable',
        },
        status: 200,
      };
    }
    return {
      status: 302,
      headers: {
        Location:
          `${pathname}?src=${encodeURIComponent(src)}` +
          `&size=${image.redirectTo}` +
          (requestedQuality ? `&quality=${requestedQuality}` : ''),
      },
      body: '',
    };
  };

  return optimize;
};
