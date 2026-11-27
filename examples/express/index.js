import express from "express";
import { createSrcSet } from "img-optimizer";
import { createOptimizer } from "img-optimizer/server";

const app = express();

app.get("/", (req, res) => {
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
            <img srcset="${createSrcSet("/test-8k.jpg")}" />
            <img srcset="${createSrcSet(
              "https://pbs.twimg.com/media/ELSHvYBUUAAH4j1.jpg:large"
            )}" />
        </body>
    </html>
    `);
});

const optimize = createOptimizer({
  domains: ["pbs.twimg.com"],
});
app.use(express.static("public"));
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
