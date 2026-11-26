import sharp, { type Sharp } from 'sharp';
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
  sharpInstance!: Sharp;

  initializingPromise?: Promise<void>;

  allowedSizes: Set<number>;
  variants: Map<string, Buffer> = new Map();
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
    if (format !== 'avif' && format !== 'webp') {
      throw new Error('Invalid format');
    }
    const key = `${format}-${size}-${quality}`;
    const cached = this.variants.get(key);
    if (cached) {
      return { data: cached, redirectTo: null };
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

    const img = this.sharpInstance.clone()[format]({ quality });

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

    this.variants.set(key, data);

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
      this.sharpInstance = sharp(buffer).autoOrient();
      this.originalSize = (
        await this.sharpInstance.metadata()
      ).autoOrient.width;
      this.allowedSizes.add(this.originalSize);
    })();
    return this.initializingPromise;
  }

  getCacheSize() {
    let size = this.originalData?.length ?? 0;
    for (const buffer of this.variants.values()) {
      size += buffer.length;
    }

    return size || 1;
  }
}
