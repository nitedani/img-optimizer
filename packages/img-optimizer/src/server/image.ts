import sharp from 'sharp';
import { Format, ImageBytes } from './types.js';

/** An image opened from its bytes, upright by its EXIF orientation. */
export type Image = ReturnType<typeof openImage>;

export const openImage = (source: ImageBytes) => {
  const data = source instanceof ArrayBuffer ? Buffer.from(source) : source;
  const upright = sharp(data).rotate();
  return {
    bytes: data.length,
    // Orientations 5 to 8 lie on their side: their height is the upright width.
    width: async () => {
      const { width, height, orientation } = await upright.metadata();
      return orientation && orientation >= 5 ? height! : width!;
    },
    /** Never wider than the image itself. */
    encode: (format: Format['format'], width: number, quality: number) =>
      upright
        .clone()
        .resize({ width, withoutEnlargement: true })
        [format]({ quality })
        .toBuffer(),
  };
};
