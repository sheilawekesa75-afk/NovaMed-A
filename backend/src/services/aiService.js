/**
 * NovaMed AI — AI-FIRST clinical service
 * =======================================
 * Hierarchy:
 *   1. PRIMARY:   External LLM (Gemini or OpenAI) — handles ALL clinical reasoning
 *   2. FALLBACK:  Local PostgreSQL knowledge base + rule logic
 *   3. SAFETY:    Last-resort markdown templates
 *
 * The user-facing interface never names the external AI vendor.
 * All clinical outputs follow the structured specification:
 *   - 1 provisional diagnosis (with justification)
 *   - 3 differential diagnoses (with supporting/opposing findings)
 *   - Investigations (labs / imaging / specialised) with purpose & value
 *   - Treatment plan as a TABLE (drug / dose / MoA / indication / CI / side effects)
 *   - Clinical reasoning paragraph
 *   - Professional summary
 */

const fs = require('fs');
const KB = require('./medicalKnowledge');
const DB = require('./medicalDB');

const PROVIDER = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const GROQ_KEY   = process.env.GROQ_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-2.0-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const GROQ_MODEL   = process.env.GROQ_MODEL   || 'llama-3.3-70b-versatile';

const HISTORY_SECTIONS = ['HPC', 'PMH', 'DH', 'FH', 'SH', 'ROS'];

const SYSTEM_PROMPT = `
You are the clinical reasoning engine inside the NovaMed AI clinical decision
support system, used by qualified healthcare professionals.

ABSOLUTE RULES:
- Refer ONLY to "the system" or "NovaMed AI". NEVER name any external AI vendor.
- All output is for clinician decision support, NOT direct patient instructions.
- Be concise, accurate, and follow exactly the JSON schema you are given.
- If a field is unknown, write "—" rather than inventing details.
- Use SI units. Drug doses must include route and frequency.

STRICT DIAGNOSTIC ACCURACY RULES — these override everything else:
1. NEVER invent, assume, or infer symptoms that are NOT explicitly present in the patient data.
2. NEVER exaggerate the severity or significance of a symptom beyond what was reported.
3. Only map symptoms that ACTUALLY APPEAR in the history or examination to a diagnosis.
4. If the available clinical data is insufficient to support a specific diagnosis, you MUST return
   provisional.name = "Insufficient data for diagnosis" and explain exactly what additional
   information is needed before a diagnosis can be made.
5. If the chief complaint and history clearly do NOT match any recognised disease pattern,
   return provisional.name = "No diagnosis matched — further evaluation needed" rather than
   guessing. Do not force a diagnosis to fill the field.
6. Likelihood scores must reflect the ACTUAL evidence in the case, not general disease prevalence.
   Do NOT rate a diagnosis "high" without sufficient supporting symptom mapping.
7. Differentials must ONLY be listed if there is genuine clinical data in the case supporting them.
   Do not add differentials just to fill the 3-item list — if fewer are justified, say so.
`.trim();

/* ============================================================
 * Low-level LLM calls
 * ============================================================ */
async function callGemini(prompt, { json = false, temperature = 0.4, maxOutputTokens = 4096 } = {}) {
  if (!GEMINI_KEY) throw new Error('NO_GEMINI_KEY');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: Array.isArray(prompt) ? prompt : [{ text: prompt }] }],
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
    generationConfig: {
      temperature, topK: 32, topP: 0.95, maxOutputTokens,
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
    safetySettings: [{ category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' }],
  };
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 220)}`);
  const data = await r.json();
  return (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
}

async function callOpenAI(prompt, { json = false, temperature = 0.4, maxTokens = 4096 } = {}) {
  if (!OPENAI_KEY) throw new Error('NO_OPENAI_KEY');
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (Array.isArray(prompt)) {
    const parts = prompt.map(p => p.text ? p : (p.inlineData
      ? { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } }
      : null)).filter(Boolean);
    messages.push({ role: 'user', content: parts.length === 1 ? parts[0].text || parts[0] : parts });
  } else {
    messages.push({ role: 'user', content: prompt });
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: OPENAI_MODEL, messages, temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 220)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

async function callGroq(prompt, { json = false, temperature = 0.4, maxTokens = 4096 } = {}) {
  if (!GROQ_KEY) throw new Error('NO_GROQ_KEY');
  const messages = [{ role: 'system', content: SYSTEM_PROMPT }];
  if (Array.isArray(prompt)) {
    // Groq does not support inline images — flatten to text only
    const text = prompt.map(p => p.text || '').filter(Boolean).join('\n');
    messages.push({ role: 'user', content: text });
  } else {
    messages.push({ role: 'user', content: prompt });
  }
  const body = {
    model: GROQ_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {}),
  };
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 220)}`);
  const d = await r.json();
  return d.choices?.[0]?.message?.content?.trim() || '';
}

