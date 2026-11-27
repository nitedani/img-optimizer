export type EncodedVariant = { data: Buffer } | { redirectTo: number };

export interface Original {
  data: Buffer;
  originalWidth: number;
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
 * used first, sharing one byte budget; originals are evicted before variants,
 * except the one just stored or encoded from, which stays cached across widths
 * while it fits alongside its encoded copy.
 */
export class ImageCache {
  bytes = 0;
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

  variant(
    key: string,
    etag: string,
    quality: number,
    encode: () => Promise<EncodedVariant>,
    keepOriginal?: string
  ) {
    const cached = this.variants.get(key);
    if (cached?.etag === etag) {
      touch(this.variants, key, cached);
      return cached.image;
    }
    this.deleteVariant(key);
    const variant: Variant = { etag, quality, image: encode() };
    this.variants.set(key, variant);
    variant.image.then(
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
        touch(this.variants, key, variant);
        this.trim(keepOriginal, key);
      },
      () => {
        if (this.variants.get(key) === variant) {
          this.variants.delete(key);
        }
      }
    );
    return variant.image;
  }

  original(key: string) {
    const original = this.originals.get(key);
    if (original) {
      touch(this.originals, key, original);
    }
    return original;
  }

  setOriginal(key: string, original: Original, reserveBytes = 0) {
    this.deleteOriginal(key);
    // An oversized variant is never kept, so it reserves nothing.
    const reserve = reserveBytes > this.maxBytes ? 0 : reserveBytes;
    if (original.data.length + reserve > this.maxBytes) {
      return;
    }
    this.originals.set(key, original);
    this.bytes += original.data.length;
    this.trim(key);
  }

  private deleteVariant(key: string) {
    this.bytes -= this.variants.get(key)?.bytes ?? 0;
    this.variants.delete(key);
  }

  private deleteOriginal(key: string) {
    this.bytes -= this.originals.get(key)?.data.length ?? 0;
    this.originals.delete(key);
  }

  private trim(keepOriginal?: string, keepVariant?: string) {
    if (
      keepOriginal &&
      keepVariant &&
      (this.originals.get(keepOriginal)?.data.length ?? 0) +
        (this.variants.get(keepVariant)?.bytes ?? 0) >
        this.maxBytes
    ) {
      this.deleteOriginal(keepOriginal);
    }
    for (const key of this.originals.keys()) {
      if (this.bytes <= this.maxBytes) {
        return;
      }
      if (key !== keepOriginal) {
        this.deleteOriginal(key);
      }
    }
    for (const [key, variant] of this.variants) {
      if (this.bytes <= this.maxBytes) {
        return;
      }
      if (key !== keepVariant && variant.bytes !== undefined) {
        this.deleteVariant(key);
      }
    }
  }
}
