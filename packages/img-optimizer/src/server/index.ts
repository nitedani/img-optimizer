import { defu } from 'defu';
import { ImageCache } from './cache.js';
import { OptimizedImage, SizeError } from './image.js';
import {
  OptimizerOptions,
  Format,
  OptimizerResult,
  OptimizerInput,
} from './types.js';
import { parseHeaders } from './utils.js';

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

  const parsedUrl = new URL(
    'http://localhost' +
      (port ? `:${port}` : '') +
      url.substring(url.indexOf('/img-optimizer'))
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

  const cache = new ImageCache({
    cacheSizeMb: _optimizerOptions.cacheSizeMb,
  });
  const pending = new Map<string, Promise<OptimizerResult>>();
  const optimize = async (
    optimizeOptions: OptimizerInput
  ): Promise<OptimizerResult> => {
    const headers = optimizeOptions.headers
      ? parseHeaders(optimizeOptions.headers)
      : {};

    const {
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

    const key = `${src}-${size}-${format}-${quality}`;
    const _pending = pending.get(key);
    if (_pending) {
      return _pending;
    }
    const promise = (async (): Promise<OptimizerResult> => {
      try {
        let image = cache.get(src);
        if (!image) {
          image = new OptimizedImage({ src, sizes: _optimizerOptions.sizes });
          cache.set(src, image);
          await image.initialize({
            headers,
            loadStaticAsset:
              optimizeOptions.loadStaticAsset ??
              _optimizerOptions.loadStaticAsset,
            port,
          });
        }

        const { data, redirectTo } = await image.getSize({
          size,
          format,
          quality,
        });
        if (data) {
          return {
            body: data,
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
            Location: '/img-optimizer?src=' + src + '&size=' + redirectTo,
          },
          body: '',
        };
      } catch (error: any) {
        if (error instanceof SizeError) {
          return {
            status: 400,
            body: 'Bad request',
            headers: {},
          };
        }
        console.error(error);
        return {
          status: 400,
          body: 'Bad request',
          headers: {},
        };
      }
    })();
    pending.set(key, promise);
    const result = await promise;
    pending.delete(key);
    return result;
  };

  return optimize;
};