/**
 * Primary LLM caller — tries the configured provider first, falls back to others.
 * Provider priority order:
 *   groq   → groq first, then gemini, then openai
 *   openai → openai first, then groq, then gemini
 *   gemini → gemini first, then groq, then openai  (default)
 * Throws ALL_AI_UNAVAILABLE if none are reachable.
 */
async function callLLM(prompt, opts = {}) {
  const tries = [];
  if (PROVIDER === 'openai')      tries.push(['openai', callOpenAI], ['groq', callGroq], ['gemini', callGemini]);
  else if (PROVIDER === 'groq')   tries.push(['groq', callGroq], ['gemini', callGemini], ['openai', callOpenAI]);
  else /* gemini (default) */     tries.push(['gemini', callGemini], ['groq', callGroq], ['openai', callOpenAI]);

  let lastErr;
  for (const [name, fn] of tries) {
    try {
      const txt = await fn(prompt, opts);
      if (txt && txt.length > 5) return txt;
    } catch (e) {
      lastErr = e;
      console.warn(`[ai] ${name} failed: ${e.message}`);
    }
  }
  const err = new Error('ALL_AI_UNAVAILABLE');
  err.cause = lastErr;
  throw err;
}

function parseJson(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const m = text.match(/```(?:json)?\s*([\s\S]+?)```/);
  if (m) try { return JSON.parse(m[1]); } catch {}
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s > -1 && e > s) try { return JSON.parse(text.slice(s, e + 1)); } catch {}
  return null;
}

function fileToInlinePart(filepath, mime) {
  const data = fs.readFileSync(filepath);
  return { inlineData: { mimeType: mime || 'application/octet-stream', data: data.toString('base64') } };
}

function ageOf(p) {
  if (!p?.date_of_birth) return null;
  return Math.floor((Date.now() - new Date(p.date_of_birth)) / 31557600000);
}

function patientContext(patient, encounter) {
  return `
PATIENT
- Sex: ${patient?.sex || 'unknown'}
- Age: ${ageOf(patient) ?? 'unknown'}
- Allergies: ${patient?.allergies || 'none recorded'}
- Chronic conditions: ${patient?.chronic_conditions || 'none recorded'}

CHIEF COMPLAINT: ${encounter?.chief_complaint || '—'}

HISTORY SUMMARY:
${encounter?.history_summary || '(none recorded)'}

EXAMINATION:
${JSON.stringify(encounter?.examination || {}, null, 2)}

WORKING DIAGNOSES (if any):
${JSON.stringify(encounter?.diagnoses || {}, null, 2)}

RESULTS / WARNINGS:
${JSON.stringify({ results: encounter?.results, warnings: encounter?.warnings }, null, 2)}
`.trim();
}

/* ============================================================
 * 1. ADAPTIVE NEXT QUESTION (AI-FIRST)
 * ============================================================ */
