/**
 * PDF decryption and text extraction.
 *
 * SECURITY: decrypted statement content never touches disk. There is no `fs`
 * import in this module, no temp file, no cache directory. Bytes arrive as a
 * Uint8Array, are copied into a private buffer, are read by pdf.js in memory,
 * and that buffer is zeroed before this module lets go of it. The caller gets
 * a string; the plaintext PDF is not persisted anywhere by us.
 *
 * LAYOUT: a bank statement is a table, and a table that has been flattened into
 * one long line of words is unextractable — "500.00" is meaningless once you
 * cannot tell which row and column it sat in. So we rebuild lines from the
 * geometry: cluster text items by Y, sort by X inside each cluster, and turn
 * horizontal gaps back into whitespace.
 */

import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/**
 * Canvas shims, installed before pdf.js is imported.
 *
 * pdf.js reaches for `DOMMatrix`, `Path2D` and `ImageData` at module scope and
 * tries to polyfill them from the optional `@napi-rs/canvas` native package. On
 * a serverless host that package is not installed, the polyfill is skipped with
 * a warning, and the module then throws `ReferenceError: DOMMatrix is not
 * defined` on import — taking the whole route down with an HTML 500 before any
 * of our code runs.
 *
 * These symbols are only used for RENDERING. We extract text and never
 * rasterise a page, so they need to exist, not to work. Pulling in a ~40MB
 * native canvas build to satisfy an import we never exercise would be the wrong
 * trade.
 */
function installCanvasShims(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrixShim {
      a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
      constructor(init?: number[] | string) {
        if (Array.isArray(init) && init.length >= 6) {
          [this.a, this.b, this.c, this.d, this.e, this.f] = init;
        }
      }
      // pdf.js chains these when building render transforms; returning `this`
      // keeps any such call harmless on a path we never take.
      multiply() { return this; }
      translate() { return this; }
      scale() { return this; }
      rotate() { return this; }
      invertSelf() { return this; }
    };
  }

  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2DShim {
      addPath() {}
      moveTo() {}
      lineTo() {}
      bezierCurveTo() {}
      quadraticCurveTo() {}
      closePath() {}
      rect() {}
    };
  }

  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageDataShim {
      readonly data: Uint8ClampedArray;
      constructor(readonly width: number, readonly height: number) {
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

/**
 * Load pdf.js once, with the shims in place first.
 *
 * The import has to be dynamic: a static one is hoisted above every statement
 * in the module, so the shims would be installed too late to matter.
 */
function loadPdfjs(): Promise<PdfjsModule> {
  pdfjsPromise ??= (async () => {
    installCanvasShims();
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return pdfjsPromise;
}

/**
 * The legacy build's type entrypoint does not re-export the text-content item
 * shapes, so we declare the subset we actually read. `transform` is a 6-element
 * PDF matrix; indices 4 and 5 are the x and y we cluster on.
 */
interface TextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
}

interface TextMarkedContent {
  type: string;
  id?: string | null;
}

import type { ExtractedText } from "@/lib/core/types";
import {
  NoTextLayerError,
  PasswordRequiredError,
  PdfParseError,
  WrongPasswordError,
} from "./errors";

export {
  NoTextLayerError,
  PasswordRequiredError,
  PdfParseError,
  WrongPasswordError,
} from "./errors";

/**
 * Page boundary marker. The form feed makes it unambiguously splittable (no
 * statement contains one) while the readable label keeps the LLM oriented when
 * a long statement is chunked across several calls.
 */
export const PAGE_MARKER_PREFIX = "\f";
export function pageMarker(pageNumber: number): string {
  return `${PAGE_MARKER_PREFIX}--- page ${pageNumber} ---`;
}

/**
 * A PDF whose text layer yields fewer than this many non-space characters is
 * treated as having no text layer. Scanned statements often still carry a
 * stray watermark or producer string, so ">0" is too generous a test.
 */
const MIN_TEXT_LAYER_CHARS = 12;

export interface PdfText extends ExtractedText {
  /**
   * False when the PDF is a scan: pages exist but there is no readable text.
   * `viaOcr` stays false because we did not OCR it — this flag is how a caller
   * knows to tell the user "this looks scanned" rather than "extraction failed".
   */
  hasTextLayer: boolean;
  /** Per-page text, already line-grouped. Index 0 is page 1. */
  pages: string[];
}

/** A text run with enough geometry to put it back on its line. */
export interface PositionedTextItem {
  text: string;
  /** User-space X of the run's left edge. */
  x: number;
  /** User-space Y of the baseline. Larger is further up the page. */
  y: number;
  /** Advance width of the run in user space. */
  width: number;
  /** Rendered font size, used to scale the gap thresholds. */
  fontSize: number;
}

/**
 * Extract text from a (possibly encrypted) PDF.
 *
 * Throws `PasswordRequiredError` when the file is encrypted and no password was
 * given, and `WrongPasswordError` when the given one does not open it — pdf.js
 * signals both with a single `PasswordException`, distinguished only by `code`.
 */
export async function extractText(
  bytes: Uint8Array,
  password?: string,
): Promise<PdfText> {
  // Copy for two reasons: pdf.js can take ownership of (and detach) the buffer
  // it is handed, and it rejects Node `Buffer`s outright. The copy is ours to
  // zero afterwards.
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);

  const trimmedPassword = password && password.length > 0 ? password : undefined;

  const { getDocument } = await loadPdfjs();

  const loadingTask = getDocument({
    data,
    password: trimmedPassword,
    // Nothing is fetched or rendered: we only want the text layer.
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableAutoFetch: true,
    stopAtErrors: false,
    verbosity: 0,
  });
  // Deliberately no `onPassword` handler — without one pdf.js rejects the
  // loading task with the PasswordException we want to translate.

  let doc: PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    scrub(data);
    await loadingTask.destroy().catch(() => {});
    throw translateOpenError(err);
  }

  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const items = toPositionedItems(content.items);
        pages.push(groupItemsIntoLines(items).join("\n"));
      } finally {
        page.cleanup();
      }
    }

    const text = pages
      .map((pageText, index) => `${pageMarker(index + 1)}\n${pageText}`)
      .join("\n");

    const textualChars = pages.join("").replace(/\s/g, "").length;

    return {
      text,
      pages,
      pageCount: doc.numPages,
      hasTextLayer: textualChars >= MIN_TEXT_LAYER_CHARS,
      // We do not OCR. If the day comes, this is the flag that flips.
      viaOcr: false,
      wasEncrypted: await detectEncrypted(doc, trimmedPassword !== undefined),
    };
  } catch (err) {
    throw err instanceof Error && err.name === "PdfParseError"
      ? err
      : new PdfParseError(describe(err), err);
  } finally {
    // Destroying the loading task tears down the document and its worker too.
    await loadingTask.destroy().catch(() => {});
    scrub(data);
  }
}

