export type ImageBytes = Buffer | ArrayBuffer | Uint8Array;

export interface LoadedImage {
  /** Changes whenever the image does, e.g. its S3 ETag without the quotes. */
  version: string;
  /** Left out when `cachedVersion` is still the current version. */
  data?: ImageBytes;
}

/**
 * `cachedVersion` is the version in the cache or in the browser's
 * If-None-Match; `null` answers 404.
 */
export type ImageLoader = (
  src: string,
  cachedVersion?: string
) => LoadedImage | null | Promise<LoadedImage | null>;

export type StaticAssetLoader = (
  src: string
) => Buffer | ArrayBuffer | Promise<Buffer | ArrayBuffer>;

export interface Format {
  format: 'webp' | 'avif';
  quality: number;
}
export interface OptimizerOptions {
  loadStaticAsset?: StaticAssetLoader;
  formats?: Format[];
  cacheSizeMb?: number;
  sizes?: number[];
  /** `?quality=` values cached apart; other values share one cached copy. */
  qualities?: number[];
  domains?: string[] | true;
}

export interface OptimizerResult {
  body: string | Buffer;
  headers: Record<string, string>;
  status: number;
}

export interface OptimizerInput {
  url: string | URL;
  headers?: Record<string, string | string[] | undefined> | Headers;
  loadStaticAsset?: StaticAssetLoader;
}

export interface PublicOptimizerInput extends OptimizerInput {
  load?: undefined;
}

export interface PrivateOptimizerInput extends OptimizerInput {
  load: ImageLoader;
}

export interface PrivateOptimizerResult {
  /** null on a 304; read-only cached buffer on a 200. */
  body: Buffer | string | null;
  headers: Record<string, string>;
  status: number;
}
