import { describe, it, expect, beforeAll } from "vitest";

import { extractText, extractTextOrThrow, groupItemsIntoLines } from "./pdf";
import {
  PasswordRequiredError,
  WrongPasswordError,
  NoTextLayerError,
  PdfParseError,
} from "./errors";
import {
  buildPdfFromRows,
  buildTextlessPdf,
  encryptPdf,
  hasQpdf,
} from "./__fixtures__/makePdf";

/**
 * PDF reading is the first thing a user touches, and the three password states
 * are the difference between "type your password" and "your statement is
 * broken". Getting them confused is the most visible failure this module has.
 *
 * Encryption tests need `qpdf` and skip themselves without it.
 */

const STATEMENT_ROWS = [
  ["Date", "Description", "Debit", "Credit", "Balance"],
  ["05/03/2026", "Payment SHWAPNO", "1,234.56", "", "8,765.44"],
  ["07/03/2026", "Add Money from bank", "", "5,000.00", "13,765.44"],
  ["19/03/2026", "Cash Out agent 4471", "2,000.00", "", "11,765.44"],
];

let qpdfAvailable = false;
beforeAll(async () => {
  qpdfAvailable = await hasQpdf();
});

describe("pdf.js interop", () => {
  it("loads without a native canvas package present", async () => {
    // pdf.js references DOMMatrix/Path2D at module scope and polyfills them
    // from an optional native canvas build. Where that is absent — any
    // serverless host — the import throws and takes the whole route with it.
    // Shims stand in, since text extraction never rasterises anything.
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(typeof pdfjs.getDocument).toBe("function");
  });

  it("keeps the inlined password codes in step with pdf.js", async () => {
    // These are inlined so error translation can stay synchronous; if pdf.js
    // ever renumbers them, this fails instead of silently mislabelling a
    // wrong password as a missing one.
    const { PasswordResponses } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    expect(PasswordResponses.NEED_PASSWORD).toBe(1);
    expect(PasswordResponses.INCORRECT_PASSWORD).toBe(2);
  });
});

describe("plain PDFs", () => {
  it("extracts the text of an unencrypted statement", async () => {
    const bytes = buildPdfFromRows(STATEMENT_ROWS);
    const result = await extractText(bytes);

    expect(result.pageCount).toBeGreaterThanOrEqual(1);
    expect(result.wasEncrypted).toBe(false);
    expect(result.hasTextLayer).toBe(true);
    expect(result.text).toContain("SHWAPNO");
    expect(result.text).toContain("1,234.56");
  });

  it("keeps each statement row on its own line", async () => {
    // A table flattened into one long line is unextractable: "1,234.56" means
    // nothing once you cannot tell which row it belonged to.
    const bytes = buildPdfFromRows(STATEMENT_ROWS);
    const { text } = await extractText(bytes);

    const shwapnoLine = text
      .split("\n")
      .find((line) => line.includes("SHWAPNO"));

    expect(shwapnoLine).toBeDefined();
    expect(shwapnoLine).toContain("05/03/2026");
    expect(shwapnoLine).toContain("1,234.56");
    // The next row's figures must not have bled into this line.
    expect(shwapnoLine).not.toContain("5,000.00");
  });

  it("preserves row order", async () => {
    const bytes = buildPdfFromRows(STATEMENT_ROWS);
    const { text } = await extractText(bytes);

    expect(text.indexOf("SHWAPNO")).toBeLessThan(text.indexOf("Add Money"));
    expect(text.indexOf("Add Money")).toBeLessThan(text.indexOf("Cash Out"));
  });

  it("ignores a password supplied for an unencrypted file", async () => {
    const bytes = buildPdfFromRows(STATEMENT_ROWS);
    await expect(extractText(bytes, "unnecessary")).resolves.toMatchObject({
      hasTextLayer: true,
    });
  });
});

