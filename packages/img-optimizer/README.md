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
  const {
    body,
    status,
    headers: { Vary, ...headers },
  } = result;
  if (Vary) {
    res.vary(Vary); // header() would replace a Vary set before
  }
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
- <b>cacheSizeMb?: number</b><br> img-optimizer caches the compressed images. This option sets the upper limit of the cache size in megabytes.
- <b>sizes?: number[]</b><br> img-optimizer can be restricted to only serve specific sizes(width). If the size is not allowed, a 400 bad response will be returned. default: [360, 640, 1024, 1280, 1600, 1920, 2560, 3840]
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

For images that only some users may see, call a separate optimizer from your own route: check access first, put the image's version into `src` so a replaced image is resized again, load the bytes with `loadStaticAsset`, and set `cacheControl`. Its cache is keyed by `src`, so a route that takes `src` from the request must not share it. Pass only the Accept header: the default `domains` refuses a local `src` resolved against a Host header other than localhost.
```ts
const optimizePrivate = createOptimizer();

app.get("/photos/:id/image", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!(await canView(req.user, id))) {
      return res.sendStatus(403);
    }
    const version = await photoVersion(id); // e.g. the S3 ETag
    if (!version) {
      return res.sendStatus(404);
    }
    const src = encodeURIComponent(`/photos/${id}/${version}`);
    const {
      body,
      status,
      headers: { Vary, ...headers },
    } = await optimizePrivate({
      url: `${req.baseUrl}${req.path}?src=${src}&size=${Number(req.query.size)}`,
      headers: { accept: req.headers.accept },
      loadStaticAsset: () => loadPhoto(id),
      cacheControl: "private, no-cache",
    });
    if (Vary) {
      res.vary(Vary);
    }
    res.status(status).header(headers).send(body);
  } catch (error) {
    next(error);
  }
});
```
The page asks for `/photos/5/image?size=640`; an image narrower than the size is redirected to its own width on the same path.