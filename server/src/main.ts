import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { config } from "./config";

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix("api");

  await app.listen(config.port, "127.0.0.1");

  console.log(`\n  enzo-ai engine (NestJS) listening on http://127.0.0.1:${config.port}`);
  console.log(`  data dir:      ${config.dataDir}`);
  console.log(`  ollama:        ${config.ollamaUrl}`);
  console.log(`  default model: ${config.defaultModel}\n`);
}

bootstrap();
