import { Image } from './image.js';

export type EncodedVariant = { data: Buffer } | { redirectTo: number };

export interface Original {
  image: Image;
  width: number;
}

interface Variant {
  etag: string;
  quality: number;
  image: Promise<EncodedVariant>;
  /** Unset while the variant is encoding. */
  bytes?: number;
}

const touch = <T>(map: Map<string, T>, key: string, value: T) => {
  map.delete(key);
  map.set(key, value);
};

/**
 * Encoded variants and the originals they are encoded from, least recently
 * used first, sharing one byte budget; originals are evicted before variants
 * and are only kept when they fit alongside cached variants.
 */
export class ImageCache {
  bytes = 0;
  private variantBytes = 0;
  private variants = new Map<string, Variant>();
  private originals = new Map<string, Original>();

  constructor(private maxBytes: number) {}

  etag(key: string) {
    return this.variants.get(key)?.etag;
  }

  touchVariant(key: string, etag: string) {
    const cached = this.variants.get(key);
    if (cached?.etag === etag) {
      touch(this.variants, key, cached);
    }
  }

  quality(key: string, etag: string) {
    const variant = this.variants.get(key);
    return variant?.etag === etag ? variant.quality : undefined;
  }

  /** Resolves once the variant is counted and the cache trimmed to its bytes. */
  variant<T extends EncodedVariant>(
    key: string,
    etag: string,
    quality: number,
    encode: () => Promise<T>
  ) {
    const cached = this.variants.get(key);
    if (cached?.etag === etag) {
      touch(this.variants, key, cached);
      // A key only ever holds what its own lane encodes.
      return cached.image as Promise<T>;
    }
    this.deleteVariant(key);
    const image = encode();
    const variant: Variant = { etag, quality, image };
    this.variants.set(key, variant);
    image.then(
      image => {
        if (this.variants.get(key) !== variant) {
          return;
        }
        // A redirect still holds memory, so a zero budget keeps none.
        const bytes = 'data' in image ? image.data.length : 64;
        if (bytes > this.maxBytes) {
          this.variants.delete(key);
          return;
        }
        variant.bytes = bytes;
        this.bytes += bytes;
        this.variantBytes += bytes;
        touch(this.variants, key, variant);
        this.trim();
      },
      () => {
        if (this.variants.get(key) === variant) {
          this.variants.delete(key);
        }
      }
    );
    return image;
  }

  original(key: string) {
    const original = this.originals.get(key);
    if (original) {
      touch(this.originals, key, original);
    }
    return original;
  }

  setOriginal(key: string, original: Original) {
    this.deleteOriginal(key);
    if (this.variantBytes + original.image.bytes > this.maxBytes) {
      return;
    }
    this.originals.set(key, original);
    this.bytes += original.image.bytes;
    for (const other of this.originals.keys()) {
      if (this.bytes <= this.maxBytes) {
        return;
      }
      this.deleteOriginal(other);
    }
  }

  private deleteVariant(key: string) {
    const bytes = this.variants.get(key)?.bytes ?? 0;
    this.bytes -= bytes;
    this.variantBytes -= bytes;
    this.variants.delete(key);
  }

  private deleteOriginal(key: string) {
    this.bytes -= this.originals.get(key)?.image.bytes ?? 0;
    this.originals.delete(key);
  }

  private trim() {
    for (const key of this.originals.keys()) {
      if (this.bytes <= this.maxBytes) {
        return;
      }
      this.deleteOriginal(key);
    }
    for (const [key, variant] of this.variants) {
      if (this.bytes <= this.maxBytes) {
        return;
      }
      if (variant.bytes !== undefined) {
        this.deleteVariant(key);
      }
    }
  }
}
