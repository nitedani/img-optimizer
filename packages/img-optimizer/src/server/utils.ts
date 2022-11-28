import { StaticAssetLoader } from './types.js';

export const parseHeaders = (
  headers: Record<string, string | string[] | undefined> | Headers
): Record<string, string> => {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value[0];
    } else {
      result[key] = value;
    }
  }
  return result;
};

export const loadBuffer = async ({
  src,
  headers,
  loadStaticAsset,
}: {
  src: string;
  headers?: HeadersInit;
  loadStaticAsset?: StaticAssetLoader;
}) => {
  const isLocal = src.startsWith('/');

  if (isLocal) {
    if (!loadStaticAsset) {
      throw new Error('loadStaticAsset is required for local files');
    }

    const bufferOrArrayBuffer = await loadStaticAsset(src);
    if (bufferOrArrayBuffer instanceof ArrayBuffer) {
      return Buffer.from(bufferOrArrayBuffer);
    } else {
      return bufferOrArrayBuffer;
    }
  }

  const res = await fetch(src, {
    headers,
  });
  return Buffer.from(await res.arrayBuffer());
};