async function nextHistoryQuestion({ encounter, patient, turns }) {
  const history = turns || [];
  const askedSet = new Set(history.filter(t => t.role === 'ai').map(t => (t.question || '').trim()));
  const askedList = [...askedSet];

  // ── Try AI first ─────────────────────────────────────────
  try {
    const prompt = `
You are taking a structured clinical history. Generate the SINGLE most useful next
question to ask given the case so far. Output JSON ONLY:
{
  "section":   "HPC" | "PMH" | "DH" | "FH" | "SH" | "ROS" | "DONE",
  "question":  "the question text — phrased to the doctor (e.g. 'Ask the patient about radiation of the pain')",
  "rationale": "one short sentence why this question matters now",
  "done":      false,
  "summary":   null
}

If the history is sufficiently complete, return done=true and put a 200-word
narrative history summary in "summary" instead.

${patientContext(patient, encounter)}

QUESTIONS ALREADY ASKED (do not repeat):
${askedList.map(q => '- ' + q).join('\n') || '(none)'}

PRIOR ANSWERS:
${history.filter(t => t.role === 'patient').map(t => `[${t.section}] ${t.answer}`).join('\n') || '(none)'}
`.trim();

    const txt = await callLLM(prompt, { json: true, temperature: 0.35 });
    const obj = parseJson(txt);
    if (obj && (obj.question || obj.done)) {
      return {
        section: obj.section || 'HPC',
        question: obj.question || null,
        rationale: obj.rationale || '',
        done: !!obj.done,
        summary: obj.summary || null,
      };
    }
  } catch (e) {
    console.warn('[ai] nextHistoryQuestion → fallback:', e.message);
  }

  // ── Fallback: DB question bank ────────────────────────────
  try {
    const q = await DB.nextAdaptiveQuestion({ history, encounter, patient });
    if (q) return {
      section: q.section, question: q.question,
      rationale: 'Selected from the local clinical knowledge base.',
      done: false, summary: null,
    };
  } catch (e) {
    console.warn('[clinical] DB question failed:', e.message);
  }

  // Build summary from collected answers
  const sections = {};
  for (const t of history) {
    if (t.role === 'patient' && t.answer) {
      const k = t.section || 'OTHER';
      sections[k] = sections[k] || [];
      sections[k].push(t.answer);
    }
  }
  const parts = [`The patient presents with ${encounter.chief_complaint || 'an undefined complaint'}.`];
  for (const [sec, ans] of Object.entries(sections)) parts.push(`\n**${sec}:** ${ans.join(' ')}`);
  return { section: 'DONE', question: null, rationale: null, done: true, summary: parts.join('\n') };
}

/* ============================================================
 * 2. STRUCTURED DIAGNOSIS (AI-FIRST)
 * Returns:
 * {
 *   provisional: { name, justification, symptom_correlation, clinical_reasoning, likelihood },
 *   differentials: [
 *     { name, explanation, supporting, opposing, less_likely_because, likelihood }
 *   ],
 *   summary_for_doctor: "...",
 *   urgent: bool,
 *   source: "ai" | "fallback"
 * }
 * ============================================================ */
