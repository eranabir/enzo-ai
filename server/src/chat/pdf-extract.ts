import { createCanvas } from "@napi-rs/canvas";
import { createWorker } from "tesseract.js";

/**
 * Direct text-layer extraction via pdfjs-dist's low-level getTextContent() API,
 * used instead of pdf-parse's own text-joining. pdf-parse (and naive joins in
 * general) can come out with word order reversed on Hebrew/RTL lines — but the
 * individual text items pdfjs returns are already in correct logical order
 * (each item's own `str` reads correctly); the bug is specifically in how a
 * simpler joiner concatenates items across a line. Joining items in the order
 * pdfjs already returns them — adding a space between items on a run and a
 * newline at each item's own `hasEOL` flag — reproduces correct reading order
 * without needing any Hebrew/BiDi-specific logic at all.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;

  let text = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    for (const item of content.items as { str: string; hasEOL: boolean }[]) {
      if (!item.str) {
        if (item.hasEOL) text += "\n";
        continue;
      }
      if (text && !text.endsWith("\n") && !text.endsWith(" ") && !item.str.startsWith(" ")) {
        text += " ";
      }
      text += item.str;
      if (item.hasEOL) text += "\n";
    }
    text += "\n";
  }
  return text.trim();
}

/**
 * OCR fallback for scanned/image-only PDFs (no text layer at all) — e.g. a
 * phone photo of a paper form, or a clinic printout run through a scanner.
 * Rasterizes each page (pdfjs-dist + @napi-rs/canvas, both permissively
 * licensed — MuPDF-based rasterizers are AGPL and would taint this project's
 * MIT license) and OCRs it with Tesseract using Hebrew + English trained data.
 * Only invoked when extractPdfText comes back empty, since OCR takes real
 * time (seconds per page).
 */
export async function ocrPdfBuffer(buffer: Buffer): Promise<string> {
  const pdfjsLib: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;

  const worker = await createWorker(["heb", "eng"]);
  try {
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const ctx = canvas.getContext("2d");
      await page.render({ canvasContext: ctx as any, viewport }).promise;
      const { data } = await worker.recognize(canvas.toBuffer("image/png"));
      pages.push(data.text.trim());
    }
    return pages.join("\n\n").trim();
  } finally {
    await worker.terminate();
  }
}