/**
 * Convenience wrapper for callers that want "give me text or tell me why not":
 * turns a text-layer-less PDF into a typed error instead of an empty string.
 */
export async function extractTextOrThrow(
  bytes: Uint8Array,
  password?: string,
): Promise<PdfText> {
  const result = await extractText(bytes, password);
  if (!result.hasTextLayer) throw new NoTextLayerError(result.pageCount);
  return result;
}

// ---------------------------------------------------------------------------
// Line reconstruction
// ---------------------------------------------------------------------------

/** Y values within this fraction of the font size count as the same line. */
const LINE_TOLERANCE_RATIO = 0.45;
/** Gaps below this fraction of the font size are kerning, not a space. */
const GLUE_RATIO = 0.18;
/** Gaps above this fraction of the font size are a column break. */
const COLUMN_RATIO = 1.2;
/** What a column break becomes in the output text. */
const COLUMN_GAP = "   ";

function toPositionedItems(
  items: readonly (TextItem | TextMarkedContent)[],
): PositionedTextItem[] {
  const out: PositionedTextItem[] = [];
  for (const item of items) {
    // Marked-content markers carry no text; they have no `str`.
    if (!("str" in item)) continue;
    if (item.str === "") continue;

    const transform = item.transform as number[];
    // The vertical scale is the reliable font-size proxy: pdf.js reports
    // `height: 0` for the synthetic whitespace runs it inserts between columns.
    const fontSize = Math.abs(transform[3]) || item.height || 10;
    const width =
      item.width || estimateWidth(item.str, fontSize);

    out.push({
      text: item.str,
      x: transform[4],
      y: transform[5],
      width,
      fontSize,
    });
  }
  return out;
}

