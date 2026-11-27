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

const maybeLoad = process.env.PRIVATE_IMAGES ? load : undefined;

export const withMaybeLoad = async (url: string) => {
  const perCall = await optimize({ url, load: maybeLoad });
  // @ts-expect-error a 304 has no body
  perCall.body.length;
  const fromOptions = await createOptimizer({ load: maybeLoad })({ url });
  // @ts-expect-error a 304 has no body
  fromOptions.body.length;
};

export const withUndefinedLoad = async (url: string) => {
  const fromOptions: Buffer | string = (
    await createOptimizer({ sizes: [640], load: undefined })({ url })
  ).body;
  const perCall: Buffer | string = (await optimize({ url, load: undefined }))
    .body;
  return [fromOptions.length, perCall.length];
};

type Options = Omit<
  NonNullable<Parameters<typeof createOptimizer>[0]>,
  'load'
> & { load?: typeof load };
type Input = Omit<Parameters<typeof optimize>[0], 'load'> & {
  load?: typeof load;
};

export const withForwardedLoad = async (options: Options, input: Input) => {
  const fromOptions = await createOptimizer(options)({ url: input.url });
  // @ts-expect-error a 304 has no body
  fromOptions.body.length;
  const perCall = await optimize(input);
  // @ts-expect-error a 304 has no body
  perCall.body.length;
};

export const addSize = (
  options: NonNullable<Parameters<typeof createOptimizer>[0]>
) => options.sizes?.push(512);

export const constQualities = createOptimizer({ qualities: [45, 65] as const });
