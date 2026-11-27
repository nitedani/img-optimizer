import sharp from 'sharp';
import { Format, ImageBytes } from './types.js';

export const readWidth = async (data: Buffer) => {
  const { width, height, orientation } = await sharp(data).metadata();
  return orientation && orientation >= 5 ? height! : width!;
};

export const encode = (
  data: ImageBytes,
  format: Format['format'],
  quality: number,
  width: number
) =>
  sharp(data instanceof ArrayBuffer ? Buffer.from(data) : data)
    .rotate()
    .resize({ width, withoutEnlargement: true })
    [format]({ quality })
    .toBuffer();
