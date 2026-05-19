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
    const doc = new PDFDocument({
      margin: 40,
      size: 'A4',
      margins: { top: 40, bottom: 5, left: 40, right: 40 }
    });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const teal = '#0d9488';
    const darkGray = '#1f2937';
    const medGray = '#6b7280';
    const lightGray = '#f3f4f6';
    const pageWidth = 515;

    // Helper to position without triggering new page
    const pin = (y) => { doc.y = y; return y; };

    // ── HEADER ──────────────────────────────────────────
    // Left: Clinic
    doc.fontSize(22).font('Helvetica-Bold').fillColor(teal)
      .text(data.clinic_name || 'Clinic', 40, 40, { width: 300, lineBreak: false });
    pin(40);
    // Right: Doctor
    const doctorName = data.doctor_name ? `Dr. ${data.doctor_name}` : '';
    doc.fontSize(14).font('Helvetica-Bold').fillColor(darkGray)
      .text(doctorName, 340, 40, { width: 215, align: 'right', lineBreak: false });

    pin(65);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(medGray)
      .text('MULTI-SPECIALTY CLINIC & DIAGNOSTICS', 40, 65, { width: 300, lineBreak: false, characterSpacing: 0.3 });
    pin(65);
    if (data.specialization) {
      doc.fontSize(9).font('Helvetica-Bold').fillColor(teal)
        .text(data.specialization, 340, 65, { width: 215, align: 'right', lineBreak: false });
    }

    pin(78);
    if (data.clinic_address) {
      doc.fontSize(8).font('Helvetica').fillColor(darkGray)
        .text(data.clinic_address, 40, 78, { width: 300, lineBreak: false });
    }
    pin(78);
    if (data.qualification) {
      doc.fontSize(8).font('Helvetica').fillColor(medGray)
        .text(data.qualification, 340, 78, { width: 215, align: 'right', lineBreak: false });
    }

    // Teal divider
    doc.moveTo(40, 100).lineTo(555, 100).lineWidth(1.5).strokeColor(teal).stroke();

    // ── PATIENT BOX ─────────────────────────────────────
    doc.rect(40, 110, pageWidth, 72).fillColor(lightGray).fill();
    pin(110);
    doc.fontSize(34).font('Helvetica-Bold').fillColor(teal)
      .text('Rx', 45, 120, { width: 50, lineBreak: false });

    // Row 1 labels
    const cols = [105, 230, 330, 435];
    const labels1 = ['PATIENT NAME', 'AGE', 'GENDER', 'BLOOD GROUP'];
    labels1.forEach((label, i) => {
      pin(113);
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(medGray)
        .text(label, cols[i], 113, { width: 110, lineBreak: false, characterSpacing: 0.3 });
    });

    // Row 1 values
    const vals1 = [
      data.patient_name || 'Unknown',
      data.age ? `${data.age} yrs` : '—',
      data.gender || '—',
      data.blood_group || '—'
    ];
    vals1.forEach((val, i) => {
      pin(124);
      doc.fontSize(10).font('Helvetica-Bold').fillColor(darkGray)
        .text(val, cols[i], 124, { width: 110, lineBreak: false });
    });

    // Row 2 labels
    pin(146);
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(medGray)
      .text('DATE OF VISIT', cols[0], 146, { width: 120, lineBreak: false, characterSpacing: 0.3 });
    pin(146);
    doc.fontSize(6.5).font('Helvetica-Bold').fillColor(medGray)
      .text('PRESCRIPTION ID', cols[1], 146, { width: 200, lineBreak: false, characterSpacing: 0.3 });

    // Row 2 values
    const visitDate = new Date(data.visit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const rxId = `RX-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${String(Math.floor(Math.random()*9999)).padStart(4,'0')}`;
    pin(157);
    doc.fontSize(10).font('Helvetica').fillColor(darkGray)
      .text(visitDate, cols[0], 157, { width: 120, lineBreak: false });
    pin(157);
    doc.fontSize(10).font('Helvetica').fillColor(darkGray)
      .text(rxId, cols[1], 157, { width: 200, lineBreak: false });

    // ── SECTIONS ─────────────────────────────────────────
    let y = 192;

    const sectionHeader = (title) => {
      pin(y);
      doc.fontSize(7.5).font('Helvetica-Bold').fillColor(teal)
        .text(title, 40, y, { width: pageWidth, lineBreak: false, characterSpacing: 0.5 });
      doc.moveTo(40, y + 13).lineTo(555, y + 13).lineWidth(0.5).strokeColor('#e5e7eb').stroke();
      y += 20;
    };

    // DIAGNOSIS
    if (data.diagnosis) {
      sectionHeader('DIAGNOSIS');
      pin(y);
      doc.fontSize(10).font('Helvetica').fillColor(darkGray)
        .text(data.diagnosis, 40, y, { width: pageWidth });
      y += doc.heightOfString(data.diagnosis, { width: pageWidth }) + 14;
    }

    // PRESCRIPTION
    if (data.prescription) {
      sectionHeader('PRESCRIPTION / MEDICINES');
      const lines = data.prescription.split('\n').filter(l => l.trim());
      lines.forEach((line, i) => {
        pin(y);
        doc.fontSize(8).font('Helvetica-Bold').fillColor(medGray)
          .text(String(i + 1).padStart(2, '0'), 40, y, { width: 20, lineBreak: false });
        pin(y);
        doc.fontSize(10).font('Helvetica-Bold').fillColor(darkGray)
          .text(line.trim(), 68, y, { width: pageWidth - 28 });
        y += doc.heightOfString(line.trim(), { width: pageWidth - 28 }) + 8;
      });
      y += 4;
    }

    // FOLLOW-UP
    if (data.follow_up_date) {
      sectionHeader('FOLLOW-UP');
      doc.rect(40, y, pageWidth, 38).fillColor('#f0fdf4').fill();
      pin(y + 5);
      doc.fontSize(6.5).font('Helvetica-Bold').fillColor(medGray)
        .text('NEXT VISIT', 52, y + 5, { lineBreak: false });
      pin(y + 16);
      const followUp = new Date(data.follow_up_date).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      doc.fontSize(11).font('Helvetica-Bold').fillColor(teal)
        .text(followUp, 52, y + 16, { width: 400, lineBreak: false });
      y += 48;
    }

    // NOTES
    if (data.notes) {
      sectionHeader("DOCTOR'S NOTES");
      const notesH = doc.heightOfString(data.notes, { width: pageWidth - 24 }) + 20;
      doc.rect(40, y, pageWidth, notesH).fillColor(lightGray).fill();
      pin(y + 10);
      doc.fontSize(9).font('Helvetica').fillColor(darkGray)
        .text(data.notes, 52, y + 10, { width: pageWidth - 24 });
      y += notesH + 10;
    }

    // ── FOOTER ────────────────────────────────────────────
    const footerY = 748;
    pin(footerY);
    doc.moveTo(40, footerY).lineTo(555, footerY).lineWidth(1).strokeColor(teal).stroke();

    pin(footerY + 10);
    doc.moveTo(40, footerY + 42).lineTo(200, footerY + 42).lineWidth(0.5).strokeColor(darkGray).stroke();
    pin(footerY + 44);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(medGray)
      .text("DOCTOR'S SIGNATURE", 40, footerY + 44, { lineBreak: false });
    pin(footerY + 54);
    doc.fontSize(8).font('Helvetica').fillColor(darkGray)
      .text(doctorName, 40, footerY + 54, { lineBreak: false });

    pin(footerY + 20);
    doc.fontSize(7.5).font('Helvetica').fillColor(medGray)
      .text('This is a computer-generated prescription.', 210, footerY + 20, { width: 170, align: 'center', lineBreak: false });
    pin(footerY + 31);
    doc.fontSize(7.5).font('Helvetica-Bold').fillColor(darkGray)
      .text('Valid for 30 days from date of issue.', 210, footerY + 31, { width: 170, align: 'center', lineBreak: false });

    pin(footerY + 8);
    doc.rect(420, footerY + 8, 120, 48).dash(3, { space: 3 }).strokeColor(medGray).lineWidth(0.5).stroke();
    pin(footerY + 60);
    doc.fontSize(7).font('Helvetica-Bold').fillColor(medGray)
      .text("DOCTOR'S STAMP & SEAL", 420, footerY + 60, { width: 120, align: 'center', lineBreak: false });

    pin(footerY + 75);
    doc.fontSize(7).font('Helvetica').fillColor('#9ca3af')
      .text('Powered by ', 40, footerY + 75, { width: pageWidth, align: 'center', lineBreak: false, continued: true });
    doc.font('Helvetica-Bold').fillColor(teal).text('ReceptionAI', { lineBreak: false });

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
