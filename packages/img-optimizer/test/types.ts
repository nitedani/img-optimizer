import { createOptimizer } from 'img-optimizer/server';

const optimize = createOptimizer({ domains: ['example.com'] });

export const withoutLoad = async (url: string) => {
  const result = await optimize({ url, headers: { accept: 'image/webp' } });
  const answer: Awaited<ReturnType<typeof optimize>> = result;
  const input: Parameters<typeof optimize>[0] = { url };
  return [
    result.body.length,
    answer.body.length,
    (await optimize(input)).body.length,
  ];
};

const load = async (src: string, cachedVersion?: string) =>
  cachedVersion === 'v1'
    ? { version: 'v1' }
    : { version: 'v1', data: new Uint8Array() };

export const withLoad = async () => {
  const perCall = await optimize({ url: '/photos/5?size=640', load });
  // @ts-expect-error a 304 has no body
  perCall.body.length;
  const fromOptions = await createOptimizer({ load })({ url: '/photos/5' });
  // @ts-expect-error a 304 has no body
  fromOptions.body.length;
};
