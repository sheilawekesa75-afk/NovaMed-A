/**
 * NovaMed AI — DB-driven medical knowledge service
 * =================================================
 * Replaces hardcoded condition logic with PostgreSQL queries.
 * Provides:
 *   - rankConditions(text, age, sex)  → top differentials
 *   - investigationsFor(diseaseName)  → labs/imaging/bedside/specialist
 *   - treatmentFor(diseaseName)       → full plan
 *   - nextAdaptiveQuestion(history)   → next best question to ask
 *   - listSymptoms() / listDiseases() → for admin / debugging
 *
 * Falls back gracefully (returns []) if the DB is empty.
 */
const db = require('../db');

/* ---------- helpers ---------- */
function ageFrom(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / 31557600000);
}
function ageGroupOf(age) {
  if (age == null) return 'any';
  return age <= 16 ? 'pediatric' : 'adult';
}
function caseTextFrom({ patient, encounter }) {
  const ex = encounter?.examination || {};
  const exam = [
    ex.general || '',
    ex.appearance || '',
    ex.systems || '',
    JSON.stringify(ex.systems_detail || {}),
  ].join(' ');
  return [
    encounter?.chief_complaint || '',
    encounter?.history_summary || '',
    exam,
    JSON.stringify(encounter?.results || ''),
  ].join(' ').toLowerCase();
}

/* ===========================================================
 * Score & rank diseases against the case text
 * =========================================================== */
async function rankConditions({ patient, encounter, limit = 5 }) {
  const text   = caseTextFrom({ patient, encounter });
  const age    = ageFrom(patient?.date_of_birth);
  const sex    = (patient?.sex || '').toLowerCase();
  const ageGrp = ageGroupOf(age);

  // Pull all keywords once (small set), score in JS.
  const { rows: kws } = await db.query(`
    SELECT dk.disease_id, dk.keyword, dk.weight, dk.against,
           d.name, d.category, d.age_group, d.sex AS dsex,
           d.reasoning, d.red_flags
    FROM disease_keywords dk
    JOIN diseases d ON d.id = dk.disease_id
  `);
  if (!kws.length) return [];

  // Group by disease
  const byDisease = new Map();
  for (const k of kws) {
    if (!byDisease.has(k.disease_id)) {
      byDisease.set(k.disease_id, {
        id: k.disease_id, name: k.name, category: k.category,
        ageGroup: k.age_group, sex: k.dsex,
        reasoning: k.reasoning, redFlags: k.red_flags || [],
        score: 0, supporting: [], against: [],
      });
    }
    const d = byDisease.get(k.disease_id);
    const lower = (k.keyword || '').toLowerCase();
    if (text.includes(lower)) {
      const w = Number(k.weight) || 1;
      if (k.against) { d.score -= w; d.against.push(k.keyword); }
      else           { d.score += w; d.supporting.push(k.keyword); }
    }
  }

  // Apply demographic filters
  for (const d of byDisease.values()) {
    if (d.ageGroup && d.ageGroup !== 'any' && d.ageGroup !== ageGrp) d.score -= 10;
    if (d.sex && d.sex !== 'any' && d.sex !== sex) d.score -= 5;
  }

  const ranked = [...byDisease.values()]
    .filter(d => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // Decorate with likelihood label
  const out = ranked.map(d => ({
    name: d.name,
    category: d.category,
    likelihood: d.score >= 12 ? 'high' : d.score >= 5 ? 'moderate' : 'low',
    reasoning: d.reasoning || `Pattern of features consistent with ${d.name}.`,
    supporting: d.supporting.slice(0, 6),
    against:    d.against.slice(0, 6),
    red_flags:  d.redFlags.slice(0, 6),
  }));
  return out;
}

/* ===========================================================
 * Investigations for a disease
 * =========================================================== */
async function investigationsFor(diseaseName) {
  const { rows } = await db.query(`
    SELECT di.category, di.test, di.reason
      FROM disease_investigations di
      JOIN diseases d ON d.id = di.disease_id
     WHERE LOWER(d.name) = LOWER($1)
     ORDER BY di.id ASC
  `, [diseaseName]);

  const out = { labs: [], imaging: [], bedside: [], specialist: [] };
  for (const r of rows) {
    const arr = r.category === 'lab' ? out.labs : out[r.category];
    if (arr) arr.push({ test: r.test, reason: r.reason });
  }
  return out;
}

/* ===========================================================
 * Treatment plan for a disease
 * =========================================================== */
async function treatmentFor(diseaseName) {
  const { rows } = await db.query(`
    SELECT dt.type, dt.item, dt.dose, dt.route, dt.frequency, dt.duration, dt.notes
      FROM disease_treatments dt
      JOIN diseases d ON d.id = dt.disease_id
     WHERE LOWER(d.name) = LOWER($1)
     ORDER BY dt.id ASC
  `, [diseaseName]);

  const plan = {
    immediate: [], medications: [], non_pharm: [], monitoring: [],
    follow_up: '', patient_advice: '', red_flags: [], referrals: [],
  };
  for (const r of rows) {
    switch (r.type) {
      case 'immediate':  plan.immediate.push(r.item); break;
      case 'non_pharm':  plan.non_pharm.push(r.item); break;
      case 'monitoring': plan.monitoring.push(r.item); break;
      case 'red_flag':   plan.red_flags.push(r.item); break;
      case 'referral':   plan.referrals.push(r.item); break;
      case 'follow_up':  plan.follow_up = r.item; break;
      case 'advice':     plan.patient_advice = r.item; break;
      case 'medication':
        plan.medications.push({
          name: r.item, dose: r.dose, route: r.route,
          frequency: r.frequency, duration: r.duration, notes: r.notes,
        });
        break;
    }
  }
  return plan;
}

/* ===========================================================
 * Adaptive next question
 * Picks the highest-importance question we haven't asked yet,
 * preferring ones whose `follow_up_for` keyword appears in the
 * conversation so far.
 * =========================================================== */
async function nextAdaptiveQuestion({ history, encounter, patient }) {
  const askedQuestions = new Set(
    (history || []).filter(t => t.role === 'ai').map(t => (t.question || '').trim())
  );
  const text = (
    [encounter?.chief_complaint, encounter?.history_summary]
    .concat((history || []).map(t => `${t.question || ''} ${t.answer || ''}`))
    .join(' ')
    .toLowerCase()
  );

  const { rows: qs } = await db.query(
    `SELECT * FROM history_questions ORDER BY importance DESC, id ASC`
  );
  if (!qs.length) return null;

  // Score: importance + bonus if its follow_up_for keyword is in case text
  const scored = qs
    .filter(q => !askedQuestions.has(q.question.trim()))
    .map(q => {
      let score = Number(q.importance) || 5;
      if (q.follow_up_for && text.includes(q.follow_up_for.toLowerCase())) score += 6;
      return { q, score };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  return scored[0].q;
}

/* ===========================================================
 * Listing helpers (admin/debug)
 * =========================================================== */
async function listDiseases() {
  const { rows } = await db.query(
    `SELECT id, name, category, age_group, sex FROM diseases ORDER BY name ASC`
  );
  return rows;
}
async function listSymptoms() {
  const { rows } = await db.query(
    `SELECT id, name, body_system FROM symptoms ORDER BY body_system, name`
  );
  return rows;
}

module.exports = {
  rankConditions,
  investigationsFor,
  treatmentFor,
  nextAdaptiveQuestion,
  listDiseases,
  listSymptoms,
};