async function suggestDiagnoses({ patient, encounter }) {
  const prompt = `
Generate a STRUCTURED clinical diagnosis assessment based STRICTLY on the symptoms and findings
documented below. Do NOT invent, assume, or infer any symptom not explicitly present in the record.

Output JSON ONLY:
{
  "provisional": {
    "name": "the single most likely diagnosis — OR 'Insufficient data for diagnosis' if the available data does not support a specific diagnosis — OR 'No diagnosis matched — further evaluation needed' if the complaint does not fit any recognised pattern",
    "justification": "why this is the top choice — cite ONLY specific documented symptoms",
    "symptom_correlation": "map ONLY the documented symptoms/findings to this diagnosis. Never reference symptoms not in the record.",
    "clinical_reasoning": "step-by-step reasoning using only documented findings",
    "likelihood": "high | moderate | low | insufficient_data",
    "missing_information": "if data is insufficient, list exactly what clinical information is still needed to form a diagnosis"
  },
  "differentials": [
    {
      "name": "alternative diagnosis — include ONLY if genuinely supported by documented findings",
      "explanation": "what this is and why it is on the list — cite specific documented evidence",
      "supporting": ["only documented findings that support this"],
      "opposing":   ["documented findings that argue against this"],
      "less_likely_because": "specific reason it is less likely than the provisional",
      "likelihood": "moderate | low"
    }
  ],
  "summary_for_doctor": "200-300 words integrating ONLY documented history + examination + reasoning. Never mention symptoms that were not recorded.",
  "urgent": true | false,
  "data_quality": "sufficient | partial | insufficient"
}

RULES:
- Provide up to 3 differentials ONLY if supported by actual documented data. Fewer is acceptable.
- If provisional is 'Insufficient data' or 'No diagnosis matched', leave differentials empty or label them clearly speculative.
- Do NOT pad the diagnosis to appear more complete. Honest uncertainty is clinically correct.
- A diagnosis rated 'high' likelihood requires multiple corroborating documented symptoms/signs.

${patientContext(patient, encounter)}
`.trim();

  try {
    const txt = await callLLM(prompt, { json: true, temperature: 0.3, maxOutputTokens: 6000 });
    const obj = parseJson(txt);
    if (obj?.provisional?.name && Array.isArray(obj.differentials)) {
      // Build the legacy-shape `differentials[]` (top-level) for components that still expect it
      const legacy = [
        {
          name: obj.provisional.name,
          likelihood: obj.provisional.likelihood || 'high',
          reasoning: obj.provisional.justification || '',
          supporting: [],
          against: [],
          red_flags: [],
        },
        ...obj.differentials.map(d => ({
          name: d.name,
          likelihood: d.likelihood || 'moderate',
          reasoning: d.explanation || '',
          supporting: d.supporting || [],
          against: d.opposing || [],
          red_flags: [],
          less_likely_because: d.less_likely_because || '',
        })),
      ];
      return {
        provisional: obj.provisional,
        differentials: legacy,
        differentials_full: obj.differentials,
        summary_for_doctor: obj.summary_for_doctor || '',
        urgent: !!obj.urgent,
        source: 'ai',
      };
    }
  } catch (e) {
    console.warn('[ai] diagnosis → fallback:', e.message);
  }

  // ── Fallback: DB ranking + KB summary ─────────────────────
  let ranked = [];
  try {
    ranked = await DB.rankConditions({ patient, encounter, limit: 4 });
  } catch (e) { console.warn('[clinical] DB rank failed:', e.message); }
  if (!ranked.length) {
    const fb = KB.fallbackDiagnoses({ patient, encounter });
    return { ...fb, source: 'fallback' };
  }

  const top = ranked[0];
  const provisional = {
    name: top.name,
    justification: top.reasoning || `Pattern of features is most consistent with ${top.name}.`,
    symptom_correlation: `Supporting features: ${(top.supporting || []).join(', ') || 'see history & examination above'}.`,
    clinical_reasoning: `${top.reasoning || ''} Alternative explanations have been considered (see differentials).`,
    likelihood: top.likelihood,
  };
  const differentials_full = ranked.slice(1, 4).map(d => ({
    name: d.name,
    explanation: d.reasoning || '',
    supporting: d.supporting || [],
    opposing: d.against || [],
    less_likely_because: 'Lower keyword/demographic alignment in the local knowledge base than the provisional diagnosis.',
    likelihood: d.likelihood,
  }));
  const summary =
    `Based on the history and examination, the leading working diagnosis is **${top.name}** ` +
    `(${top.likelihood} likelihood). ${top.reasoning || ''} Other differentials considered: ` +
    `${differentials_full.map(d => d.name).join(', ') || 'none significant'}. ` +
    `Confirm with focused investigations and reassess as new information emerges.`;

  return {
    provisional,
    differentials: ranked,
    differentials_full,
    summary_for_doctor: summary,
    urgent: ranked.some(d => d.likelihood === 'high' && /sepsis|infarct|stroke|emergency|shock|pre-eclampsia|anaphylax/i.test(d.name)),
    source: 'fallback',
  };
}

/* ============================================================
 * 3. STRUCTURED INVESTIGATIONS
 * For each test: { test, category, purpose, expected, value, reason }
 * ============================================================ */
