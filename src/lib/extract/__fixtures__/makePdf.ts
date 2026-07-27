/**
 * Test-only PDF factory.
 *
 * Builds tiny, uncompressed, hand-rolled PDFs entirely in memory so the PDF
 * tests have real bytes to chew on without checking binaries into the repo.
 * Encryption is delegated to `qpdf`; qpdf cannot read a PDF from stdin (it
 * needs random access), so the *synthetic* plaintext goes to a scratch file
 * that is deleted immediately, while the encrypted result comes back over
 * stdout. Nothing here is real user data, and the production path in `pdf.ts`
 * touches the filesystem at no point.
 *
 * Only used by *.test.ts. Never imported by application code.
 */

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface PdfTextItem {
  /** PDF user-space X, origin bottom-left. */
  x: number;
  /** PDF user-space Y, origin bottom-left — bigger Y is higher on the page. */
  y: number;
  text: string;
  size?: number;
}

export interface PdfPageSpec {
  items: PdfTextItem[];
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 612;
const DEFAULT_HEIGHT = 792;
const DEFAULT_SIZE = 10;

/** PDF literal strings need `\`, `(` and `)` escaped. */
function escapePdfString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function contentStreamFor(items: readonly PdfTextItem[]): string {
  const parts: string[] = ["BT"];
  for (const item of items) {
    const size = item.size ?? DEFAULT_SIZE;
    parts.push(`/F1 ${size} Tf`);
    parts.push(`1 0 0 1 ${item.x} ${item.y} Tm`);
    parts.push(`(${escapePdfString(item.text)}) Tj`);
  }
  parts.push("ET");
  return parts.join("\n");
}

/**
 * Assemble a PDF with one Type1 Helvetica font and one uncompressed content
 * stream per page. Offsets for the xref table are tracked byte-exactly, which
 * is why everything is concatenated as latin1 buffers rather than a string.
 */
export function buildPdf(pages: readonly PdfPageSpec[]): Uint8Array {
  if (pages.length === 0) throw new Error("buildPdf needs at least one page");

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let cursor = 0;

  const push = (s: string) => {
    const buf = Buffer.from(s, "latin1");
    chunks.push(buf);
    cursor += buf.length;
  };

  // Object numbering: 1 catalog, 2 pages, 3 font, then per page a page object
  // followed by its content stream.
  const firstPageObj = 4;
  const objNumForPage = (i: number) => firstPageObj + i * 2;
  const objNumForContent = (i: number) => firstPageObj + i * 2 + 1;
  const totalObjects = 3 + pages.length * 2;

  const startObj = (num: number) => {
    offsets[num] = cursor;
    push(`${num} 0 obj\n`);
  };

  push("%PDF-1.4\n%âãÏÓ\n");

  startObj(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObj(2);
  const kids = pages.map((_, i) => `${objNumForPage(i)} 0 R`).join(" ");
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  startObj(3);
  push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
  );

  pages.forEach((page, i) => {
    const width = page.width ?? DEFAULT_WIDTH;
    const height = page.height ?? DEFAULT_HEIGHT;
    const stream = contentStreamFor(page.items);
    const streamLength = Buffer.byteLength(stream, "latin1");

    startObj(objNumForPage(i));
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> ` +
        `/Contents ${objNumForContent(i)} 0 R >>\nendobj\n`,
    );

    startObj(objNumForContent(i));
    push(`<< /Length ${streamLength} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });

  const xrefOffset = cursor;
  push(`xref\n0 ${totalObjects + 1}\n`);
  push("0000000000 65535 f \n");
  for (let num = 1; num <= totalObjects; num++) {
    push(`${String(offsets[num]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return new Uint8Array(Buffer.concat(chunks));
}

export interface LineLayoutOptions {
  /** X position of each column, in order. Extra segments reuse the last gap. */
  columnX?: number[];
  startY?: number;
  lineHeight?: number;
  size?: number;
  pageHeight?: number;
}

/**
 * Lay out rows of column segments as text items, top of page downwards.
 *
 * `rows[i]` is one visual line; `rows[i][j]` is the segment in column j. This
 * is what makes the line-grouping assertions meaningful — pdfjs sees N separate
 * text items at the same Y and `extractText` has to put them back together.
 */
export function pageFromRows(
  rows: readonly (readonly string[])[],
  options: LineLayoutOptions = {},
): PdfPageSpec {
  const columnX = options.columnX ?? [50, 170, 330, 430, 510];
  const startY = options.startY ?? 720;
  const lineHeight = options.lineHeight ?? 16;
  const size = options.size ?? DEFAULT_SIZE;

  const items: PdfTextItem[] = [];
  rows.forEach((row, rowIndex) => {
    const y = startY - rowIndex * lineHeight;
    row.forEach((segment, colIndex) => {
      if (segment === "") return;
      const x =
        columnX[colIndex] ??
        columnX[columnX.length - 1] + (colIndex - columnX.length + 1) * 80;
      items.push({ x, y, text: segment, size });
    });
  });

  return { items, height: options.pageHeight ?? DEFAULT_HEIGHT };
}

/** Convenience: a single-page PDF whose rows are laid out in columns. */
export function buildPdfFromRows(
  rows: readonly (readonly string[])[],
  options?: LineLayoutOptions,
): Uint8Array {
  return buildPdf([pageFromRows(rows, options)]);
}

/**
 * A PDF with a page but no text operators at all — stands in for a scanned
 * statement whose pages are one big image with no text layer.
 */
export function buildTextlessPdf(): Uint8Array {
  return buildPdf([{ items: [] }]);
}

export interface EncryptOptions {
  userPassword: string;
  ownerPassword?: string;
  bits?: 40 | 128 | 256;
}

let qpdfAvailability: boolean | null = null;

/** True when `qpdf` can be executed; encryption tests skip themselves if not. */
export async function hasQpdf(): Promise<boolean> {
  if (qpdfAvailability !== null) return qpdfAvailability;
  try {
    await runQpdf(["--version"]);
    qpdfAvailability = true;
  } catch {
    qpdfAvailability = false;
  }
  return qpdfAvailability;
}

function runQpdf(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("qpdf", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];

    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      // qpdf exit code 3 means "warnings only"; the output is still valid.
      if (code === 0 || code === 3) resolve(Buffer.concat(out));
      else reject(new Error(`qpdf exited ${code}: ${Buffer.concat(err).toString()}`));
    });
  });
}

/**
 * Encrypt a PDF with qpdf. The encrypted bytes are read from stdout; the only
 * thing that reaches disk is the synthetic, throwaway plaintext input, in a
 * scratch directory removed before this resolves.
 */
export async function encryptPdf(
  bytes: Uint8Array,
  options: EncryptOptions,
): Promise<Uint8Array> {
  // 256-bit AES: qpdf 11+ refuses to emit the older RC4-based schemes.
  const bits = options.bits ?? 256;
  const owner = options.ownerPassword ?? options.userPassword;
  const dir = await mkdtemp(join(tmpdir(), "mm-pdf-fixture-"));
  const input = join(dir, "in.pdf");
  try {
    await writeFile(input, bytes);
    const out = await runQpdf([
      "--encrypt",
      `--user-password=${options.userPassword}`,
      `--owner-password=${owner}`,
      `--bits=${bits}`,
      "--",
      input,
      "-",
    ]);
    return new Uint8Array(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
