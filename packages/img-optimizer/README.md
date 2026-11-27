# img-optimizer

img-optimizer aims to provide a subset of [next/image](https://nextjs.org/docs/api-reference/next/image) as an independent library, easy to integrate with your favorite tools. img-optimizer
delivers compressed images to the browser on demand. It prioritizes the [avif](https://caniuse.com/avif) format when the browser supports it, falling back to [webp](https://caniuse.com/webp).

<hr>

Integration examples:
- [Express](./examples/express/)
- [Rakkas](./examples/rakkas/)
- [vite-plugin-ssr](./examples/vite-plugin-ssr/)

Integration guide:

1. Add a server-side request handler for "/img-optimizer":
```ts
import express from "express";
import { createOptimizer } from "img-optimizer/server";

const app = express();
app.use(express.static("public"));
const optimize = createOptimizer({
    domains: ["some.domain.com"]
});

app.get("/img-optimizer", async (req, res, next) => {
  const result = await optimize({
    url: req.url,
    headers: req.headers,
  });
  const { body, status, headers } = result;
  res.status(status).header(headers).send(body);
});

app.listen(3000, () => {
  console.log("Listening on http://localhost:3000");
});
```

2. Use it on the client/server render:

Simple JS:
```JS
import { createSrcSet } from "img-optimizer";
`
<img srcset="${createSrcSet("/test-8k.jpg")}" />
<img srcset="${createSrcSet("https://some.domain.com/some-image.jpg")}" />
`
```

With React:
```ts
import image from "./test-8k.jpg";
import { Image } from "img-optimizer-react";

export function Page() {
  return (
    <>
        <Image
          src={image}
          fill
          alt=""
          style={{
            objectFit: "contain",
            background: "#cef",
          }}
        />
        <Image
          src="https://some.domain.com/some-image.jpg"
          fill
          alt=""
          style={{
            objectFit: "contain",
            background: "#cef",
          }}
        />
    </>
  );
}
```

createOptimizer options:
- <b>cacheSizeMb?: number</b><br> img-optimizer caches the compressed images and the originals they are made from. This option sets the upper limit of the cache size in megabytes. Older originals are dropped before compressed images, but the original being resized stays cached across its widths when it fits. default: 50
- <b>sizes?: number[]</b><br> img-optimizer can be restricted to only serve specific sizes(width). If the size is not allowed, a 400 bad response will be returned. default: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840]
- <b>qualities?: readonly number[]</b><br> `?quality=` values (1-100) that get their own cached copy of an image. Any other value shares one copy per image, size and format, encoded at the first unlisted quality requested. Without `?quality=`, the format's quality is used. default: none, so every `?quality=` value shares that one copy.
- <b>formats?: Format[]</b><br> default: [
      {
        format: 'avif',
        quality: 45
      },
      {
        format: 'webp',
        quality: 65
      }
    ]
- <b>domains?: string[] | true</b><br> the domains configuration can be used to provide a list of allowed hostnames for external images. Setting it to true removes the restriction.

### Private images

For images that only some users may see, check access in your own route, then pass `load`. `optimize` keys these images by the URL's pathname: it ignores `?src=` on `load` calls and keeps their cache separate from public `?src=` entries. If the same server also mounts a public `/img-optimizer` route, pass a `loadStaticAsset` that only reads your public assets (without it, the public route fetches local paths over localhost with the caller's `Cookie` header and could cache an authorized private route publicly). Requests for the same pathname with the same `etag` at the same time share one `load` call. Within one optimizer, each pathname must name the same image for every request allowed to see it: use a pathname per image, like `/photos/:id/image`, not one that depends on the user, like `/photos/me/image`. Pass `req.originalUrl`, so a route in a mounted `express.Router()` keeps its mount path.
```ts
app.get("/photos/:id/image", async (req, res, next) => {
  try {
    if (!(await canView(req.user, req.params.id))) {
      return res.sendStatus(403);
    }
    const result = await optimize({
      url: req.originalUrl,
      headers: req.headers,
      load: (src, etag) => loadPhoto(req.params.id, etag),
    });
    const { body, status, headers } = result;
    res.status(status).header(headers).send(body);
  } catch (error) {
    next(error);
  }
});
```
`load(src, etag)` gets the request's pathname as `src`, e.g. `"/photos/5/image"`, and `etag` from the cache or from the browser's `If-None-Match`. It returns `{ etag, data }`, where `etag` changes whenever the image does (e.g. its S3 ETag without the quotes) and `data` is its bytes. When `etag` is still current, it returns `{ etag }` without `data`, e.g. when an S3 GET with `IfNoneMatch: etag` answers 304. It returns `null` for a missing image, which answers 404. `createOptimizer({ load })` sets a default loader, and a `load` passed to `optimize` overrides it.

Image and 304 answers carry an `ETag` (including the format, requested width and encoded quality). When the browser's `If-None-Match` matches the current resized copy, the optimizer returns 304 with `body: null`. Image and 304 answers also carry `Cache-Control: private, no-cache`, while 400 and 404 answers carry `private, no-store`. Adding `&v=<etag>` to the URL (`/photos/5/image?size=640&v=<etag>`) lets the browser cache the image for a day (`private, max-age=86400`). An image narrower than the requested `size` is returned at its own width instead of redirecting. If another middleware such as `cors()` already sets `Vary`, merge the optimizer's `Vary` with `res.vary()` instead of `res.header()`, so both values stay. 400 and 404 answers have no `Vary`, so check for it first: `const { Vary, ...rest } = headers; if (Vary) res.vary(Vary); res.status(status).header(rest).send(body);`.
