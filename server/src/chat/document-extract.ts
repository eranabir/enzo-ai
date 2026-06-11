// Extract plain text from an uploaded chat document so it can be inlined into
// the model's context. Supports PDF (pdf-parse), Word .docx (mammoth),
// Excel/CSV .xlsx/.xls (SheetJS), and any UTF-8 text/code/markdown file.
//
// Import the lib file directly (not the package root): pdf-parse's index runs a
// "debug mode" that reads a bundled sample PDF when `module.parent` is null —
// which happens once ncc-bundled — so the subpath import avoids that crash.
// pdf-parse 1.x uses the legacy pdfjs build, which (unlike 2.x) does not touch
// DOMMatrix/canvas at load time and so survives ncc bundling for text extraction.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import * as mammoth from "mammoth";
import * as XLSX from "xlsx";

/** File extensions we treat as plain UTF-8 text (read as-is). */
const TEXT_EXTS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "log", "xml", "yaml",
  "yml", "html", "htm", "css", "ts", "tsx", "js", "jsx", "py", "rb", "go",
  "rs", "java", "c", "h", "cpp", "cc", "cs", "php", "sh", "bash", "sql", "ini",
  "toml", "env", "conf",
]);

export const DOCUMENT_ACCEPT =
  ".txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.log,.xml,.yaml,.yml,.html,.htm," +
  ".css,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cc,.cs,.php,.sh," +
  ".sql,.toml,.ini,.pdf,.doc,.docx,.xls,.xlsx," +
  "application/pdf," +
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document," +
  "application/msword," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-excel,text/*";

function ext(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

/** Excel/CSV → one CSV block per sheet, prefixed with the sheet name. */
function extractSpreadsheet(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const parts: string[] = [];
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
    if (csv.trim()) parts.push(wb.SheetNames.length > 1 ? `# Sheet: ${name}\n${csv}` : csv);
  }
  return parts.join("\n\n");
}

/**
 * Extract readable text from a document buffer. Returns the extracted text
 * (possibly empty for an image-only/blank doc). Throws with a friendly message
 * if the format isn't supported or parsing fails.
 */
export async function extractDocumentText(
  buffer: Buffer,
  mime: string,
  filename: string,
): Promise<string> {
  const e = ext(filename);
  const m = (mime || "").toLowerCase();

  try {
    if (e === "pdf" || m.includes("pdf")) {
      const data = await pdfParse(buffer);
      return (data.text || "").trim();
    }
    if (e === "docx" || e === "doc" || m.includes("wordprocessingml") || m === "application/msword") {
      const { value } = await mammoth.extractRawText({ buffer });
      return (value || "").trim();
    }
    if (e === "xlsx" || e === "xls" || m.includes("spreadsheetml") || m.includes("ms-excel")) {
      return extractSpreadsheet(buffer).trim();
    }
    if (TEXT_EXTS.has(e) || m.startsWith("text/") || m.includes("json") || m.includes("xml")) {
      return buffer.toString("utf8").trim();
    }
  } catch (err) {
    throw new Error(`Could not read "${filename}": ${(err as Error).message}`);
  }

  throw new Error(`Unsupported file type: "${filename}". Upload a PDF, Word, Excel, or text/code file.`);
}