describe("encrypted PDFs", () => {
  it("reports that a password is needed when none is given", async () => {
    if (!qpdfAvailable) return;

    const encrypted = await encryptPdf(buildPdfFromRows(STATEMENT_ROWS), {
      userPassword: "01712345678",
    });

    await expect(extractText(encrypted)).rejects.toBeInstanceOf(
      PasswordRequiredError,
    );
  });

  it("distinguishes a wrong password from a missing one", async () => {
    // These need different screens: one asks for input, the other says the
    // input was wrong. Collapsing them strands the user in a retry loop.
    if (!qpdfAvailable) return;

    const encrypted = await encryptPdf(buildPdfFromRows(STATEMENT_ROWS), {
      userPassword: "01712345678",
    });

    await expect(extractText(encrypted, "01700000000")).rejects.toBeInstanceOf(
      WrongPasswordError,
    );
  });

  it("reads the statement when the password is right", async () => {
    if (!qpdfAvailable) return;

    const encrypted = await encryptPdf(buildPdfFromRows(STATEMENT_ROWS), {
      userPassword: "01712345678",
    });

    const result = await extractText(encrypted, "01712345678");
    expect(result.wasEncrypted).toBe(true);
    expect(result.text).toContain("SHWAPNO");
  });

  it("treats an empty password as no password at all", async () => {
    if (!qpdfAvailable) return;

    const encrypted = await encryptPdf(buildPdfFromRows(STATEMENT_ROWS), {
      userPassword: "01712345678",
    });

    await expect(extractText(encrypted, "")).rejects.toBeInstanceOf(
      PasswordRequiredError,
    );
  });

  it("handles 128-bit encryption as well as 256", async () => {
    // Older bank statements are still emitted with AES-128.
    if (!qpdfAvailable) return;

    const encrypted = await encryptPdf(buildPdfFromRows(STATEMENT_ROWS), {
      userPassword: "customer-id-99",
      bits: 128,
    });

    const result = await extractText(encrypted, "customer-id-99");
    expect(result.text).toContain("SHWAPNO");
  });
});

describe("documents we cannot read", () => {
  it("flags a scanned PDF with no text layer", async () => {
    const result = await extractText(buildTextlessPdf());
    expect(result.hasTextLayer).toBe(false);
  });

  it("extractTextOrThrow turns that into a typed error", async () => {
    // The caller needs to say "this looks scanned" rather than hand an empty
    // string to the model and get back an empty statement.
    await expect(extractTextOrThrow(buildTextlessPdf())).rejects.toBeInstanceOf(
      NoTextLayerError,
    );
  });

  it("rejects bytes that are not a PDF", async () => {
    const notAPdf = new TextEncoder().encode("this is a spreadsheet, sorry");
    await expect(extractText(notAPdf)).rejects.toBeInstanceOf(PdfParseError);
  });

  it("rejects an empty file", async () => {
    await expect(extractText(new Uint8Array(0))).rejects.toBeInstanceOf(
      PdfParseError,
    );
  });

  it("rejects a truncated PDF", async () => {
    const full = buildPdfFromRows(STATEMENT_ROWS);
    await expect(extractText(full.slice(0, 40))).rejects.toBeInstanceOf(
      PdfParseError,
    );
  });
});

describe("groupItemsIntoLines", () => {
  const item = (text: string, x: number, y: number) => ({
    text,
    x,
    y,
    width: text.length * 5,
    fontSize: 10,
  });

  it("groups items sharing a baseline into one line", () => {
    const lines = groupItemsIntoLines([
      item("Date", 50, 700),
      item("Description", 120, 700),
      item("Amount", 400, 700),
    ]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Date");
    expect(lines[0]).toContain("Amount");
  });

  it("orders items left to right regardless of draw order", () => {
    // PDF content streams do not have to emit text in reading order.
    const lines = groupItemsIntoLines([
      item("Amount", 400, 700),
      item("Date", 50, 700),
    ]);

    expect(lines[0].indexOf("Date")).toBeLessThan(lines[0].indexOf("Amount"));
  });

  it("separates rows on different baselines, top to bottom", () => {
    const lines = groupItemsIntoLines([
      item("second row", 50, 680),
      item("first row", 50, 700),
    ]);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("first row");
    expect(lines[1]).toContain("second row");
  });

  it("returns nothing for no items", () => {
    expect(groupItemsIntoLines([])).toEqual([]);
  });
});
