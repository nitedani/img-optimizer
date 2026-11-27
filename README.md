# img-optimizer

img-optimizer aims to provide a subset of [next/image](https://nextjs.org/docs/api-reference/next/image) as an independent library, easy to integrate with your favorite tools. img-optimizer
delivers compressed images to the browser on demand. It prioritizes the [avif](https://caniuse.com/avif) format when the browser supports it, falling back to [webp](https://caniuse.com/webp).
It requires Node 20.10 or newer.

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
- <b>cacheSizeMb?: number</b><br> img-optimizer caches the compressed images and the originals they are made from. This option sets the upper limit of the cache size in megabytes; originals are dropped first.
- <b>sizes?: number[]</b><br> img-optimizer can be restricted to only serve specific sizes(width). If the size is not allowed, a 400 bad response will be returned. default: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840]
- <b>qualities?: number[]</b><br> `?quality=` values (1-100) that get their own cached copy of an image. Other values share one copy per image, size and format, encoded at the first of them asked for. Without `?quality=`, the format's quality is used.
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

For images that only some users may see, check access in your own route, then pass `load`. The optimizer serves the image at the request's path instead of `?src=`, so a public `?src=` request never reaches it. Requests for the same path at the same time share one `load` call, so check access before calling `optimize`.
```ts
app.get("/photos/:id/image", async (req, res, next) => {
  try {
    if (!(await canView(req.user, req.params.id))) {
      return res.sendStatus(403);
    }
    const result = await optimize({
      url: req.url,
      headers: req.headers,
      load: (src, held) => loadPhoto(req.params.id, held),
    });
    const { body, status, headers } = result;
    res.status(status).header(headers).send(body);
  } catch (error) {
    next(error);
  }
});
```
`load(src, held)` returns `{ version, data }`, or `null` for a missing image (a 404). `version` changes whenever the image does, e.g. its S3 ETag without the quotes, and `data` is its bytes. `held` is the version the optimizer already has: when it is still current, leave out `data`, e.g. from an S3 GET with `IfNoneMatch: held`. Answers carry an `ETag`, so a browser asking again for an unchanged image gets a 304 with no download, and `Cache-Control: private, no-cache`; a page that puts the version in the URL (`/photos/5/image?size=640&v=<version>`) lets the browser keep it for a day. An image narrower than the size is answered at its own width. `createOptimizer({ load })` uses one loader for every request.
