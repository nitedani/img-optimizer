import type { RequestContext } from "rakkasjs";
import { createOptimizer } from "img-optimizer/server";

const optimize = createOptimizer({
  domains: ["pbs.twimg.com"],
});

export async function get(ctx: RequestContext) {
  const result = await optimize({
    url: ctx.url,
    headers: ctx.request.headers,
  });

  return new Response(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
