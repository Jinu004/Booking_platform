const PDFDocument = require('pdfkit');
const pool = require('../../config/database');
const { successResponse, errorResponse } = require('../../utils/response');
const logger = require('../../utils/logger');
const { sendDocument } = require('../channel/whatsapp/whatsapp.adapter');

function isPro(req) {
  return req.tenant?.plan === 'pro';
}

async function getPrescriptionData(tenantId, customerId, noteId) {
  const noteRes = await pool.query(`
    SELECT vn.*,
      d.name as doctor_name, d.specialization, d.qualification,
      c.name as patient_name, c.phone as patient_phone,
      pp.age, pp.blood_group, pp.gender,
      t.name as clinic_name
    FROM visit_notes vn
    LEFT JOIN clinic_doctors d ON d.id = vn.doctor_id
    LEFT JOIN customers c ON c.id = vn.customer_id
    LEFT JOIN patient_profiles pp ON pp.customer_id = vn.customer_id AND pp.tenant_id = vn.tenant_id
    JOIN tenants t ON t.id = vn.tenant_id
    WHERE vn.id = $1 AND vn.tenant_id = $2 AND vn.customer_id = $3
  `, [noteId, tenantId, customerId]);

  if (!noteRes.rows.length) return null;

  const addressRes = await pool.query(
    `SELECT value FROM tenant_configs WHERE tenant_id = $1 AND key = 'clinic_address'`,
    [tenantId]
  );

  const data = noteRes.rows[0];
  data.clinic_address = addressRes.rows[0]?.value || '';
  return data;
}

