import sharp from 'sharp';
import { StaticAssetLoader } from './types.js';
import { loadBuffer } from './utils.js';
export class SizeError extends Error {
  constructor() {
    super();
    this.name = 'SizeError';
  }
}

export class OptimizedImage {
  src: string;

  // set in initialize
  originalData!: Buffer;
  originalSize!: number;
  sharpInstance!: sharp.Sharp;

  initializingPromise?: Promise<void>;

  allowedSizes: Set<number>;
  sizesWebp: Map<number, Buffer> = new Map();
  sizesAvif: Map<number, Buffer> = new Map();
  lastAccess = Date.now();

  constructor({ src, sizes }: { src: string; sizes?: number[] }) {
    this.src = src;
    this.allowedSizes = new Set(sizes);
  }

  async getSize({
    size,
    format,
    quality,
  }: {
    size: number;
    format: 'webp' | 'avif';
    quality: number;
  }) {
    switch (format) {
      case 'avif':
        if (this.sizesAvif.has(size)) {
          return { data: this.sizesAvif.get(size)!, redirectTo: null };
        }
        break;
      case 'webp':
        if (this.sizesWebp.has(size)) {
          return { data: this.sizesWebp.get(size)!, redirectTo: null };
        }
        break;
      default:
        throw new Error('Invalid format');
    }

    if (!this.initializingPromise) {
      throw new Error('Image not initialized');
    }

    await this.initializingPromise;

    if (!this.allowedSizes.has(size)) {
      throw new SizeError();
    }

    const newSize = size;
    // if (newSize < 400) {
    //   newSize += 100;
    // }

    if (newSize > this.originalSize) {
      return {
        redirectTo: this.originalSize,
        data: null,
      };
    }

    let img: sharp.Sharp;
    switch (format) {
      case 'avif':
        img = this.sharpInstance.clone().avif({
          quality,
        });
        break;
      case 'webp':
        img = this.sharpInstance.clone().webp({
          quality,
        });
        break;
      default:
        throw new Error('Invalid format');
    }

    if (newSize < this.originalSize) {
      img.resize(newSize, undefined, { fit: 'inside' });
    }

    const data = await img.toBuffer();

    // if (newSize < this.originalSize) {
    //   console.debug(
    //     `generated size ${this.originalSize} -> ${newSize}, ${(
    //       this.originalData.byteLength / 1024
    //     ).toFixed()}kb -> ${(data.byteLength / 1024).toFixed()}kb`
    //   );
    // } else {
    //   console.debug(
    //     `compressed original size ${this.originalSize}, ${(
    //       this.originalData.byteLength / 1024
    //     ).toFixed()}kb -> ${(data.byteLength / 1024).toFixed()}kb`
    //   );
    // }

    switch (format) {
      case 'avif':
        this.sizesAvif.set(size, data);
        break;
      case 'webp':
        this.sizesWebp.set(size, data);
        break;
      default:
        throw new Error('Invalid format');
    }

    return { data, redirectTo: null };
  }

  initialize({
    headers,
    loadStaticAsset,
    port,
  }: {
    headers: Record<string, string>;
    loadStaticAsset?: StaticAssetLoader;
    port?: number;
  }) {
    if (this.initializingPromise) {
      return this.initializingPromise;
    }
    this.initializingPromise = (async () => {
      const buffer = await loadBuffer({
        src: this.src,
        headers,
        loadStaticAsset,
        port,
      });
      this.originalData = buffer;
      this.sharpInstance = sharp(buffer);
      this.originalSize = (await this.sharpInstance.metadata()).width ?? 0;
      this.allowedSizes.add(this.originalSize);
    })();
    return this.initializingPromise;
  }

  getCacheSize() {
    let size = this.originalData?.length ?? 0;
    for (const buffer of this.sizesWebp.values()) {
      size += buffer.length;
    }
    for (const buffer of this.sizesAvif.values()) {
      size += buffer.length;
    }

    return size || 1;
  }
}
