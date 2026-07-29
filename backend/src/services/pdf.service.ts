/**
 * Challan PDF renderer.
 *
 * Implemented with PDFKit rather than headless Chrome. Puppeteer would give
 * nicer typography, but it adds a ~300MB Chromium download to every deploy and
 * needs 500MB+ of RAM per render — which does not fit Render's free tier and is
 * disproportionate for a one-page delivery note. PDFKit streams directly to the
 * HTTP response with a flat memory profile.
 *
 * The document is laid out on a manual coordinate grid because PDFKit has no
 * layout engine. Constants are named so the layout can be adjusted without
 * hunting for magic numbers.
 */
import PDFDocument from 'pdfkit';
import type { Response } from 'express';

import type { ChallanWithRelations } from '../repositories/challan.repository';
import { formatCurrency, toNumber } from '../utils/money';

/** Page geometry (points; 72pt = 1 inch). */
const PAGE = {
  margin: 42,
  width: 595.28, // A4 portrait
  height: 841.89,
} as const;

const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;

/** Column x-offsets and widths for the line-item table. */
const COLUMNS = {
  sr: { x: PAGE.margin, width: 28 },
  sku: { x: PAGE.margin + 28, width: 78 },
  description: { x: PAGE.margin + 106, width: 158 },
  qty: { x: PAGE.margin + 264, width: 46 },
  rate: { x: PAGE.margin + 310, width: 62 },
  tax: { x: PAGE.margin + 372, width: 46 },
  amount: { x: PAGE.margin + 418, width: 93 },
} as const;

const COLOURS = {
  ink: '#0f172a',
  muted: '#64748b',
  line: '#cbd5e1',
  headerBg: '#f1f5f9',
  accent: '#1d4ed8',
  danger: '#dc2626',
} as const;

const formatDate = (value: Date | null): string =>
  value
    ? value.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';

