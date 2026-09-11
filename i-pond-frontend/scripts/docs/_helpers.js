const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TabStopType, TabStopPosition,
  TableOfContents, HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak,
} = require("docx");

const PAGE_WIDTH = 12240;
const PAGE_HEIGHT = 15840;
const MARGIN = 1440;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 4, color: "BFBFBF" };
const ALL_BORDERS = {
  top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER,
};

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, ...(opts.spacing || {}) },
    alignment: opts.alignment,
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: opts.size, color: opts.color })],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: true,
    spacing: { before: 240, after: 200 },
    children: [new TextRun({ text })],
  });
}

function h1First(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 200 },
    children: [new TextRun({ text })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 140 },
    children: [new TextRun({ text })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 120 },
    children: [new TextRun({ text })],
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: [new TextRun({ text })],
  });
}

function bulletRuns(runs, level = 0) {
  return new Paragraph({
    numbering: { reference: "bullets", level },
    spacing: { after: 60 },
    children: runs,
  });
}

function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: "numbers", level },
    spacing: { after: 60 },
    children: [new TextRun({ text })],
  });
}

function code(text) {
  const lines = text.split("\n");
  return lines.map((line) => new Paragraph({
    spacing: { after: 0 },
    shading: { type: ShadingType.CLEAR, fill: "F2F2F2" },
    children: [new TextRun({ text: line || " ", font: "Consolas", size: 18 })],
  }));
}

function screenshot(description) {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top: { style: BorderStyle.DASHED, size: 8, color: "808080" },
              bottom: { style: BorderStyle.DASHED, size: 8, color: "808080" },
              left: { style: BorderStyle.DASHED, size: 8, color: "808080" },
              right: { style: BorderStyle.DASHED, size: 8, color: "808080" },
            },
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill: "F5F5F5" },
            margins: { top: 200, bottom: 200, left: 200, right: 200 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: `[SCREENSHOT: ${description}]`, italics: true, color: "595959", size: 22 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function table(headers, rows, opts = {}) {
  const colCount = headers.length;
  const totalWidth = opts.totalWidth || CONTENT_WIDTH;
  let widths = opts.widths;
  if (!widths) {
    const each = Math.floor(totalWidth / colCount);
    widths = new Array(colCount).fill(each);
    widths[widths.length - 1] = totalWidth - each * (colCount - 1);
  }

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: ALL_BORDERS,
      width: { size: widths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: "1F4E79" },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(h), bold: true, color: "FFFFFF", size: 20 })] })],
    })),
  });

  const bodyRows = rows.map((row) => new TableRow({
    children: row.map((cell, i) => new TableCell({
      borders: ALL_BORDERS,
      width: { size: widths[i], type: WidthType.DXA },
      margins: { top: 70, bottom: 70, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(cell ?? ""), size: 20 })] })],
    })),
  }));

  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths: widths,
    rows: [headerRow, ...bodyRows],
  });
}

function titlePage(title, subtitle) {
  return [
    new Paragraph({ spacing: { before: 2400, after: 240 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "SOLETRONIX iPOND", bold: true, size: 28, color: "1F4E79" })] }),
    new Paragraph({ spacing: { after: 480 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, size: 56, color: "000000" })] }),
    new Paragraph({ spacing: { after: 240 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: subtitle, italics: true, size: 28, color: "595959" })] }),
    new Paragraph({ spacing: { before: 4800 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "IoT Aquaculture Monitoring System", size: 22, color: "808080" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Version 1.0", size: 22, color: "808080" })] }),
    new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }),
  ];
}

function tocSection(title) {
  return [
    new Paragraph({ spacing: { before: 240, after: 200 }, alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: title, bold: true, size: 40 })] }),
    new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-3" }),
    new Paragraph({ pageBreakBefore: true, children: [new TextRun("")] }),
  ];
}

function makeDoc(children, footerTitle) {
  return new Document({
    creator: "Soletronix iPond",
    title: footerTitle,
    styles: {
      default: { document: { run: { font: "Arial", size: 22 } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 36, bold: true, font: "Arial", color: "1F4E79" },
          paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 28, bold: true, font: "Arial", color: "1F4E79" },
          paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 24, bold: true, font: "Arial", color: "2E75B6" },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
      ],
    },
    numbering: {
      config: [
        { reference: "bullets",
          levels: [
            { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
            { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
          ] },
        { reference: "numbers",
          levels: [
            { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
          ] },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_WIDTH, height: PAGE_HEIGHT },
          margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1F4E79", space: 1 } },
          children: [new TextRun({ text: footerTitle, size: 18, color: "595959" })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: "Soletronix iPond", size: 18, color: "808080" }),
            new TextRun({ text: "\tPage ", size: 18, color: "808080" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 18, color: "808080" }),
            new TextRun({ text: " of ", size: 18, color: "808080" }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 18, color: "808080" }),
          ],
        })] }),
      },
      children,
    }],
  });
}

module.exports = {
  PAGE_WIDTH, PAGE_HEIGHT, MARGIN, CONTENT_WIDTH,
  p, h1, h1First, h2, h3, bullet, bulletRuns, numbered, code,
  screenshot, table, titlePage, tocSection, makeDoc,
  TextRun, Paragraph, PageBreak,
};
