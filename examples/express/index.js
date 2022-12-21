import express from "express";
import { createSrcSet } from "@nitedani/img-optimizer";
import { createOptimizer } from "@nitedani/img-optimizer/server";
import { readFile } from "fs/promises";

const app = express();

app.get("/", (req, res) => {
  const srcset = createSrcSet("/test-8k.jpg");
  res.send(`
    <html>
        <style>
            body{
                margin: 0;
            }
        </style>
        <head>
            <title>Img Optimizer</title>
        </head>
        <body>
            <img srcset="${srcset}" />
        </body>
    </html>
    `);
});

const optimize = createOptimizer({
  loadStaticAsset: (src) => {
    return readFile(`public${src}`);
  },
});
app.get("/_image", async (req, res, next) => {
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