class PdfService {
  /**
   * Streams a delivery challan straight to the response.
   *
   * Streaming rather than buffering matters: a buffered PDF holds the whole
   * document in memory and delays the first byte until rendering completes.
   */
  streamChallan(challan: ChallanWithRelations, res: Response): void {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE.margin,
      info: {
        Title: `Delivery Challan ${challan.challanNumber}`,
        Author: 'Mini ERP + CRM Operations Portal',
        Subject: `Challan for ${challan.customer.name}`,
      },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="challan-${challan.challanNumber}.pdf"`,
    );

    doc.pipe(res);

    this.renderHeader(doc, challan);
    this.renderParties(doc, challan);
    const tableEndY = this.renderItems(doc, challan);
    this.renderTotals(doc, challan, tableEndY);
    this.renderFooter(doc, challan);

    doc.end();
  }

  private renderHeader(doc: PDFKit.PDFDocument, challan: ChallanWithRelations): void {
    doc
      .fillColor(COLOURS.accent)
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('DELIVERY CHALLAN', PAGE.margin, PAGE.margin);

    doc
      .fillColor(COLOURS.muted)
      .fontSize(9)
      .font('Helvetica')
      .text('Mini ERP + CRM Operations Portal', PAGE.margin, PAGE.margin + 26);

    // Status badge — cancelled documents must be unmistakable at a glance.
    const badge =
      challan.status === 'CANCELLED'
        ? { label: 'CANCELLED', colour: COLOURS.danger }
        : challan.status === 'CONFIRMED'
          ? { label: 'CONFIRMED', colour: COLOURS.accent }
          : { label: 'DRAFT', colour: COLOURS.muted };

    doc
      .fillColor(badge.colour)
      .fontSize(11)
      .font('Helvetica-Bold')
      .text(badge.label, PAGE.margin, PAGE.margin, { width: CONTENT_WIDTH, align: 'right' });

    doc
      .fillColor(COLOURS.ink)
      .fontSize(10)
      .font('Helvetica')
      .text(`Challan No: ${challan.challanNumber}`, PAGE.margin, PAGE.margin + 18, {
        width: CONTENT_WIDTH,
        align: 'right',
      })
      .text(`Date: ${formatDate(challan.challanDate)}`, PAGE.margin, PAGE.margin + 32, {
        width: CONTENT_WIDTH,
        align: 'right',
      });

    doc
      .moveTo(PAGE.margin, PAGE.margin + 52)
      .lineTo(PAGE.width - PAGE.margin, PAGE.margin + 52)
      .strokeColor(COLOURS.line)
      .lineWidth(1)
      .stroke();
  }

  private renderParties(doc: PDFKit.PDFDocument, challan: ChallanWithRelations): void {
    const top = PAGE.margin + 66;
    const columnWidth = CONTENT_WIDTH / 2 - 10;

    doc.fontSize(9).font('Helvetica-Bold').fillColor(COLOURS.muted).text('BILL TO', PAGE.margin, top);

    doc
      .fontSize(11)
      .font('Helvetica-Bold')
      .fillColor(COLOURS.ink)
      .text(challan.customer.businessName ?? challan.customer.name, PAGE.margin, top + 13, {
        width: columnWidth,
      });

    const address =
      challan.shippingAddress ??
      [
        challan.customer.addressLine1,
        challan.customer.addressLine2,
        [challan.customer.city, challan.customer.state, challan.customer.postalCode]
          .filter(Boolean)
          .join(' '),
      ]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join('\n');

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(COLOURS.muted)
      .text(address || '—', PAGE.margin, doc.y + 2, { width: columnWidth })
      .text(`Mobile: ${challan.customer.mobile}`, { width: columnWidth })
      .text(`GSTIN: ${challan.customer.gstNumber ?? '—'}`, { width: columnWidth })
      .text(`Customer Code: ${challan.customer.code}`, { width: columnWidth });

    // Dispatch details, right column.
    const rightX = PAGE.margin + CONTENT_WIDTH / 2 + 10;
    doc
      .fontSize(9)
      .font('Helvetica-Bold')
      .fillColor(COLOURS.muted)
      .text('DISPATCH DETAILS', rightX, top);

    doc
      .fontSize(9)
      .font('Helvetica')
      .fillColor(COLOURS.ink)
      .text(`Dispatch Date : ${formatDate(challan.dispatchDate)}`, rightX, top + 15, {
        width: columnWidth,
      })
      .text(`Transporter   : ${challan.transporterName ?? '—'}`, { width: columnWidth })
      .text(`Vehicle No.   : ${challan.vehicleNumber ?? '—'}`, { width: columnWidth });
  }

  /** Renders the line-item table and returns the y-coordinate where it ends. */
  private renderItems(doc: PDFKit.PDFDocument, challan: ChallanWithRelations): number {
    let y = 210;
    const ROW_HEIGHT = 20;

    // Header band
    doc.rect(PAGE.margin, y, CONTENT_WIDTH, 22).fill(COLOURS.headerBg);
    doc.fillColor(COLOURS.ink).fontSize(8.5).font('Helvetica-Bold');

    doc.text('#', COLUMNS.sr.x + 4, y + 7, { width: COLUMNS.sr.width });
    doc.text('SKU', COLUMNS.sku.x, y + 7, { width: COLUMNS.sku.width });
    doc.text('DESCRIPTION', COLUMNS.description.x, y + 7, { width: COLUMNS.description.width });
    doc.text('QTY', COLUMNS.qty.x, y + 7, { width: COLUMNS.qty.width, align: 'right' });
    doc.text('RATE', COLUMNS.rate.x, y + 7, { width: COLUMNS.rate.width, align: 'right' });
    doc.text('TAX%', COLUMNS.tax.x, y + 7, { width: COLUMNS.tax.width, align: 'right' });
    doc.text('AMOUNT', COLUMNS.amount.x, y + 7, { width: COLUMNS.amount.width, align: 'right' });

    y += 22;
    doc.font('Helvetica').fontSize(8.5);

    challan.items.forEach((item, index) => {
      // Manual page-break handling — PDFKit will not paginate a hand-drawn table.
      if (y > PAGE.height - 190) {
        doc.addPage();
        y = PAGE.margin;
      }

      doc.fillColor(COLOURS.ink);
      doc.text(String(index + 1), COLUMNS.sr.x + 4, y + 5, { width: COLUMNS.sr.width });
      doc.text(item.productSku, COLUMNS.sku.x, y + 5, {
        width: COLUMNS.sku.width - 4,
        ellipsis: true,
      });
      doc.text(item.productName, COLUMNS.description.x, y + 5, {
        width: COLUMNS.description.width - 4,
        ellipsis: true,
      });
      doc.text(`${item.quantity} ${item.unit}`, COLUMNS.qty.x, y + 5, {
        width: COLUMNS.qty.width,
        align: 'right',
      });
      doc.text(toNumber(item.unitPrice).toFixed(2), COLUMNS.rate.x, y + 5, {
        width: COLUMNS.rate.width,
        align: 'right',
      });
      doc.text(`${toNumber(item.taxRate).toFixed(1)}`, COLUMNS.tax.x, y + 5, {
        width: COLUMNS.tax.width,
        align: 'right',
      });
      doc.text(toNumber(item.lineTotal).toFixed(2), COLUMNS.amount.x, y + 5, {
        width: COLUMNS.amount.width,
        align: 'right',
      });

      y += ROW_HEIGHT;
      doc
        .moveTo(PAGE.margin, y)
        .lineTo(PAGE.width - PAGE.margin, y)
        .strokeColor(COLOURS.line)
        .lineWidth(0.5)
        .stroke();
    });

    return y;
  }

  private renderTotals(
    doc: PDFKit.PDFDocument,
    challan: ChallanWithRelations,
    tableEndY: number,
  ): void {
    const labelX = PAGE.margin + CONTENT_WIDTH - 220;
    const valueX = PAGE.margin + CONTENT_WIDTH - 100;
    let y = tableEndY + 14;

    const rows: Array<[string, string, boolean]> = [
      ['Subtotal', formatCurrency(challan.subtotal), false],
      ['Discount', `- ${formatCurrency(challan.discountAmount)}`, false],
      ['Tax (GST)', formatCurrency(challan.taxAmount), false],
      ['Grand Total', formatCurrency(challan.totalAmount), true],
    ];

    for (const [label, value, emphasised] of rows) {
      if (emphasised) {
        doc
          .moveTo(labelX, y - 4)
          .lineTo(PAGE.width - PAGE.margin, y - 4)
          .strokeColor(COLOURS.line)
          .lineWidth(1)
          .stroke();
      }

      doc
        .fontSize(emphasised ? 11 : 9)
        .font(emphasised ? 'Helvetica-Bold' : 'Helvetica')
        .fillColor(emphasised ? COLOURS.ink : COLOURS.muted)
        .text(label, labelX, y, { width: 110 })
        .fillColor(COLOURS.ink)
        .text(value, valueX, y, { width: 100, align: 'right' });

      y += emphasised ? 20 : 15;
    }
  }

  private renderFooter(doc: PDFKit.PDFDocument, challan: ChallanWithRelations): void {
    const y = PAGE.height - 118;

    if (challan.notes) {
      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(COLOURS.muted)
        .text('NOTES', PAGE.margin, y - 34)
        .font('Helvetica')
        .text(challan.notes, PAGE.margin, y - 22, { width: CONTENT_WIDTH - 160 });
    }

    doc
      .moveTo(PAGE.margin, y)
      .lineTo(PAGE.width - PAGE.margin, y)
      .strokeColor(COLOURS.line)
      .lineWidth(0.5)
      .stroke();

    doc
      .fontSize(8)
      .font('Helvetica')
      .fillColor(COLOURS.muted)
      .text(
        'Goods once dispatched are subject to the agreed terms of sale. This is a computer-generated document.',
        PAGE.margin,
        y + 8,
        { width: CONTENT_WIDTH - 160 },
      );

    doc
      .fontSize(8)
      .fillColor(COLOURS.ink)
      .text('Authorised Signatory', PAGE.width - PAGE.margin - 150, y + 40, {
        width: 150,
        align: 'right',
      });

    doc
      .fontSize(7)
      .fillColor(COLOURS.muted)
      .text(
        `Generated ${new Date().toLocaleString('en-IN')} · ${challan.challanNumber}`,
        PAGE.margin,
        PAGE.height - PAGE.margin - 8,
        { width: CONTENT_WIDTH, align: 'center' },
      );
  }
}

export const pdfService = new PdfService();
export { PdfService };
