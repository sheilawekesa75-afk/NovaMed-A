import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

export default function AdminPage() {
  const { user, logout } = useAuth();
  const [tab, setTab] = useState('users');
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [u, s, a] = await Promise.all([
        api.get('/api/admin/users'),
        api.get('/api/admin/stats'),
        api.get('/api/admin/audit'),
      ]);
      setUsers(u.users || []);
      setStats(s.stats || null);
      setAudit(a.log || []);
    } catch (e) {
      setMsg(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadAll(); }, []);

  if (user?.role !== 'admin') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <h2>Access denied</h2>
        <p>This area is for system administrators only.</p>
        <Link to="/dashboard" className="btn btn-ghost">← Back</Link>
      </div>
    );
  }

  const toggleUser = async (u) => {
    setMsg('');
    try {
      await api.post(`/api/admin/users/${u.id}/${u.is_active ? 'disable' : 'enable'}`);
      await loadAll();
      setMsg(`User ${u.email} ${u.is_active ? 'disabled' : 'enabled'}.`);
    } catch (e) { setMsg(e.message); }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#f5f8fc', padding: 24 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 28 }}>
              🛡️ Admin console
            </h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              System administration — user accounts only. Patient medical data is not visible here.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={loadAll}>↻ Refresh</button>
            <button className="btn btn-danger" onClick={logout}>Sign out</button>
          </div>
        </div>

        {msg && (
          <div className="card" style={{ background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46', marginBottom: 14 }}>
            {msg}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat-card">
              <div className="ic">👥</div><div className="lbl">Users</div><div className="val">{stats.users}</div>
            </div>
            <div className="stat-card mint">
              <div className="ic">✅</div><div className="lbl">Active</div><div className="val">{stats.users_active}</div>
            </div>
            <div className="stat-card warn">
              <div className="ic">🚫</div><div className="lbl">Disabled</div><div className="val">{stats.users_disabled}</div>
            </div>
            <div className="stat-card">
              <div className="ic">📚</div><div className="lbl">Diseases</div><div className="val">{stats.diseases}</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', gap: 0 }}>
            <TabButton active={tab === 'users'} onClick={() => setTab('users')}>Users ({users.length})</TabButton>
            <TabButton active={tab === 'audit'} onClick={() => setTab('audit')}>Audit log ({audit.length})</TabButton>
          </div>

          <div style={{ padding: 18 }}>
            {loading ? (
              <div className="empty"><span className="spinner" /> Loading…</div>
            ) : tab === 'users' ? (
              users.length === 0 ? (
                <div className="empty">No users registered yet.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Name</th><th>Email</th><th>Role</th>
                        <th>Specialty</th><th>Patients</th><th>Last login</th>
                        <th>Created</th><th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map(u => (
                        <tr key={u.id}>
                          <td><strong>{u.full_name}</strong></td>
                          <td>{u.email}</td>
                          <td><span className="pill pill-violet">{u.role}</span></td>
                          <td>{u.specialty || '—'}</td>
                          <td>{u.patients_count}</td>
                          <td style={{ fontSize: 12 }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}</td>
                          <td style={{ fontSize: 12 }}>{new Date(u.created_at).toLocaleDateString()}</td>
                          <td>
                            <button
                              className={'toggle-btn ' + (u.is_active ? 'toggle-on' : 'toggle-off')}
                              onClick={() => toggleUser(u)}
                            >
                              {u.is_active ? '● Active' : '○ Disabled'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : tab === 'audit' ? (
              audit.length === 0 ? (
                <div className="empty">No audit events recorded.</div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="table">
                    <thead>
                      <tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>
                    </thead>
                    <tbody>
                      {audit.map(a => (
                        <tr key={a.id}>
                          <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                            {new Date(a.created_at).toLocaleString()}
                          </td>
                          <td>{a.user_name || '—'}<br/><span className="muted" style={{ fontSize: 11 }}>{a.user_email}</span></td>
                          <td><span className="pill pill-gray">{a.action}</span></td>
                          <td style={{ fontSize: 12, fontFamily: 'monospace' }}>
                            {a.detail ? JSON.stringify(a.detail) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : null}
          </div>
        </div>

        <div className="card" style={{ marginTop: 18, fontSize: 13, color: '#64748b' }}>
          <strong>Privacy notice:</strong> Admin access is limited to user account management.
          Patient medical records, encounters, and clinical data are NOT visible from this console.
          All admin logins are logged to the audit trail.
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 'none',
        padding: '12px 20px',
        background: 'none',
        border: 'none',
        borderBottom: '3px solid ' + (active ? '#1d4ed8' : 'transparent'),
        color: active ? '#1d4ed8' : '#64748b',
        fontWeight: 600,
        fontSize: 14,
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
