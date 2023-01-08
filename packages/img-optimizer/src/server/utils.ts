import { StaticAssetLoader } from './types.js';
import got from 'got';

export const parseHeaders = (
  headers: Record<string, string | string[] | undefined> | Headers
): Record<string, string> => {
  const result: Record<string, string> = {};
  if (typeof headers.forEach === 'function') {
    headers.forEach((value, key) => {
      if (Array.isArray(value)) {
        result[key] = value[0];
      } else {
        result[key] = value || '';
      }
    });
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (Array.isArray(value)) {
        result[key] = value[0];
      } else {
        result[key] = value || '';
      }
    }
  }

  return result;
};

export const loadBuffer = async ({
  src,
  headers,
  loadStaticAsset,
  port,
}: {
  src: string;
  headers?: HeadersInit;
  loadStaticAsset?: StaticAssetLoader;
  port?: number;
}) => {
  const isLocal = src.startsWith('/');

  if (isLocal) {
    if (!loadStaticAsset) {
      if (port) {
        const _headers = {};
        if (headers?.['cookie']) {
          _headers['cookie'] = headers['cookie'];
        }
        try {
          const res = await got('http://localhost:' + port + src, {
            headers: _headers,
          });
          return res.rawBody;
        } catch (error) {}
      }
      throw new Error(
        'asset discovery failed, loadStaticAsset is required for local files'
      );
    }

    const bufferOrArrayBuffer = await loadStaticAsset(src);
    if (bufferOrArrayBuffer instanceof ArrayBuffer) {
      return Buffer.from(bufferOrArrayBuffer);
    } else {
      return bufferOrArrayBuffer;
    }
  }

  const res = await got(src);
  return res.rawBody;
};
