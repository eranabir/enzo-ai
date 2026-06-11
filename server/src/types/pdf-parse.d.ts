// pdf-parse 1.x ships no types for its internal lib entry. We import the lib
// file directly (not the package root) so its require-time "debug mode" — which
// reads a bundled sample PDF when run as the main module (module.parent === null,
// as happens once ncc-bundled) — never fires.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: unknown;
    metadata: unknown;
    version: string;
  }
  function pdfParse(dataBuffer: Buffer, options?: unknown): Promise<PdfParseResult>;
  export default pdfParse;
}
