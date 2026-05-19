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
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const buffers = [];
    doc.on('data', chunk => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Header
    doc.fontSize(22).font('Helvetica-Bold').fillColor('#0d9488').text(data.clinic_name, { align: 'center' });
    if (data.clinic_address) {
      doc.fontSize(10).font('Helvetica').fillColor('#666').text(data.clinic_address, { align: 'center' });
    }
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#0d9488').stroke();
    doc.moveDown(0.5);

    // Doctor info
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#111').text(`Dr. ${data.doctor_name || 'Unknown'}`);
    if (data.specialization) doc.fontSize(10).font('Helvetica').fillColor('#444').text(data.specialization);
    if (data.qualification) doc.fontSize(10).font('Helvetica').fillColor('#444').text(data.qualification);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.5);

    // Patient info
    const visitDate = new Date(data.visit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#111').text('PATIENT DETAILS', { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica').fillColor('#333');
    doc.text(`Name: ${data.patient_name || 'Unknown'}`, { continued: true });
    doc.text(`   Date: ${visitDate}`, { align: 'right' });
    if (data.age) doc.text(`Age: ${data.age} years`, { continued: true });
    if (data.gender) doc.text(`   Gender: ${data.gender}`);
    if (data.blood_group) doc.text(`Blood Group: ${data.blood_group}`);
    doc.moveDown(0.5);
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.5);

    // Diagnosis
    if (data.diagnosis) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('DIAGNOSIS');
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica').fillColor('#333').text(data.diagnosis);
      doc.moveDown(0.5);
    }

    // Prescription
    if (data.prescription) {
      doc.fontSize(11).font('Helvetica-Bold').fillColor('#111').text('PRESCRIPTION');
      doc.moveDown(0.3);
      doc.fontSize(11).font('Helvetica').fillColor('#333').text(data.prescription);
      doc.moveDown(0.5);
    }

    // Follow up
    if (data.follow_up_date) {
      const followUp = new Date(data.follow_up_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0d9488').text(`Follow-up: ${followUp}`);
      doc.moveDown(0.5);
    }

    // Notes
    if (data.notes) {
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#111').text('NOTES');
      doc.moveDown(0.3);
      doc.fontSize(10).font('Helvetica').fillColor('#333').text(data.notes);
      doc.moveDown(0.5);
    }

    // Footer
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(0.5);
    doc.fontSize(8).font('Helvetica').fillColor('#999')
      .text('This is a computer-generated prescription. Valid for 30 days from date of issue.', { align: 'center' });
    doc.fontSize(8).fillColor('#ccc').text('Powered by ReceptionAI', { align: 'center' });

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
