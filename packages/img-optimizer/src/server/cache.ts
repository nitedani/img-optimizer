export type EncodedVariant = { data: Buffer } | { redirectTo: number };

export interface Original {
  version: string;
  data: Buffer;
  originalWidth: number;
}

interface Variant {
  version: string;
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
 * except the one just stored or encoded from.
 */
export class ImageCache {
  variantBytes = 0;
  originalBytes = 0;
  private variants = new Map<string, Variant>();
  private originals = new Map<string, Original>();

  constructor(private maxBytes: number) {}

  cachedVersion(key: string) {
    return this.variants.get(key)?.version;
  }

  quality(key: string, version: string) {
    const variant = this.variants.get(key);
    return variant?.version === version ? variant.quality : undefined;
  }

  /** The variant cached under `key` at `version`, encoded with `encode` on a miss. */
  variant(
    key: string,
    version: string,
    quality: number,
    encode: () => Promise<EncodedVariant>,
    keepOriginal?: string
  ) {
    const cached = this.variants.get(key);
    if (cached?.version === version) {
      touch(this.variants, key, cached);
      return cached.image;
    }
    this.deleteVariant(key);
    const variant: Variant = { version, quality, image: encode() };
    this.variants.set(key, variant);
    variant.image.then(
      image => {
        if (this.variants.get(key) !== variant) {
          return;
        }
        const bytes = 'data' in image ? image.data.length : 0;
        if (bytes > this.maxBytes) {
          this.variants.delete(key);
          return;
        }
        variant.bytes = bytes;
        this.variantBytes += bytes;
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

  original(key: string, version: string) {
    const original = this.originals.get(key);
    if (original?.version !== version) {
      return undefined;
    }
    touch(this.originals, key, original);
    return original;
  }

  setOriginal(key: string, original: Original) {
    this.deleteOriginal(key);
    if (original.data.length > this.maxBytes) {
      return;
    }
    this.originals.set(key, original);
    this.originalBytes += original.data.length;
    this.trim(key);
  }

  private deleteVariant(key: string) {
    this.variantBytes -= this.variants.get(key)?.bytes ?? 0;
    this.variants.delete(key);
  }

  private deleteOriginal(key: string) {
    this.originalBytes -= this.originals.get(key)?.data.length ?? 0;
    this.originals.delete(key);
  }

  private trim(keepOriginal?: string, keepVariant?: string) {
    for (const key of this.originals.keys()) {
      if (this.variantBytes + this.originalBytes <= this.maxBytes) {
        return;
      }
      if (key !== keepOriginal) {
        this.deleteOriginal(key);
      }
    }
    for (const [key, variant] of this.variants) {
      if (this.variantBytes + this.originalBytes <= this.maxBytes) {
        return;
      }
      if (key !== keepVariant && variant.bytes !== undefined) {
        this.deleteVariant(key);
      }
    }
    if (
      keepOriginal &&
      this.variantBytes + this.originalBytes > this.maxBytes
    ) {
      this.deleteOriginal(keepOriginal);
    }
  }
}
