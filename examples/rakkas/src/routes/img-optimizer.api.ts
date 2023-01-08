import type { RequestContext } from "rakkasjs";
import { createOptimizer } from "img-optimizer/server";

const optimize = createOptimizer();

export async function get(ctx: RequestContext) {
  const optimized = await optimize({
    url: ctx.url,
    headers: ctx.request.headers,
  });

  return new Response(optimized.body, {
    status: optimized.status,
    headers: optimized.headers,
  });
}
