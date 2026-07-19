# Third-Party Notices

EnzoAI is distributed under the [MIT License](LICENSE). Its installers, Docker
image, and source distribution include or depend on third-party software,
listed below with their respective licenses.

---

## Ollama

The EnzoAI desktop installers bundle the [Ollama](https://github.com/ollama/ollama)
binary, and the EnzoAI Docker image includes the Ollama binary copied from the
official `ollama/ollama` image. Ollama is distributed under the MIT License:

```
MIT License

Copyright (c) Ollama

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## AI models

EnzoAI does **not** distribute any AI model weights. Models (e.g. Llama,
Gemma, Mistral, Qwen) are downloaded by the user at runtime via Ollama and are
subject to their own licenses (for example, the Llama Community License for
Meta Llama models). By pulling a model you agree to that model's license
terms.

## Node.js dependencies

The EnzoAI server, web UI, CLI, and desktop app bundle open-source npm
packages, each under its own license (MIT, Apache-2.0, BSD, ISC, and similar
permissive licenses). Notable components include:

- [Electron](https://github.com/electron/electron) — MIT
- [NestJS](https://github.com/nestjs/nest) — MIT
- [React](https://github.com/facebook/react) — MIT
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — MIT
- [Express](https://github.com/expressjs/express) — MIT
- [Telegraf](https://github.com/telegraf/telegraf) — MIT
- [pdf.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) — Apache-2.0
- [@napi-rs/canvas](https://github.com/Brooooooklyn/canvas) — MIT
- [Tesseract.js](https://github.com/naptha/tesseract.js) (wraps the Apache-2.0 [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) engine) — Apache-2.0. Used for OCR fallback on scanned/image-only PDF uploads; chosen specifically over MuPDF-based rasterizers, which are AGPL/commercial-dual-licensed and would be incompatible with EnzoAI's MIT license.

The complete dependency list and license metadata are available in the
`package.json` files of each workspace and in the packages' own repositories.

## Trademarks

OpenAI, Anthropic, Claude, Google, Gemini, Meta, Llama, Telegram, Discord,
Slack, Ollama, and GitHub are trademarks of their respective owners. EnzoAI
uses these names and logos solely to identify the services it can integrate
with. EnzoAI is an independent open-source project and is not affiliated
with, sponsored by, or endorsed by any of these companies.