function generatePDF(data) {
  return new Promise((resolve, reject) => {
    // bottom: 5 lets footer content reach y≈836 without triggering auto-pagination
    const doc = new PDFDocument({
      margins: { top: 50, bottom: 5, left: 50, right: 50 },
      size: 'A4',
      bufferPages: true
    });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // ── Palette ──────────────────────────────────────────────────────────────
    const teal       = '#0d9488';
    const darkGray   = '#1f2937';
    const medGray    = '#6b7280';
    const lightGray  = '#f3f4f6';
    const lightGreen = '#f0fdf4';

    const MARGIN    = 50;
    const CONTENT_W = 495; // 50 → 545
    // Content sections must stop before the footer zone
    const CONTENT_LIMIT = 680;
    const FOOTER_Y      = 748;

    // ── Key fix: PDFKit adds a new page whenever doc.text(str, x, y) is called
    // with y < doc.y.  pin(y) resets doc.y = y first so the check never fires.
    function pin(y) { if (y < doc.y) doc.y = y; }

    // ── Prescription ID ───────────────────────────────────────────────────────
    const visitDt = new Date(data.visit_date);
    const dateStr = `${visitDt.getFullYear()}${String(visitDt.getMonth() + 1).padStart(2, '0')}${String(visitDt.getDate()).padStart(2, '0')}`;
    const rxId         = `RX-${dateStr}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    const visitDateStr = visitDt.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

    // ── Doctor name (avoid double Dr. prefix) ──────────────────────────────────
    const doctorName = data.doctor_name
      ? (data.doctor_name.startsWith('Dr.') || data.doctor_name.startsWith('dr.')
        ? data.doctor_name
        : `Dr. ${data.doctor_name}`)
      : '';

    // ── HEADER ────────────────────────────────────────────────────────────────
    const headerStartY = 50;
    const leftColX  = MARGIN;
    const leftColW  = 275;
    const rightColX = 360;
    const rightColW = 185;

    // Left side – clinic info (renders first; advances doc.y)
    doc.fontSize(20).font('Helvetica-Bold').fillColor(teal)
      .text(data.clinic_name || 'Clinic', leftColX, headerStartY, { width: leftColW });
    doc.fontSize(8).font('Helvetica').fillColor(medGray)
      .text('MULTI-SPECIALTY CLINIC & DIAGNOSTICS', leftColX, doc.y, { width: leftColW, characterSpacing: 0.5 });
    if (data.clinic_address) {
      doc.fontSize(9).fillColor(medGray)
        .text(data.clinic_address, leftColX, doc.y, { width: leftColW });
    }
    const leftEndY = doc.y;

    // Right side – pin back to headerStartY so we don't trigger a page break
    let ry = headerStartY;
    pin(ry);
    doc.fontSize(13).font('Helvetica-Bold').fillColor(darkGray)
      .text(`${doctorName || 'Doctor'}`, rightColX, ry, { width: rightColW });
    ry = doc.y;
    if (data.specialization) {
      pin(ry);
      doc.fontSize(10).font('Helvetica').fillColor(teal)
        .text(data.specialization, rightColX, ry, { width: rightColW });
      ry = doc.y;
    }
    if (data.qualification) {
      pin(ry);
      doc.fontSize(9).fillColor(medGray)
        .text(data.qualification, rightColX, ry, { width: rightColW });
      ry = doc.y;
    }
    if (data.mci_number) {
      pin(ry);
      doc.fontSize(8).fillColor(medGray)
        .text(`MCI Reg: ${data.mci_number}`, rightColX, ry, { width: rightColW });
      ry = doc.y;
    }

    // Teal divider after the taller of the two columns
    const dividerY = Math.max(leftEndY, ry) + 10;
    doc.moveTo(MARGIN, dividerY).lineTo(545, dividerY)
      .lineWidth(1.5).strokeColor(teal).stroke();

    // ── PATIENT BOX ───────────────────────────────────────────────────────────
    let y = dividerY + 14;
    const boxH = 78;

    doc.rect(MARGIN, y, CONTENT_W, boxH).fill(lightGray);

    // "Rx" symbol
    pin(y + 10);
    doc.fontSize(28).font('Helvetica-Bold').fillColor(teal)
      .text('Rx', MARGIN + 8, y + 10, { width: 40, lineBreak: false });

    // Grid columns: 4 across
    const gx   = MARGIN + 56;
    const colW = 108;
    const cols = [gx, gx + colW, gx + colW * 2, gx + colW * 3];

    const r1lY = y + 8;
    const r1vY = r1lY + 12;

    // Row 1 labels – pin before each cell to avoid backward-y page breaks
    doc.fontSize(7).font('Helvetica').fillColor(medGray);
    pin(r1lY); doc.text('PATIENT NAME', cols[0], r1lY, { width: colW,     lineBreak: false });
    pin(r1lY); doc.text('AGE',          cols[1], r1lY, { width: colW,     lineBreak: false });
    pin(r1lY); doc.text('GENDER',       cols[2], r1lY, { width: colW,     lineBreak: false });
    pin(r1lY); doc.text('BLOOD GROUP',  cols[3], r1lY, { width: colW,     lineBreak: false });

    // Row 1 values
    doc.fontSize(10).font('Helvetica-Bold').fillColor(darkGray);
    pin(r1vY); doc.text(data.patient_name || '—',           cols[0], r1vY, { width: colW, lineBreak: false });
    pin(r1vY); doc.text(data.age ? `${data.age} yrs` : '—', cols[1], r1vY, { width: colW, lineBreak: false });
    pin(r1vY); doc.text(data.gender || '—',                 cols[2], r1vY, { width: colW, lineBreak: false });
    pin(r1vY); doc.text(data.blood_group || '—',            cols[3], r1vY, { width: colW, lineBreak: false });

    // Row 2 – date + rx id
    const r2lY = y + 44;
    const r2vY = r2lY + 12;

    doc.fontSize(7).font('Helvetica').fillColor(medGray);
    pin(r2lY); doc.text('DATE OF VISIT',   cols[0], r2lY, { width: colW * 2, lineBreak: false });
    pin(r2lY); doc.text('PRESCRIPTION ID', cols[2], r2lY, { width: colW * 2, lineBreak: false });

    doc.fontSize(10).font('Helvetica-Bold').fillColor(darkGray);
    pin(r2vY); doc.text(visitDateStr, cols[0], r2vY, { width: colW * 2, lineBreak: false });
    pin(r2vY); doc.text(rxId,         cols[2], r2vY, { width: colW * 2, lineBreak: false });

    y = y + boxH + 18;

    // ── Section helper ────────────────────────────────────────────────────────
    function sectionHeader(title, curY) {
      pin(curY);
      doc.fontSize(9).font('Helvetica-Bold').fillColor(teal)
        .text(title, MARGIN, curY, { width: CONTENT_W, characterSpacing: 0.8 });
      const ly = doc.y + 2;
      doc.moveTo(MARGIN, ly).lineTo(545, ly)
        .lineWidth(0.5).strokeColor('#e5e7eb').stroke();
      return ly + 7;
    }

    // ── DIAGNOSIS ─────────────────────────────────────────────────────────────
    if (data.diagnosis && y < CONTENT_LIMIT) {
      y = sectionHeader('DIAGNOSIS', y);
      pin(y);
      doc.fontSize(10).font('Helvetica').fillColor(darkGray)
        .text(data.diagnosis, MARGIN, y, { width: CONTENT_W });
      y = doc.y + 14;
    }

    // ── PRESCRIPTION / MEDICINES ──────────────────────────────────────────────
    if (data.prescription && y < CONTENT_LIMIT) {
      y = sectionHeader('PRESCRIPTION / MEDICINES', y);
      const medicines = data.prescription.split('\n').filter(l => l.trim());
      for (const [i, line] of medicines.entries()) {
        if (y >= CONTENT_LIMIT) break;
        const num = String(i + 1).padStart(2, '0');
        pin(y);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(teal)
          .text(num, MARGIN, y, { width: 24, lineBreak: false });
        pin(y);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(darkGray)
          .text(line.trim(), MARGIN + 28, y, { width: CONTENT_W - 28 });
        y = doc.y + 4;
      }
      y += 10;
    }

    // ── FOLLOW-UP ─────────────────────────────────────────────────────────────
    if (data.follow_up_date && y < CONTENT_LIMIT) {
      y = sectionHeader('FOLLOW-UP', y);
      const followUp = new Date(data.follow_up_date).toLocaleDateString('en-IN', {
        day: 'numeric', month: 'long', year: 'numeric'
      });
      const fbH = 48;
      doc.rect(MARGIN, y, 220, fbH).fill(lightGreen);
      pin(y + 9);
      doc.fontSize(7).font('Helvetica').fillColor(medGray)
        .text('NEXT VISIT', MARGIN + 12, y + 9, { width: 196, lineBreak: false });
      pin(y + 22);
      doc.fontSize(13).font('Helvetica-Bold').fillColor(teal)
        .text(followUp, MARGIN + 12, y + 22, { width: 196, lineBreak: false });
      y = y + fbH + 14;
    }

    // ── DOCTOR'S NOTES ────────────────────────────────────────────────────────
    if (data.notes && y < CONTENT_LIMIT) {
      y = sectionHeader("DOCTOR'S NOTES", y);
      const lineCount = Math.ceil(data.notes.length / 85);
      const nbH = Math.max(44, lineCount * 15 + 20);
      // Cap notes box so it doesn't push into footer zone
      const cappedH = Math.min(nbH, CONTENT_LIMIT - y - 4);
      doc.rect(MARGIN, y, CONTENT_W, cappedH).fill(lightGray);
      pin(y + 10);
      doc.fontSize(10).font('Helvetica').fillColor(darkGray)
        .text(data.notes, MARGIN + 12, y + 10, { width: CONTENT_W - 24, height: cappedH - 16, ellipsis: true });
      y = doc.y + 12;
    }

    // ── FOOTER (pinned to FOOTER_Y regardless of content above) ──────────────
    const sigBlockY = FOOTER_Y + 10;

    // Teal top-of-footer line
    doc.moveTo(MARGIN, FOOTER_Y).lineTo(545, FOOTER_Y)
      .lineWidth(1.5).strokeColor(teal).stroke();

    // Left: signature area
    doc.moveTo(MARGIN, sigBlockY + 30).lineTo(MARGIN + 155, sigBlockY + 30)
      .lineWidth(0.5).strokeColor(darkGray).stroke();
    pin(sigBlockY + 33);
    doc.fontSize(7).font('Helvetica').fillColor(medGray)
      .text("DOCTOR'S SIGNATURE", MARGIN, sigBlockY + 33, { width: 155, lineBreak: false });
    pin(sigBlockY + 43);
    doc.fontSize(9).font('Helvetica-Bold').fillColor(darkGray)
      .text(doctorName, MARGIN, sigBlockY + 43, { width: 155, lineBreak: false });

    // Center: disclaimer
    pin(sigBlockY + 14);
    doc.fontSize(7).font('Helvetica').fillColor(medGray)
      .text(
        'This is a computer-generated prescription.\nValid for 30 days from date of issue.',
        192, sigBlockY + 14,
        { width: 190, align: 'center' }
      );

    // Right: stamp box (dashed rect)
    const stampX = 418;
    const stampW = 120;
    const stampH = 52;
    doc.rect(stampX, sigBlockY + 2, stampW, stampH)
      .dash(3, { space: 3 }).strokeColor(medGray).lineWidth(0.8).stroke();
    doc.undash();
    pin(sigBlockY + stampH + 6);
    doc.fontSize(7).font('Helvetica').fillColor(medGray)
      .text("DOCTOR'S STAMP & SEAL", stampX, sigBlockY + stampH + 6, { width: stampW, align: 'center', lineBreak: false });

    // "Powered by ReceptionAI" – bottom-centre, mixed colour
    const pwY = 820;
    doc.fontSize(8).font('Helvetica');
    const pwLabelW = doc.widthOfString('Powered by ');
    doc.font('Helvetica-Bold');
    const pwBrandW = doc.widthOfString('ReceptionAI');
    const pwStartX = MARGIN + (CONTENT_W - pwLabelW - pwBrandW) / 2;

    pin(pwY);
    doc.fontSize(8).font('Helvetica').fillColor(medGray)
      .text('Powered by ', pwStartX, pwY, { continued: true, lineBreak: false });
    doc.font('Helvetica-Bold').fillColor(teal)
      .text('ReceptionAI', { lineBreak: false });

    doc.end();
  });
}

async function downloadPrescription(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'Prescription PDF is a Pro plan feature', 403);
  try {
    const { customerId, noteId } = req.params;
    const data = await getPrescriptionData(req.tenantId, customerId, noteId);
    if (!data) return errorResponse(res, 'Visit note not found', 404);

    const pdfBuffer = await generatePDF(data);
    const filename = `prescription-${data.patient_name?.replace(/\s+/g, '-')}-${noteId.slice(0, 8)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch (err) {
    logger.error('Prescription download failed:', err.message);
    next(err);
  }
}

async function sendPrescriptionToWhatsApp(req, res, next) {
  if (!isPro(req)) return errorResponse(res, 'Prescription PDF is a Pro plan feature', 403);
  try {
    const { customerId, noteId } = req.params;
    const data = await getPrescriptionData(req.tenantId, customerId, noteId);
    if (!data) return errorResponse(res, 'Visit note not found', 404);
    if (!data.patient_phone) return errorResponse(res, 'Patient has no phone number', 400);

    const pdfBuffer = await generatePDF(data);
    const filename = `prescription-${data.patient_name?.replace(/\s+/g, '-')}-${noteId.slice(0, 8)}.pdf`;
    const caption = `Prescription from ${data.clinic_name}\nPatient: ${data.patient_name}\nDate: ${new Date(data.visit_date).toLocaleDateString('en-IN')}`;

    await sendDocument(data.patient_phone, pdfBuffer, filename, caption);
    return successResponse(res, { message: 'Prescription sent to patient WhatsApp' });
  } catch (err) {
    logger.error('Prescription WhatsApp send failed:', err.message);
    next(err);
  }
}

module.exports = { downloadPrescription, sendPrescriptionToWhatsApp };
