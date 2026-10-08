/* eslint-disable no-restricted-syntax */
import path from "node:path";
import JSZip from "jszip";

export async function extractPdfPageTexts(bytes: Uint8Array, pageCount: number): Promise<string[]> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: bytes });
    const document = await loadingTask.promise;
    const texts: string[] = [];
    for (let index = 1; index <= pageCount; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      texts.push(text);
      page.cleanup();
    }
    await loadingTask.destroy();
    return texts;
  } catch {
    return Array.from({ length: pageCount }, () => "");
  }
}
 
export async function extractKnowledgeFilePageTexts(fileName: string, bytes: Uint8Array, pageCount: number): Promise<string[]> {
  const extension = path.extname(fileName).toLowerCase();
  if (extension === ".pdf") return extractPdfPageTexts(bytes, pageCount);
  const textExtensions = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".css", ".js", ".jsx", ".ts", ".tsx", ".yml", ".yaml", ".toml", ".ini", ".log", ".sql", ".tex", ".bib", ".svg", ".rst", ".org", ".properties", ".env", ".mjs", ".cjs", ".vue", ".svelte", ".py", ".java", ".c", ".h", ".cpp", ".hpp", ".cs", ".go", ".rs", ".swift", ".kt", ".kts", ".rb", ".php", ".sh", ".bash", ".zsh", ".fish", ".bat", ".cmd", ".ps1", ".graphql", ".gql"]);
  if (textExtensions.has(extension)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\\u0000/gu, "").trim();
    return [text];
  }
  if (extension === ".docx" || extension === ".xlsx" || extension === ".pptx" || extension === ".odt" || extension === ".ods" || extension === ".odp" || extension === ".epub") {
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) => /\\.(?:xml|rels)$/u.test(name));
    const chunks: string[] = [];
    for (const name of names) {
      const entry = zip.files[name];
      if (!entry || entry.dir) continue;
      const xml = await entry.async("string");
      const text = xml.replace(/<[^>]+>/gu, " ").replace(/&amp;/gu, "&").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">").replace(/\\s+/gu, " ").trim();
      if (text) chunks.push(text);
    }
    return [chunks.join("\\n")];
  }
  const looksBinary = bytes.slice(0, Math.min(bytes.length, 4096)).some((byte) => byte === 0);
  if (!looksBinary) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/\\u0000/gu, "").trim();
    if (text) return [text];
  }
  return [`[ファイル] ${fileName}\\n[拡張子] ${extension || "(なし)"}\\n[サイズ] ${bytes.byteLength} bytes`];
}
