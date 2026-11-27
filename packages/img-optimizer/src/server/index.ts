import { defu } from 'defu';
import { ImageCache } from './cache.js';
import { privateOptimizer } from './private.js';
import { publicOptimizer } from './public.js';
import { parseHeaders } from './request.js';
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

export function createOptimizer(
  options: OptimizerOptions & { load: ImageLoader }
): (input: OptimizerInput) => Promise<PrivateOptimizerResult>;
export function createOptimizer<T extends OptimizerOptions>(
  options: T & LoadMayBeGiven<T>
): (input: OptimizerInput) => Promise<OptimizerResult | PrivateOptimizerResult>;
export function createOptimizer(
  options?: OptimizerOptions & { load?: undefined }
): Optimize;
export function createOptimizer(options?: OptimizerOptions) {
  const config = defu(options, {
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

  const cache = new ImageCache(config.cacheSizeMb * 1024 * 1024);
  const optimizePublic = publicOptimizer(config, cache);
  const optimizePrivate = privateOptimizer(config, cache);

  // A request with a `load` is the app's own; any other is a public `?src=` one.
  return async (input: OptimizerInput) => {
    const headers = input.headers ? parseHeaders(input.headers) : {};
    const load = input.load ?? config.load;
    return load
      ? optimizePrivate(input.url, headers, load)
      : optimizePublic(
          input.url,
          headers,
          input.loadStaticAsset ?? config.loadStaticAsset
        );
  };
}
