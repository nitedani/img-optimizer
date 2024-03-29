/// <reference types="vite/client" />
import { vpsMiddleware } from "@nitedani/vite-plugin-ssr-adapter-express";
import { createOptimizer } from "img-optimizer/server";
import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import httpDevServer from "vavite/http-dev-server";

const __dirname = dirname(fileURLToPath(import.meta.url));

startServer();

async function startServer() {
  const app = express();

  const optimize = createOptimizer({
    domains: ["pbs.twimg.com"],
  });
  app.get("/img-optimizer", async (req, res, next) => {
    const result = await optimize({
      url: req.url,
      headers: req.headers,
    });
    const { body, status, headers } = result;
    res.status(status).header(headers).send(body);
  });

  app.use(
    vpsMiddleware({
      root: join(__dirname, "..", "client"),
    })
  );

  if (import.meta.env.PROD) {
    const port = process.env.PORT || 3000;
    app.listen(port);
    console.log(`Server running at http://localhost:${port}`);
  } else {
    httpDevServer!.on("request", app);
  }
}