function estimateWidth(text: string, fontSize: number): number {
  // Helvetica averages a shade over half an em per character. Only used when
  // pdf.js reports no width, which is rare.
  return text.length * fontSize * 0.5;
}

/**
 * Cluster items into visual lines and render each line as text.
 *
 * Exported for tests: this is the part that decides whether a statement table
 * survives the trip out of the PDF.
 */
export function groupItemsIntoLines(
  items: readonly PositionedTextItem[],
): string[] {
  const meaningful = items.filter((item) => item.text.trim() !== "");
  if (meaningful.length === 0) return [];

  const medianFontSize = median(meaningful.map((item) => item.fontSize)) || 10;
  const tolerance = Math.max(1, medianFontSize * LINE_TOLERANCE_RATIO);

  // Top of the page first (PDF Y grows upwards), then left to right.
  const sorted = [...meaningful].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: PositionedTextItem[][] = [];
  let current: PositionedTextItem[] = [];
  let lineY = Number.NaN;

  for (const item of sorted) {
    if (current.length === 0 || Math.abs(lineY - item.y) <= tolerance) {
      if (current.length === 0) lineY = item.y;
      current.push(item);
    } else {
      lines.push(current);
      current = [item];
      lineY = item.y;
    }
  }
  if (current.length > 0) lines.push(current);

  return lines.map(renderLine).filter((line) => line !== "");
}

function renderLine(line: readonly PositionedTextItem[]): string {
  const ordered = [...line].sort((a, b) => a.x - b.x);
  let out = ordered[0].text;
  let cursorX = ordered[0].x + ordered[0].width;

  for (let i = 1; i < ordered.length; i++) {
    const item = ordered[i];
    const gap = item.x - cursorX;
    const scale = item.fontSize || 10;

    if (gap > scale * COLUMN_RATIO) out += COLUMN_GAP;
    else if (gap > scale * GLUE_RATIO) out += " ";

    out += item.text;
    cursorX = Math.max(cursorX, item.x + item.width);
  }

  return collapseWhitespace(out);
}

function collapseWhitespace(s: string): string {
  // Runs longer than a column gap add nothing; anything past three spaces is
  // just tokens the model has to pay for.
  return s.replace(/[ \t]{4,}/g, COLUMN_GAP).trimEnd();
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// ---------------------------------------------------------------------------
// Error translation and hygiene
// ---------------------------------------------------------------------------

/**
 * pdf.js raises a single `PasswordException` for both "needs a password" and
 * "wrong password"; only `code` tells them apart, and conflating them means the
 * UI cannot decide whether to show a password box or a "that was wrong" error.
 */
/**
 * pdf.js `PasswordResponses`, inlined so this stays synchronous now that the
 * module is loaded lazily. The values are fixed by pdf.js and asserted against
 * the real module in pdf.test.ts, so a future change cannot drift silently.
 */
const NEED_PASSWORD = 1;
const INCORRECT_PASSWORD = 2;

function translateOpenError(err: unknown): Error {
  const candidate = err as { name?: string; code?: number; message?: string } | null;

  if (candidate?.name === "PasswordException") {
    if (candidate.code === INCORRECT_PASSWORD) {
      return new WrongPasswordError(err);
    }
    if (candidate.code === NEED_PASSWORD) {
      return new PasswordRequiredError(err);
    }
    // Unknown code: needing a password is the safer assumption — it prompts
    // rather than accusing the user of typing it wrong.
    return new PasswordRequiredError(err);
  }

  return new PdfParseError(describe(err), err);
}

function describe(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** pdf.js reports the encryption filter only for encrypted documents. */
async function detectEncrypted(
  doc: PDFDocumentProxy,
  passwordWasSupplied: boolean,
): Promise<boolean> {
  try {
    const { info } = await doc.getMetadata();
    const filter = (info as Record<string, unknown> | null)?.EncryptFilterName;
    if (typeof filter === "string" && filter !== "") return true;
    if (filter === null) return false;
  } catch {
    // Metadata is optional; fall through to the weaker signal.
  }
  return passwordWasSupplied;
}

/** Best effort: overwrite our copy of the plaintext before dropping it. */
function scrub(data: Uint8Array): void {
  try {
    data.fill(0);
  } catch {
    // The buffer was transferred to the worker and detached. Nothing to zero.
  }
}
