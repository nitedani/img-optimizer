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
- <b>cacheSizeMb?: number</b><br> img-optimizer caches the compressed images and the originals they are made from. This option sets the upper limit of the cache size in megabytes. Originals are dropped before compressed images and are only kept when they fit alongside the cached compressed images. default: 50
- <b>sizes?: number[]</b><br> img-optimizer can be restricted to only serve specific sizes(width). If the size is not allowed, a 400 bad response will be returned. default: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840]
- <b>qualities?: readonly number[]</b><br> `?quality=` values (1-100) that get their own cached copy. Any other valid value, including no `?quality=`, which means the format's quality, shares one copy per image, size and format, encoded at the first one requested while it is cached. default: none.
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

For images that only some users may see, check access in your own route (here in a `requirePhotoAccess` middleware), then pass a `load` function that reads the image from your storage:
```ts
const optimizePhoto = createOptimizer();

app.get("/photos/:id/image", requirePhotoAccess, async (req, res, next) => {
  try {
    const { body, status, headers } = await optimizePhoto({
      url: req.originalUrl,
      headers: req.headers,
      load: async (src, etag) => {
        const photo = await getPhoto(req.params.id);
        return photo ? { etag: photo.etag, data: photo.bytes } : null;
      },
    });
    res.status(status).header(headers).send(body);
  } catch (error) {
    next(error);
  }
});
```
```html
<img src="/photos/5/image?size=640" />
```
If earlier middleware such as `cors({ origin: true })` sets `Vary`, merge `headers.Vary` with `res.vary(Vary)` instead of overwriting it (400 and 404 answers have no `Vary`):
`const { Vary, ...rest } = headers; if (Vary) res.vary(Vary); res.status(status).header(rest).send(body);`

`load(src, etag)` gets the URL's pathname as `src`. It returns `{ etag, data }`, where `etag` changes whenever the image does (e.g. its S3 ETag without the quotes) and `data` is its bytes, or `null` for a missing image, which answers 404. When the `etag` it is given is still current, it may return just `{ etag }` instead, e.g. when an S3 GET with `IfNoneMatch: etag` answers 304. `createOptimizer({ load })` sets a default loader, and a `load` passed per call overrides it. Within one optimizer, each pathname must name the same image for everyone allowed to see it: use `/photos/5/image`, not `/photos/me/image`. If the same server also serves the public `/img-optimizer` route, give that optimizer a `loadStaticAsset` that only reads your public assets; without it, the public route fetches local paths over localhost with the caller's `Cookie` header and could cache a private image publicly.

Images and 304s carry an `ETag` and `Cache-Control: private, no-cache`, and a request whose `If-None-Match` matches that `ETag` gets a 304 with `body: null`. Adding `&v=<etag>`, with the `etag` your `load` returns, to the URL lets the browser keep the image for a day. 400 and 404 answers carry `private, no-store`. An image narrower than `size` is returned at its own width instead of redirecting.
