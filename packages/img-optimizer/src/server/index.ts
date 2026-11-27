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
  const optimizePublic = publicOptimizer(_optimizerOptions, cache);
  const optimizePrivate = privateOptimizer(_optimizerOptions, cache);

  // A request with a `load` is the app's own; any other is a public `?src=` one.
  return async (optimizeOptions: OptimizerInput) => {
    const headers = optimizeOptions.headers
      ? parseHeaders(optimizeOptions.headers)
      : {};
    const load = optimizeOptions.load ?? _optimizerOptions.load;
    return load
      ? optimizePrivate(optimizeOptions.url, headers, load)
      : optimizePublic(
          optimizeOptions.url,
          headers,
          optimizeOptions.loadStaticAsset ?? _optimizerOptions.loadStaticAsset
        );
  };
}
