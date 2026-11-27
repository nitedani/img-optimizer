import { Format } from './types.js';

// The quoted tags of an If-None-Match list, which may hold commas, weak or not.
const entityTags = (ifNoneMatch = '') =>
  Array.from(
    ifNoneMatch.matchAll(/(?:^|,)\s*(?:W\/)?("[^"]*")(?=\s*(?:,|$))/g),
    match => match[1]
  );

/** The tag of one variant: its source's etag, then what it is encoded as. */
export const variantTag = (
  etag: string,
  format: Format['format'],
  size: number,
  quality: number
) => `"${etag}-${format}-${size}-${quality}"`;

/** Whether the browser's If-None-Match holds `tag`, or is `*`. */
export const browserHas = (ifNoneMatch: string | undefined, tag: string) =>
  ifNoneMatch?.trim() === '*' || entityTags(ifNoneMatch).includes(tag);

/** The source etag in a tag the browser kept of this variant, if any. */
export const browserEtag = (
  ifNoneMatch: string | undefined,
  format: Format['format'],
  size: number,
  quality: number
) => {
  const suffix = variantTag('', format, size, quality).slice(1);
  return entityTags(ifNoneMatch)
    .filter(tag => tag.endsWith(suffix))
    .map(tag => tag.slice(1, -suffix.length))
    .find(etag => /^[^*\x00-\x1f\x7f]+$/.test(etag));
};