async function suggestInvestigations({ patient, encounter, chosenDiagnoses }) {
  const dxList = (chosenDiagnoses && chosenDiagnoses.length)
    ? chosenDiagnoses
    : (encounter.diagnoses?.chosen ||
       encounter.diagnoses?.provisional?.name ? [encounter.diagnoses.provisional.name] :
       (encounter.diagnoses?.differentials || []).map(d => d.name) || []);

  const prompt = `
Recommend a structured investigation plan for the following case. Output JSON ONLY:
{
  "labs":       [ { "test": "...", "purpose": "...", "expected": "...", "value": "..." } ],
  "imaging":    [ { "test": "...", "purpose": "...", "expected": "...", "value": "..." } ],
  "specialist": [ { "test": "...", "purpose": "...", "expected": "...", "value": "..." } ],
  "bedside":    [ { "test": "...", "purpose": "...", "expected": "...", "value": "..." } ]
}

For each test:
- "purpose": what question it answers
- "expected": what result you expect
- "value":  diagnostic value (sensitivity / specificity / decisional impact)

${patientContext(patient, encounter)}
WORKING DIAGNOSES: ${JSON.stringify(dxList)}
`.trim();

  try {
    const txt = await callLLM(prompt, { json: true, temperature: 0.3, maxOutputTokens: 4000 });
    const obj = parseJson(txt);
    if (obj && (obj.labs || obj.imaging || obj.bedside || obj.specialist)) {
      // Normalise: each item gets `test`, `reason` (legacy), and the new fields
      const norm = (arr) => (arr || []).map(x => ({
        test: x.test || x.name || String(x),
        reason: x.purpose || x.reason || '',
        purpose: x.purpose || '',
        expected: x.expected || '',
        value: x.value || '',
      }));
      return {
        labs: norm(obj.labs),
        imaging: norm(obj.imaging),
        bedside: norm(obj.bedside),
        specialist: norm(obj.specialist),
        source: 'ai',
      };
    }
  } catch (e) {
    console.warn('[ai] investigations → fallback:', e.message);
  }

  // Fallback: DB merge
  const merged = { labs: [], imaging: [], bedside: [], specialist: [] };
  const seen = new Set();
  for (const name of dxList) {
    try {
      const inv = await DB.investigationsFor(name);
      for (const cat of Object.keys(merged)) {
        for (const item of inv[cat] || []) {
          const key = `${cat}::${item.test}`;
          if (!seen.has(key)) { seen.add(key); merged[cat].push(item); }
        }
      }
    } catch {}
  }
  const total = Object.values(merged).reduce((a, x) => a + x.length, 0);
  if (total > 0) return { ...merged, source: 'fallback' };
  return { ...KB.fallbackInvestigations({ patient, encounter, chosenDiagnoses: dxList }), source: 'fallback' };
}

/* ============================================================
 * 4. STRUCTURED TREATMENT (TABLE FORMAT)
 * Output:
 * {
 *   first_line: [ {drug, dose, route, frequency, duration, mechanism, indication, contraindications, side_effects} ],
 *   alternatives: [ ... ],
 *   supportive: ["..."],
 *   non_drug: ["..."],
 *   monitoring: ["..."],
 *   follow_up: "...",
 *   patient_advice: "...",
 *   red_flags: ["..."],
 *   referrals: ["..."],
 *   clinical_reasoning: "why each treatment selected and disease pathology link"
 * }
 * Also exposes the legacy `plan{}` shape so existing UI keeps working.
 * ============================================================ */
