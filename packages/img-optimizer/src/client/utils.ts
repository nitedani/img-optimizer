import { SafeNumber } from './types.js';
const defaultSizes = [360, 640, 1024, 1280, 1600, 1920, 2560, 3840];

export const createSrcSet = (
  src: string,
  width?: SafeNumber,
  quality?: SafeNumber
) => {
  if (width) {
    return makeUrl(src, getSizeForRequest(width), quality);
  }
  const srcSet = defaultSizes.map(size => makeUrl(src, size, quality));
  return srcSet.join(', ');
};

export const getSizeForRequest = (width: SafeNumber) => {
  const sizes = defaultSizes;
  for (const size of sizes) {
    if (width <= size) {
      return size;
    }
  }
  return sizes[sizes.length - 1];
};

export const makeUrl = (
  src: string,
  size: SafeNumber,
  quality?: SafeNumber
) => {
  let url = `/_image?src=${src}&size=${size}`;
  if (quality) {
    url += `&quality=${quality}`;
  }
  url += ` ${size}w`;
  return url;
};

export const parseSafeNumber = (size?: SafeNumber) => {
  if (typeof size === 'string') {
    return parseInt(size, 10);
  }
  return size;
};
