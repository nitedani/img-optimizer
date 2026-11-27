export type ImageBytes = Buffer | ArrayBuffer | Uint8Array;

export interface LoadedImage {
  /** Changes whenever the image does, e.g. its S3 ETag without the quotes. */
  etag: string;
  /** Left out when `etag` is still current. */
  data?: ImageBytes;
}

/**
 * `etag` is the source ETag from the cache or the browser's If-None-Match;
 * `null` answers 404.
 */
export type ImageLoader = (
  src: string,
  etag?: string
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
  qualities?: readonly number[];
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
  /** null on a 304; treat returned Buffers as read-only. */
  body: Buffer | string | null;
  headers: Record<string, string>;
  status: number;
}
