import { Config } from './types.js';

export const parseHeaders = (
  headers: Record<string, string | string[] | undefined> | Headers
): Record<string, string> => {
  const result: Record<string, string> = {};
  const add = (value: string | string[] | undefined, key: string) => {
    const name = key.toLowerCase();
    // Repeated If-None-Match values form one list, as Headers joins them.
    result[name] = Array.isArray(value)
      ? name === 'if-none-match'
        ? value.join(', ')
        : value[0]
      : value || '';
  };
  if (typeof headers.forEach === 'function') {
    headers.forEach(add);
  } else {
    for (const [key, value] of Object.entries(headers)) {
      add(value, key);
    }
  }

  return result;
};

const parsePort = (port: string | number | undefined) =>
  typeof port === 'string' ? parseInt(port, 10) : port;

export const parseUrl = (url: string | URL) => {
  if (url instanceof URL) {
    return url;
  }

  const portMatch = /^[A-Z]+?:\/\/[A-Z\d\.-]{2,}\.[A-Z]{2,}:(\d{2,5})?/i.exec(
    url
  );
  let port: number | undefined = undefined;
  if (portMatch?.length === 2) {
    port = parsePort(portMatch[1]);
  }

  const { pathname, search } = new URL(url, 'http://localhost');
  const parsedUrl = new URL(
    'http://localhost' + (port ? `:${port}` : '') + pathname + search
  );

  return parsedUrl;
};

export const parseRequest = (
  url: string | URL,
  headers: Record<string, string>
) => {
  const parsedOriginalUrl = parseUrl(url);
  const host = headers['host'] || parsedOriginalUrl.host;
  const splitHost = host?.split(':');
  const portFromHost = splitHost?.length === 2 ? splitHost[1] : undefined;
  const port = parsePort(
    parsedOriginalUrl.port || portFromHost || process.env.PORT
  );

  const protocol = port === 443 ? 'https://' : 'http://';

  const src = parsedOriginalUrl.searchParams.get('src');
  const sizeStr = parsedOriginalUrl.searchParams.get('size');
  const qualityStr = parsedOriginalUrl.searchParams.get('quality');

  const srcUrl =
    src && new URL(src.startsWith('/') ? protocol + host + src : src);

  return {
    url: srcUrl || undefined,
    pathname: parsedOriginalUrl.pathname,
    port,
    src,
    size: sizeStr ? parseInt(sizeStr, 10) : undefined,
    quality: qualityStr,
  };
};

// Omitted and unlisted qualities share a slot, bounding a ?quality= sweep.
export const pickEncoding = (
  { formats, qualities }: Config,
  headers: Record<string, string>,
  requestedQuality: string | null
) => {
  const accept = headers['accept'] ?? 'webp';
  const { format, quality: defaultQuality } =
    formats.find(f => accept.includes(f.format)) || formats[0];
  const quality = requestedQuality
    ? parseInt(requestedQuality, 10)
    : defaultQuality;
  if (!(quality >= 1 && quality <= 100)) {
    return null;
  }
  const qualityKey = qualities?.includes(quality) ? String(quality) : 'default';
  return { format, quality, qualityKey };
};
