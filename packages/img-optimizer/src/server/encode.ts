import sharp from 'sharp';
import { Format, ImageBytes } from './types.js';

export const readWidth = async (data: Buffer) =>
  (await sharp(data).metadata()).autoOrient.width;

export const encode = (
  data: ImageBytes,
  format: Format['format'],
  quality: number,
  width: number
) =>
  sharp(data)
    .autoOrient()
    .resize({ width, withoutEnlargement: true })
    [format]({ quality })
    .toBuffer();