async function suggestTreatment({ patient, encounter, chosenDiagnoses }) {
  const dxList = (chosenDiagnoses && chosenDiagnoses.length)
    ? chosenDiagnoses
    : (encounter.diagnoses?.chosen || []);

  const prompt = `
Generate a structured treatment plan in TABLE FORM. Output JSON ONLY:
{
  "first_line": [
    {
      "drug": "Drug name",
      "dose": "e.g. 500 mg",
      "route": "PO | IV | IM | SC | nebulised | topical",
      "frequency": "e.g. q8h",
      "duration": "e.g. 7 days",
      "mechanism": "mechanism of action",
      "indication": "specifically why for this patient",
      "contraindications": "key contraindications",
      "side_effects": "common side effects"
    }
  ],
  "alternatives": [ ... same shape ... ],
  "supportive":   ["IV fluids 0.9% NaCl ...", "Oxygen if SpO2<94%", ...],
  "non_drug":     ["bed rest", "elevation of affected limb", ...],
  "monitoring":   ["vitals q4h", "renal function on day 3", ...],
  "follow_up":    "review in 1 week / sooner if worse",
  "patient_advice": "plain-language advice for the patient",
  "red_flags":    ["return immediately if X", ...],
  "referrals":    ["cardiology", ...],
  "clinical_reasoning": "explain why each first-line agent was chosen and how it targets the disease pathology"
}

${patientContext(patient, encounter)}
WORKING DIAGNOSES: ${JSON.stringify(dxList)}
`.trim();

  try {
    const txt = await callLLM(prompt, { json: true, temperature: 0.3, maxOutputTokens: 6000 });
    const obj = parseJson(txt);
    if (obj && (obj.first_line || obj.alternatives)) {
      // Build legacy-shape plan{} so existing UI keeps working
      const meds = (obj.first_line || []).concat(obj.alternatives || []).map(d => ({
        name: d.drug, dose: d.dose, route: d.route, frequency: d.frequency, duration: d.duration,
        notes: [d.mechanism, d.indication, d.contraindications, d.side_effects].filter(Boolean).join(' · '),
      }));
      const plan = {
        immediate: obj.supportive || [],
        medications: meds,
        non_pharm: obj.non_drug || [],
        monitoring: obj.monitoring || [],
        follow_up: obj.follow_up || '',
        patient_advice: obj.patient_advice || '',
        red_flags: obj.red_flags || [],
        referrals: obj.referrals || [],
      };
      return { plan, structured: obj, source: 'ai' };
    }
  } catch (e) {
    console.warn('[ai] treatment → fallback:', e.message);
  }

  // Fallback: DB merge across diagnoses
  const plan = {
    immediate: [], medications: [], non_pharm: [], monitoring: [],
    follow_up: '', patient_advice: '', red_flags: [], referrals: [],
  };
  const seen = new Set();
  for (const name of dxList) {
    try {
      const p = await DB.treatmentFor(name);
      for (const x of p.immediate)  if (!plan.immediate.includes(x))  plan.immediate.push(x);
      for (const x of p.non_pharm)  if (!plan.non_pharm.includes(x))  plan.non_pharm.push(x);
      for (const x of p.monitoring) if (!plan.monitoring.includes(x)) plan.monitoring.push(x);
      for (const x of p.red_flags)  if (!plan.red_flags.includes(x))  plan.red_flags.push(x);
      for (const x of p.referrals)  if (!plan.referrals.includes(x))  plan.referrals.push(x);
      if (p.follow_up && !plan.follow_up) plan.follow_up = p.follow_up;
      if (p.patient_advice && !plan.patient_advice) plan.patient_advice = p.patient_advice;
      for (const m of p.medications) {
        const key = `${m.name}|${m.dose}`;
        if (!seen.has(key)) { seen.add(key); plan.medications.push(m); }
      }
    } catch {}
  }
  if (!plan.immediate.length && !plan.medications.length) {
    return { ...KB.fallbackTreatment({ patient, encounter, chosenDiagnoses: dxList }), source: 'fallback' };
  }

  // Build a minimal structured shape from DB plan
  const structured = {
    first_line: plan.medications.map(m => ({
      drug: m.name, dose: m.dose || '—', route: m.route || '—', frequency: m.frequency || '—',
      duration: m.duration || '—', mechanism: '—', indication: dxList.join(', '),
      contraindications: '—', side_effects: m.notes || '—',
    })),
    alternatives: [],
    supportive: plan.immediate,
    non_drug: plan.non_pharm,
    monitoring: plan.monitoring,
    follow_up: plan.follow_up,
    patient_advice: plan.patient_advice,
    red_flags: plan.red_flags,
    referrals: plan.referrals,
    clinical_reasoning: 'Treatment selected from local clinical knowledge base — verify against current guidelines.',
  };

  return { plan, structured, source: 'fallback' };
}

/* ============================================================
 * 5. PROFESSIONAL CLINICAL REPORT (final summary)
 * ============================================================ */
async function generateFinalSummary({ patient, encounter, doctorName }) {
  const prompt = `
Write a comprehensive professional clinical report for the following encounter.
600-1000 words in MARKDOWN. Include all of these sections in this order:

1. **Patient Identification & Demographics**
2. **Presenting Complaint & History of Presenting Illness**
3. **Past Medical, Drug, Family & Social History**
4. **Examination Findings (vitals + systems)**
5. **Working Diagnosis (provisional) and Differential Diagnoses**
6. **Investigations Ordered & Results Available**
7. **Management Plan (table of medications + supportive care + non-drug + monitoring)**
8. **Clinical Reasoning** — why this management for this disease pathology
9. **Patient Education & Follow-up**
10. **Red flags requiring urgent return**
11. **Sign-off:** clinician ${doctorName || '—'}, date ${new Date().toISOString().slice(0, 10)}

Read like a real medical report from start to finish. Do not invent data.

${patientContext(patient, encounter)}
`.trim();

  try {
    const txt = await callLLM(prompt, { temperature: 0.35, maxOutputTokens: 8000 });
    if (txt && txt.length > 400) return txt;
  } catch (e) {
    console.warn('[ai] final summary → fallback:', e.message);
  }
  return KB.fallbackFinalSummary({ patient, encounter, doctorName });
}

