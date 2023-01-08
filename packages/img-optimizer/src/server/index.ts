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
  }
  return port;
};

const parseUrl = (url: string | URL) => {
  if (url instanceof URL) {
    return { url, port: parsePort(url.port || process.env.PORT) };
  }

  let port: number | undefined = undefined;
  const portMatch = /^[A-Z]+?:\/\/[A-Z\d\.-]{2,}\.[A-Z]{2,}:(\d{2,5})?/i.exec(
    url
  );

  if (portMatch?.length === 2) {
    port = parsePort(portMatch[1]);
  }

  port ||= parsePort(process.env.PORT);

  return {
    url: new URL(
      'http://localhost' + port
        ? `:${port}`
        : '' + url.substring(url.indexOf('/img-optimizer'))
    ),
    port,
  };
};

export const createOptimizer = (optimizerOptions?: OptimizerOptions) => {
  const _optimizerOptions = defu(optimizerOptions, {
    sizes: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840],
    cacheSizeMb: 50,
    formats: [
      {
        format: 'webp',
        quality: 65,
      },
      {
        format: 'avif',
        quality: 45,
      },
    ] as Format[],
  });
  const cache = new ImageCache({
    cacheSizeMb: _optimizerOptions.cacheSizeMb,
  });
  const pending = new Map<string, Promise<OptimizerResult>>();
  const optimize = async (
    optimizeOptions: OptimizerInput
  ): Promise<OptimizerResult> => {
    const { url, port } = parseUrl(optimizeOptions.url);
    const searchParams = url.searchParams;
    const src = searchParams.get('src');
    const sizeStr = searchParams.get('size');
    const headers = optimizeOptions.headers
      ? parseHeaders(optimizeOptions.headers)
      : {};

    if (!src || !sizeStr) {
      return { status: 400, body: 'Bad request', headers: {} };
    }

    const size = parseInt(sizeStr, 10);
    const accept = headers['accept'] ?? 'webp';
    const { format, quality } =
      _optimizerOptions.formats.find(f => accept.includes(f.format)) ||
      _optimizerOptions.formats[0];

    const key = `${src}-${size}-${format}-${quality}`;
    const _pending = pending.get(key);
    if (_pending) {
      return _pending;
    }
    const promise = (async (): Promise<OptimizerResult> => {
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

      try {
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
            Location: '/image?src=' + src + '&size=' + redirectTo,
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
