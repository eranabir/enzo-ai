import "reflect-metadata";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response, NextFunction } from "express";
import { AppModule } from "./app.module";
import { config } from "./config";

async function bootstrap() {
  // Disable Nest's default body parser so we can raise the size limit — chat
  // messages can carry a base64-encoded document or image attachment, which the
  // 100 KB Express default would reject ("request entity too large").
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true, bodyParser: false });
  const express = require("express");
  const BODY_LIMIT = "30mb";
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ extended: true, limit: BODY_LIMIT }));
  app.setGlobalPrefix("api");

  const webDir = process.env.ENZO_WEB_DIR ?? "";
  const expressApp = app.getHttpAdapter().getInstance();

  if (webDir && existsSync(webDir)) {
    // Register static middleware BEFORE NestJS initialises its routes.
    // NestJS swallows unmatched routes and never calls next(), so any
    // middleware registered AFTER init() can never be reached for unknown paths.
    //
    // The SPA catch-all explicitly skips /api/* paths and calls next() for
    // them — NestJS picks them up when it registers its router afterwards.
    expressApp.use(require("express").static(webDir));
    expressApp.get("/{*path}", (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(join(webDir, "index.html"));
    });
    console.log(`  web assets:    ${webDir}`);
  } else {
    console.log(`  web assets:    dev mode (Vite)`);
  }

  await app.listen(config.port, config.host);

  console.log(`\n  enzo-ai engine (NestJS) listening on http://${config.host}:${config.port}`);
  console.log(`  data dir:      ${config.dataDir}`);
  console.log(`  ollama:        ${config.ollamaUrl}`);
  console.log(`  default model: ${config.defaultModel}\n`);
}

bootstrap();
