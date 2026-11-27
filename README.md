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

### Usage with build tools (webpack, vite):
This library requires the Sharp native dependecies to be present at runtime. There are utilities for both webpack and vite that handle this for you.

- [Vite example](https://github.com/nitedani/vite-plugin-standalone/tree/main/examples/sharp)

- [Webpack](https://github.com/vercel/webpack-asset-relocator-loader)




createOptimizer options:
- <b>cacheSizeMb?: number</b><br> img-optimizer caches the compressed images and the originals they are made from. This option sets the upper limit of the cache size in megabytes. Older originals are dropped before compressed images, but the original being resized stays cached across its widths when it fits. default: 50
- <b>sizes?: number[]</b><br> img-optimizer can be restricted to only serve specific sizes(width). If the size is not allowed, a 400 bad response will be returned. default: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840]
- <b>qualities?: number[]</b><br> `?quality=` values (1-100) that get their own cached copy of an image. Any other value shares one copy per image, size and format, encoded at the first unlisted quality requested. Without `?quality=`, the format's quality is used. default: none, so every `?quality=` value shares that one copy.
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

For images that only some users may see, check access in your own route, then pass `load`. `optimize` keys these images by the URL's pathname, not `?src=`, so a public `?src=` request never reaches them. Requests for the same pathname at the same time share one `load` call. Pass `req.originalUrl`, so a route in a mounted `express.Router()` keeps its mount path. If two routes can serve different images at the same pathname, give each its own optimizer.
```ts
app.get("/photos/:id/image", async (req, res, next) => {
  try {
    if (!(await canView(req.user, req.params.id))) {
      return res.sendStatus(403);
    }
    const result = await optimize({
      url: req.originalUrl,
      headers: req.headers,
      load: (src, cachedVersion) => loadPhoto(req.params.id, cachedVersion),
    });
    const { body, status, headers } = result;
    res.status(status).header(headers).send(body);
  } catch (error) {
    next(error);
  }
});
```
`load(src, cachedVersion)` gets the request's pathname as `src`, e.g. `"/photos/5/image"`, and `cachedVersion` from the cache or from the browser's `If-None-Match` ETag. It returns `{ version, data }`, where `version` changes whenever the image does (e.g. its S3 ETag without the quotes) and `data` is its bytes. When `cachedVersion` is still current, it returns `{ version }` without `data`, e.g. when an S3 GET with `IfNoneMatch: cachedVersion` answers 304. It returns `null` for a missing image, which answers 404. `createOptimizer({ load })` sets a default loader, and a `load` passed to `optimize` overrides it.

Answers carry an `ETag`, so a browser asking again for an unchanged image gets a 304 with `body: null`. They also carry `Cache-Control: private, no-cache`. Adding `&v=<version>` to the URL (`/photos/5/image?size=640&v=<version>`) lets the browser cache the image for a day (`private, max-age=86400`). An image narrower than the requested `size` is returned at its own width instead of redirecting. If another middleware such as `cors()` already sets `Vary`, pass `headers.Vary` to `res.vary()` and leave it out of `res.header()`, so both values stay.
