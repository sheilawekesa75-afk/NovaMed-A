import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr(''); setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      nav('/dashboard');
    } catch (e) {
      setErr(e.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.left}>
        <div style={s.brand}>
          <div style={s.logo}>N+</div>
          <span>NovaMed AI</span>
        </div>
        <h2 style={s.h2}>Clinical AI, in your workflow.</h2>
        <p style={s.lead}>
          Adaptive history-taking, AI-assisted diagnosis, automated result
          interpretation and structured treatment plans — all in one place.
        </p>
        <ul style={s.list}>
          <li>🩺 Adaptive history-taking with smart follow-ups</li>
          <li>🧠 AI-powered differential diagnosis</li>
          <li>🩻 Reads X-rays, ECGs and lab reports</li>
          <li>⚠️ Auto-flags abnormal vitals and findings</li>
          <li>📄 One-click clinical PDF summaries</li>
        </ul>
      </div>

      <div style={s.right}>
        <form className="card" style={s.form} onSubmit={onSubmit}>
          <h2 style={{ margin: 0, fontFamily: 'Plus Jakarta Sans, sans-serif' }}>Sign in</h2>
          <p className="muted" style={{ marginTop: 4, marginBottom: 20, fontSize: 14 }}>
            Welcome back. Please enter your credentials.
          </p>

          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>

          {err && <div style={s.err}>{err}</div>}

          <button className="btn btn-primary btn-block" disabled={loading} type="submit">
            {loading ? <span className="spinner" /> : 'Sign in →'}
          </button>

          <p style={{ marginTop: 18, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
            <Link to="/reset-password" style={{ color: '#1e6bff', fontWeight: 600 }}>
              Forgot password?
            </Link>
          </p>
          <p style={{ marginTop: 6, fontSize: 13, color: '#64748b', textAlign: 'center' }}>
            Don't have an account?{' '}
            <Link to="/register" style={{ color: '#1e6bff', fontWeight: 600 }}>
              Register here
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}

const s = {
  wrap: { minHeight: '100vh', display: 'grid', gridTemplateColumns: '1.1fr 1fr' },
  left: {
    background: 'linear-gradient(180deg, #1e6bff 0%, #0b3d91 100%)',
    color: '#fff', padding: '60px 56px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
  },
  brand: { display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 22, marginBottom: 30 },
  logo: { width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #4f8eff, #34d399)', display: 'grid', placeItems: 'center', fontWeight: 800 },
  h2: { fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 36, fontWeight: 800, lineHeight: 1.1, margin: 0, letterSpacing: '-.02em' },
  lead: { color: '#cfe1ff', fontSize: 15.5, lineHeight: 1.6, marginTop: 14, maxWidth: 480 },
  list: { color: '#dbeafe', fontSize: 14.5, marginTop: 28, listStyle: 'none', padding: 0, lineHeight: 2.2 },
  right: { display: 'grid', placeItems: 'center', padding: 24, background: '#f5f8fc' },
  form: { width: '100%', maxWidth: 380, padding: 32 },
  err: { background: '#fef2f2', color: '#991b1b', border: '1px solid #fecaca', padding: '10px 12px', borderRadius: 10, fontSize: 13, marginBottom: 14 },
};
