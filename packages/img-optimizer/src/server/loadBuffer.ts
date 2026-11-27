import { StaticAssetLoader } from './types.js';
import got from 'got';

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
