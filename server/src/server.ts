import express from "express";
import cors from "cors";
import compression from "compression";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { config } from "./config.js";
import { container } from "./container.js";
import { securityHeadersMiddleware } from "./middleware/securityHeaders.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { errorHandlerMiddleware } from "./middleware/errorHandler.js";
import { createRootRouter } from "./routes/index.js";
import { seedDemoData } from "./services/demoSeed.js";
import { logger } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(c = container) {
  const app = express();

  app.use(requestIdMiddleware);
  app.use(compression());
  app.use(cors());
  app.use(securityHeadersMiddleware);
  app.use(express.json({ limit: "1mb" }));

  // OpenAPI 3.0 specification endpoint (§7 Code Quality & Architecture)
  const candidateDocPaths = [
    path.resolve(process.cwd(), "docs/openapi.json"),
    path.resolve(__dirname, "../../../docs/openapi.json"),
    path.resolve(__dirname, "../../docs/openapi.json"),
  ];
  const openApiPath = candidateDocPaths.find((p) => fs.existsSync(p));
  if (openApiPath) {
    const serveOpenApi = (_req: express.Request, res: express.Response) => {
      res.setHeader("Content-Type", "application/json");
      res.sendFile(openApiPath);
    };
    app.get("/api/docs", serveOpenApi);
    app.get("/api/docs/openapi.json", serveOpenApi);
  }

  // Mount API & health routes
  app.use(createRootRouter(c));

  // Seed demo household, users and sessions
  seedDemoData(c).catch((err) => logger.warn({ err }, "Seed error"));

  // Serve SPA frontend in production
  const candidateStaticPaths = [
    path.resolve(process.cwd(), "web/dist"),
    path.resolve(__dirname, "../../../web/dist"),
    path.resolve(__dirname, "../../web/dist"),
  ];
  const staticPath = candidateStaticPaths.find((p) => fs.existsSync(p));
  if (staticPath) {
    app.use(express.static(staticPath, { maxAge: "1d" }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path === "/health" || req.path === "/ready") {
        return next();
      }
      res.sendFile(path.join(staticPath, "index.html"));
    });
  }

  // Central error handler
  app.use(errorHandlerMiddleware);

  return app;
}

const app = createApp();

if (process.env["NODE_ENV"] !== "test") {
  app.listen(config.PORT, "0.0.0.0", () => {
    logger.info(`VayuMitra Server running on http://0.0.0.0:${config.PORT} [${config.NODE_ENV}]`);
  });
}
