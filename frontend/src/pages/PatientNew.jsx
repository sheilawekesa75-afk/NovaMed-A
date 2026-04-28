import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useToast } from '../utils/useToast';

export default function PatientNew() {
  const nav = useNavigate();
  const { show, node } = useToast();

  const [f, setF] = useState({
    full_name: '', date_of_birth: '', sex: '',
    phone: '', email: '', national_id: '',
    address: '', blood_group: '',
    allergies: '', chronic_conditions: '',
    next_of_kin: '', next_of_kin_phone: '',
  });
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!f.full_name.trim()) { show('Full name is required', 'err'); return; }
    setBusy(true);
    try {
      const r = await api.post('/api/patients', f);
      show(`Patient registered: ${r.patient.patient_id}`);
      nav(`/patients/${r.patient.id}`);
    } catch (e) {
      show(e.message || 'Failed to register', 'err');
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Register patient</h1>
          <p>A unique Patient ID will be generated automatically.</p>
        </div>
      </div>

      <form className="card" onSubmit={submit}>
        <h3 className="card-title">Personal details</h3>
        <div className="row-2">
          <div className="field"><label>Full name *</label>
            <input value={f.full_name} onChange={e => set('full_name', e.target.value)} required /></div>
          <div className="field"><label>Date of birth</label>
            <input type="date" value={f.date_of_birth} onChange={e => set('date_of_birth', e.target.value)} /></div>
        </div>

        <div className="row-3">
          <div className="field"><label>Sex</label>
            <select value={f.sex} onChange={e => set('sex', e.target.value)}>
              <option value="">—</option>
              <option>Male</option>
              <option>Female</option>
              <option>Other</option>
            </select>
          </div>
          <div className="field"><label>Blood group</label>
            <select value={f.blood_group} onChange={e => set('blood_group', e.target.value)}>
              <option value="">—</option>
              {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(b => <option key={b}>{b}</option>)}
            </select>
          </div>
          <div className="field"><label>National ID</label>
            <input value={f.national_id} onChange={e => set('national_id', e.target.value)} /></div>
        </div>

        <div className="row-2">
          <div className="field"><label>Phone</label>
            <input value={f.phone} onChange={e => set('phone', e.target.value)} /></div>
          <div className="field"><label>Email</label>
            <input type="email" value={f.email} onChange={e => set('email', e.target.value)} /></div>
        </div>

        <div className="field"><label>Address</label>
          <textarea value={f.address} onChange={e => set('address', e.target.value)} /></div>

        <hr className="hr" />
        <h3 className="card-title">Medical background</h3>
        <div className="row-2">
          <div className="field"><label>Known allergies</label>
            <textarea placeholder="e.g. Penicillin → rash" value={f.allergies} onChange={e => set('allergies', e.target.value)} /></div>
          <div className="field"><label>Chronic conditions</label>
            <textarea placeholder="e.g. Type-2 diabetes, hypertension" value={f.chronic_conditions} onChange={e => set('chronic_conditions', e.target.value)} /></div>
        </div>

        <hr className="hr" />
        <h3 className="card-title">Next of kin</h3>
        <div className="row-2">
          <div className="field"><label>Name</label>
            <input value={f.next_of_kin} onChange={e => set('next_of_kin', e.target.value)} /></div>
          <div className="field"><label>Phone</label>
            <input value={f.next_of_kin_phone} onChange={e => set('next_of_kin_phone', e.target.value)} /></div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => nav(-1)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy}>
            {busy ? <span className="spinner" /> : 'Register patient'}
          </button>
        </div>
      </form>

      {node}
    </>
  );
}
