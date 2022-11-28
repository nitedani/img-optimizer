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
}

export interface OptimizerResult {
  body: string | Buffer;
  headers: Record<string, string>;
  status: number;
}

export interface OptimizerInput {
  url: string;
  headers?: Record<string, string | string[] | undefined> | Headers;
  loadStaticAsset?: StaticAssetLoader;
}
