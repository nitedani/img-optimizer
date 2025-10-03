import { OptimizedImage } from './image.js';

export class ImageCache {
  maxSize: number;
  cache: Map<string, OptimizedImage> = new Map();

  constructor({ cacheSizeMb }: { cacheSizeMb: number }) {
    this.maxSize = cacheSizeMb * 1024 * 1024;
  }

  get(key: string) {
    const val = this.cache.get(key);
    if (val) {
      val.lastAccess = Date.now();
    }
    return val;
  }
  set(key: string, value: OptimizedImage) {
    if (this.sweep() < this.maxSize) {
      this.cache.set(key, value);
    }
  }
  sweep() {
    let size = 0;
    for (const image of this.cache.values()) {
      size += image.getCacheSize();
    }
    if (size > this.maxSize) {
      const sorted = [...this.cache.entries()]
        .filter(([, image]) => image.lastAccess < Date.now() - 1000)
        .sort(([, a], [, b]) => a.lastAccess - b.lastAccess);
      for (const [key, image] of sorted) {
        if (size <= this.maxSize) {
          break;
        }
        size -= image.getCacheSize();
        this.cache.delete(key);
      }
    }
    return size;
  }
}
