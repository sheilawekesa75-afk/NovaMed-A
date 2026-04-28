/**
 * Generate a clinical summary PDF for an encounter.
 * Uses pdfkit so no headless browser is required.
 */
const PDFDocument = require('pdfkit');

function fmtAge(dob) {
  if (!dob) return '—';
  return Math.floor((Date.now() - new Date(dob)) / 31557600000) + ' yrs';
}

function buildEncounterPdf(res, { patient, encounter, uploads, doctorName }) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="NovaMed-${patient.patient_id}-${encounter.id}.pdf"`);
  doc.pipe(res);

  // ---- header band ----
  doc.rect(0, 0, doc.page.width, 90).fill('#0b3d91');
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(22).text('NovaMed AI', 50, 28);
  doc.font('Helvetica').fontSize(10).fillColor('#cfe1ff')
     .text('Clinical Encounter Summary', 50, 56)
     .text(new Date().toLocaleString(), 50, 70);

  doc.moveDown(4);
  doc.fillColor('#000');

  // ---- patient block ----
  section(doc, 'Patient');
  kv(doc, 'Patient ID', patient.patient_id);
  kv(doc, 'Name',       patient.full_name);
  kv(doc, 'Sex / Age',  `${patient.sex || '—'} / ${fmtAge(patient.date_of_birth)}`);
  kv(doc, 'Phone',      patient.phone || '—');
  kv(doc, 'Allergies',  patient.allergies || 'None recorded');
  kv(doc, 'Chronic',    patient.chronic_conditions || 'None recorded');

  // ---- encounter ----
  doc.moveDown(0.6);
  section(doc, 'Encounter');
  kv(doc, 'Encounter ID', `#${encounter.id}`);
  kv(doc, 'Date',         new Date(encounter.created_at).toLocaleString());
  kv(doc, 'Doctor',       doctorName || '—');
  kv(doc, 'Status',       encounter.status);
  kv(doc, 'History type', encounter.history_type || 'general');
  kv(doc, 'Chief complaint', encounter.chief_complaint || '—');

  // ---- history summary ----
  doc.moveDown(0.6);
  section(doc, 'History summary');
  paragraph(doc, encounter.history_summary || '(No history summary recorded.)');

  // ---- examination ----
  doc.moveDown(0.6);
  section(doc, 'Examination');
  const exam = encounter.examination || {};
  if (exam.vitals) {
    const v = exam.vitals;
    paragraph(doc,
      `Vitals — BP ${v.systolic || '—'}/${v.diastolic || '—'} mmHg, ` +
      `HR ${v.heartRate || '—'}, RR ${v.respRate || '—'}, ` +
      `Temp ${v.temperature || '—'} °C, SpO₂ ${v.spo2 || '—'}%, GCS ${v.gcs || '—'}.`);
  }
  if (exam.general)  paragraph(doc, `General: ${exam.general}`);
  if (exam.systems)  paragraph(doc, `Systems: ${exam.systems}`);

  // ---- warnings ----
  if (encounter.warnings && encounter.warnings.length) {
    doc.moveDown(0.6);
    section(doc, 'Warnings & abnormal signs', '#b00020');
    encounter.warnings.forEach(w => {
      doc.fillColor('#b00020').font('Helvetica-Bold').fontSize(10).text(`• [${(w.level || '').toUpperCase()}] ${w.sign}`, { continued: true })
         .font('Helvetica').fillColor('#000').text(`  ${w.detail || ''}`);
    });
  }

  // ---- diagnoses ----
  doc.moveDown(0.6);
  section(doc, 'Diagnoses');
  const dx = encounter.diagnoses || {};
  if (dx.chosen && dx.chosen.length) {
    doc.font('Helvetica-Bold').fontSize(10).text('Working diagnoses:');
    doc.font('Helvetica');
    dx.chosen.forEach(d => doc.text(`  • ${d}`));
  }
  if (dx.differentials && dx.differentials.length) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(10).text('AI differentials:');
    doc.font('Helvetica');
    dx.differentials.forEach(d => doc.text(`  • ${d.name} (${d.likelihood}) — ${d.reasoning || ''}`));
  }

  // ---- investigations & results ----
  doc.moveDown(0.6);
  section(doc, 'Investigations & results');
  const inv = encounter.investigations || {};
  ['labs', 'imaging', 'bedside', 'specialist'].forEach(group => {
    if (inv[group] && inv[group].length) {
      doc.font('Helvetica-Bold').fontSize(10).text(group.toUpperCase() + ':');
      doc.font('Helvetica');
      inv[group].forEach(i => doc.text(`  • ${i.test}${i.reason ? ' — ' + i.reason : ''}`));
    }
  });
  const results = encounter.results || {};
  if (Array.isArray(results.entries) && results.entries.length) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fontSize(10).text('Result interpretations:');
    doc.font('Helvetica');
    results.entries.forEach(r => {
      doc.text(`  • ${r.kind || 'result'} — ${r.label || ''}`);
      if (r.interpretation) paragraph(doc, '     ' + r.interpretation, 9);
    });
  }

  // ---- treatment ----
  doc.moveDown(0.6);
  section(doc, 'Treatment plan');
  const tx = encounter.treatment_plan || {};
  if (tx.immediate?.length) {
    doc.font('Helvetica-Bold').text('Immediate:'); doc.font('Helvetica');
    tx.immediate.forEach(t => doc.text(`  • ${t}`));
  }
  if (tx.medications?.length) {
    doc.font('Helvetica-Bold').text('Medications:'); doc.font('Helvetica');
    tx.medications.forEach(m =>
      doc.text(`  • ${m.name} ${m.dose || ''} ${m.route || ''} ${m.frequency || ''} ${m.duration ? '× '+m.duration : ''}`.trim()));
  }
  if (tx.non_pharm?.length) {
    doc.font('Helvetica-Bold').text('Non-pharmacological:'); doc.font('Helvetica');
    tx.non_pharm.forEach(t => doc.text(`  • ${t}`));
  }
  if (tx.monitoring?.length) {
    doc.font('Helvetica-Bold').text('Monitoring:'); doc.font('Helvetica');
    tx.monitoring.forEach(t => doc.text(`  • ${t}`));
  }
  if (tx.follow_up)      kv(doc, 'Follow-up', tx.follow_up);
  if (tx.patient_advice) { doc.moveDown(0.3); doc.font('Helvetica-Bold').text('Advice for patient:'); doc.font('Helvetica'); paragraph(doc, tx.patient_advice); }
  if (tx.red_flags?.length) {
    doc.moveDown(0.3);
    doc.font('Helvetica-Bold').fillColor('#b00020').text('Return immediately if:'); doc.fillColor('#000').font('Helvetica');
    tx.red_flags.forEach(t => doc.text(`  • ${t}`));
  }

  // ---- attachments ----
  if (uploads && uploads.length) {
    doc.moveDown(0.6);
    section(doc, 'Attached files');
    uploads.forEach(u => {
      doc.text(`  • [${u.kind}] ${u.original_name || u.stored_path}${u.abnormal ? '   ⚠ abnormal' : ''}`);
    });
  }

  // ---- footer ----
  doc.moveDown(2);
  doc.fontSize(8).fillColor('#666')
     .text('This report is generated by NovaMed AI and is intended as decision support. Final clinical decisions remain the responsibility of the attending clinician.', { align: 'center' });

  doc.end();
}

function section(doc, title, color = '#0b3d91') {
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(color).text(title);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(color).lineWidth(0.7).stroke();
  doc.fillColor('#000').font('Helvetica').fontSize(10).moveDown(0.3);
}
function kv(doc, k, v) {
  doc.font('Helvetica-Bold').fontSize(10).text(k + ':', { continued: true, width: 110 });
  doc.font('Helvetica').text('  ' + (v == null ? '—' : String(v)));
}
function paragraph(doc, text, size = 10) {
  doc.font('Helvetica').fontSize(size).fillColor('#222').text(text, { align: 'left' });
  doc.fillColor('#000');
}

module.exports = { buildEncounterPdf };