/* ============================================================
 * 6. PHASE REPORT
 * ============================================================ */
async function generatePhaseReport({ phase, patient, encounter, doctorName }) {
  const prompt = `
Write a 250-500 word clinical narrative for the **${phase}** phase of this encounter.
MARKDOWN. Use professional medical language. Do not invent missing data.

${patientContext(patient, encounter)}
Phase: ${phase}
Clinician: ${doctorName || '—'}
`.trim();

  try {
    const txt = await callLLM(prompt, { temperature: 0.35, maxOutputTokens: 3500 });
    if (txt && txt.length > 200) return txt;
  } catch (e) {
    console.warn('[ai] phase report → fallback:', e.message);
  }
  return KB.fallbackPhaseReport({ phase, patient, encounter, doctorName });
}

/* ============================================================
 * 7. RESULT INTERPRETATION (with optional file)
 * ============================================================ */
async function interpretResult({ patient, encounter, kind, valuesText, filepath, mimeType }) {
  const promptText = `
Interpret the following clinical result. Output JSON ONLY:
{
  "explanation": "narrative interpretation",
  "abnormalFindings": ["..."],
  "clinicalSignificance": "what this means for this patient",
  "abnormal": true | false,
  "urgent": true | false
}

${patientContext(patient, encounter)}
RESULT TYPE: ${kind || 'unknown'}
${valuesText ? 'VALUES:\n' + valuesText : 'A file is attached for visual interpretation.'}
`.trim();

  // Try AI first (with optional file)
  try {
    const parts = [{ text: promptText }];
    if (filepath && fs.existsSync(filepath)) parts.push(fileToInlinePart(filepath, mimeType));
    const txt = await callLLM(parts, { json: true, temperature: 0.25 });
    const obj = parseJson(txt);
    if (obj?.explanation) return { ...obj, source: 'ai' };
  } catch (e) {
    console.warn('[ai] result interpretation → fallback:', e.message);
  }

  // Fallback: deterministic lab range checker
  const text = (valuesText || '').toLowerCase();
  const findings = [];
  const checks = [
    { re: /\bwbc\b[^\d]*([\d.]+)/i, low: 4,    high: 11,  label: 'WBC',         unit: 'x10^9/L' },
    { re: /\bhb\b[^\d]*([\d.]+)/i,  low: 12,   high: 16,  label: 'Haemoglobin', unit: 'g/dL' },
    { re: /\bplt\b[^\d]*([\d.]+)/i, low: 150,  high: 400, label: 'Platelets',   unit: 'x10^9/L' },
    { re: /\bna\b[^\d]*([\d.]+)/i,  low: 135,  high: 145, label: 'Sodium',      unit: 'mmol/L' },
    { re: /\bk\b[^\d]*([\d.]+)/i,   low: 3.5,  high: 5.1, label: 'Potassium',   unit: 'mmol/L' },
    { re: /\bcr(?:eatinine)?\b[^\d]*([\d.]+)/i, low: 0.6, high: 1.3, label: 'Creatinine', unit: 'mg/dL' },
  ];
  for (const c of checks) {
    const m = text.match(c.re);
    if (m) {
      const v = parseFloat(m[1]);
      if (!isNaN(v)) {
        if (v < c.low)  findings.push(`${c.label} low (${v} ${c.unit}; normal ${c.low}–${c.high})`);
        if (v > c.high) findings.push(`${c.label} high (${v} ${c.unit}; normal ${c.low}–${c.high})`);
      }
    }
  }
  return {
    explanation: valuesText
      ? `Result values reviewed against reference ranges. ${findings.length ? findings.length + ' abnormality flagged.' : 'All measured values within normal limits.'}`
      : `A ${kind || 'file'} was uploaded and stored for clinical review.`,
    abnormalFindings: findings,
    clinicalSignificance: findings.length
      ? `Interpret in context of the working diagnoses (${(encounter.diagnoses?.chosen || []).join(', ') || 'pending'}).`
      : `No deviations from reference ranges detected. Continue clinical correlation.`,
    abnormal: findings.length > 0,
    urgent: false,
    source: 'fallback',
  };
}

