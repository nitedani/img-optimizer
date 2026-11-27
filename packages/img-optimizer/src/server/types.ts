export type ImageBytes = Buffer | ArrayBuffer | Uint8Array;

export interface LoadedImage {
  /** Changes whenever the image does, e.g. its S3 ETag without the quotes. */
  version: string;
  /** Left out when `held` is still the current version. */
  data?: ImageBytes;
}

/**
 * Loads the image of a private route; `held` is the version the optimizer
 * already has, and `null` answers 404.
 */
export type ImageLoader = (
  src: string,
  held?: string
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
  sizes?: readonly number[];
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
  /** Serves the image at the url's pathname, loaded by this instead of `?src=`. */
  load: ImageLoader;
}

export interface PrivateOptimizerResult {
  /** null on a 304. */
  body: Buffer | string | null;
  headers: Record<string, string>;
  status: number;
}
