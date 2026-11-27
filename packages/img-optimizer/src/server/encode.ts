import sharp from 'sharp';
import { Format } from './types.js';

export const readWidth = async (data: Buffer) =>
  (await sharp(data).metadata()).autoOrient.width;

export const encode = (
  data: Buffer,
  format: Format['format'],
  quality: number,
  width: number
) =>
  sharp(data)
    .autoOrient()
    .resize({ width, withoutEnlargement: true })
    [format]({ quality })
    .toBuffer();