/* ============================================================
 * 8. VITALS ABNORMALITIES (deterministic — always works)
 * ============================================================ */
function detectVitalAbnormalities(vitals = {}) {
  const out = [];
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

  const sys = num(vitals.systolic), dia = num(vitals.diastolic);
  if (sys != null) {
    if (sys >= 180) out.push({ sign: 'BP', detail: `Systolic ${sys} mmHg — hypertensive emergency range`, level: 'critical' });
    else if (sys >= 160) out.push({ sign: 'BP', detail: `Systolic ${sys} mmHg — markedly elevated`, level: 'warning' });
    else if (sys < 90)   out.push({ sign: 'BP', detail: `Systolic ${sys} mmHg — hypotension`, level: 'critical' });
  }
  if (dia != null && dia >= 110) out.push({ sign: 'BP', detail: `Diastolic ${dia} mmHg — severe hypertension`, level: 'warning' });

  const hr = num(vitals.heartRate);
  if (hr != null) {
    if (hr > 130) out.push({ sign: 'HR', detail: `HR ${hr} bpm — marked tachycardia`, level: 'critical' });
    else if (hr > 100) out.push({ sign: 'HR', detail: `HR ${hr} bpm — tachycardia`, level: 'warning' });
    else if (hr < 50)  out.push({ sign: 'HR', detail: `HR ${hr} bpm — bradycardia`, level: 'warning' });
  }

  const rr = num(vitals.respRate);
  if (rr != null) {
    if (rr >= 30) out.push({ sign: 'RR', detail: `RR ${rr}/min — severe tachypnoea`, level: 'critical' });
    else if (rr >= 24) out.push({ sign: 'RR', detail: `RR ${rr}/min — tachypnoea`, level: 'warning' });
    else if (rr < 10)  out.push({ sign: 'RR', detail: `RR ${rr}/min — bradypnoea`, level: 'critical' });
  }

  const temp = num(vitals.temperature);
  if (temp != null) {
    if (temp >= 39.5) out.push({ sign: 'Temp', detail: `Temp ${temp}°C — high fever`, level: 'warning' });
    else if (temp <= 35) out.push({ sign: 'Temp', detail: `Temp ${temp}°C — hypothermia`, level: 'critical' });
  }

  const spo2 = num(vitals.spo2);
  if (spo2 != null) {
    if (spo2 < 90)      out.push({ sign: 'SpO₂', detail: `SpO₂ ${spo2}% — significant hypoxia`, level: 'critical' });
    else if (spo2 < 94) out.push({ sign: 'SpO₂', detail: `SpO₂ ${spo2}% — mild hypoxia`, level: 'warning' });
  }

  const gcs = num(vitals.gcs);
  if (gcs != null && gcs <= 8)       out.push({ sign: 'GCS', detail: `GCS ${gcs} — depressed consciousness`, level: 'critical' });
  else if (gcs != null && gcs <= 12) out.push({ sign: 'GCS', detail: `GCS ${gcs} — reduced consciousness`, level: 'warning' });

  const bgl = num(vitals.bgl);
  if (bgl != null) {
    if (bgl < 4)       out.push({ sign: 'BGL', detail: `BGL ${bgl} mmol/L — hypoglycaemia`, level: 'critical' });
    else if (bgl > 15) out.push({ sign: 'BGL', detail: `BGL ${bgl} mmol/L — marked hyperglycaemia`, level: 'warning' });
  }
  return out;
}

module.exports = {
  nextHistoryQuestion,
  suggestDiagnoses,
  suggestInvestigations,
  interpretResult,
  detectVitalAbnormalities,
  suggestTreatment,
  generatePhaseReport,
  generateFinalSummary,
  HISTORY_SECTIONS,
};
