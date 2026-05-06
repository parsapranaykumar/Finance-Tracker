import { useState, useEffect } from 'react'
import './App.css'
import { db, auth, provider } from './firebase'
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore'

// ── Constants ──────────────────────────────────────────────────────────────
const CATEGORIES = ["food", "housing", "utilities", "transport", "entertainment", "salary", "other"];

const fmt = (n) =>
  n.toLocaleString('en-IN', { style: 'currency', currency: 'INR' });

// ── WhatsApp report ────────────────────────────────────────────────────────
function getDateRange(period) {
  const start = new Date();
  if (period === 'daily')   start.setHours(0, 0, 0, 0);
  if (period === 'weekly')  start.setDate(start.getDate() - 7);
  if (period === 'monthly') { start.setDate(1); start.setHours(0, 0, 0, 0); }
  return start;
}

function buildWhatsAppMessage(period, transactions) {
  const start    = getDateRange(period);
  const filtered = transactions.filter(t => new Date(t.date) >= start);
  const income   = filtered.filter(t => t.type === 'income') .reduce((s, t) => s + t.amount, 0);
  const expenses = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const balance  = income - expenses;
  const label    = period.charAt(0).toUpperCase() + period.slice(1);
  const breakdown = CATEGORIES
    .map(cat => ({ cat, total: filtered.filter(t => t.type === 'expense' && t.category === cat).reduce((s, t) => s + t.amount, 0) }))
    .filter(c => c.total > 0).sort((a, b) => b.total - a.total)
    .map(c => `  • ${c.cat}: ₹${c.total.toFixed(2)}`).join('\n');
  return `💰 *Finance Tracker – ${label} Report*\n📅 ${start.toLocaleDateString('en-IN')} → ${new Date().toLocaleDateString('en-IN')}\n\n✅ Income:   ₹${income.toFixed(2)}\n❌ Expenses: ₹${expenses.toFixed(2)}\n📊 Balance:  ₹${balance.toFixed(2)}\n\n🧾 *Expense Breakdown:*\n${breakdown || '  No expenses in this period.'}\n\n_Sent from Finance Tracker_`;
}

// ── Login Screen ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin, error }) {
  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>Finance Tracker</h1>
        <p className="login-subtitle">Sign in to access your personal finance data</p>
        {error && <p className="form-error" style={{ marginBottom: '12px' }}>{error}</p>}
        <button className="google-btn" onClick={onLogin}>
          <svg width="18" height="18" viewBox="0 0 18 18" style={{ marginRight: '10px', flexShrink: 0 }}>
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
            <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/>
          </svg>
          Sign in with Google
        </button>
        <p className="login-note">Your data is private — only you can see your transactions.</p>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────
function App() {
  const [user,         setUser]         = useState(null);
  const [authLoading,  setAuthLoading]  = useState(true);
  const [authError,    setAuthError]    = useState("");

  const [transactions, setTransactions] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [fbError,      setFbError]      = useState("");
  const [saving,       setSaving]       = useState(false);

  const [description,    setDescription]    = useState("");
  const [amount,         setAmount]         = useState("");
  const [type,           setType]           = useState("expense");
  const [category,       setCategory]       = useState("food");
  const [filterType,     setFilterType]     = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy,         setSortBy]         = useState("date-desc");
  const [formError,      setFormError]      = useState("");
  const [editId,         setEditId]         = useState(null);

  // ── Auth state listener ───────────────────────────────────────────────────
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
    });
    return () => unsub();
  }, []);

  // ── Per-user Firestore listener ───────────────────────────────────────────
  // KEY FIX: path is users/{uid}/transactions — completely isolated per user
  useEffect(() => {
  if (!user) {
    // Use a microtask to avoid synchronous setState inside effect body
    const timer = setTimeout(() => {
      setTransactions([]);
      setLoading(false);
    }, 0);
    return () => clearTimeout(timer);
  }

  const q = query(
    collection(db, 'users', user.uid, 'transactions'),
    orderBy('createdAt', 'desc')
  );
  const unsub = onSnapshot(q,
    (snap) => {
      setTransactions(snap.docs.map(d => ({ firestoreId: d.id, ...d.data() })));
      setLoading(false);
      setFbError("");
    },
    (err) => {
      setFbError("⚠️ Firebase error: " + err.message);
      setLoading(false);
    }
  );
  return () => unsub();
}, [user]);

  // ── Auth actions ──────────────────────────────────────────────────────────
  const handleLogin = async () => {
    setAuthError("");
    try { await signInWithPopup(auth, provider); }
    catch (err) { setAuthError("Sign-in failed: " + err.message); }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setTransactions([]);
  };

  // ── Derived totals ────────────────────────────────────────────────────────
  const totalIncome   = transactions.filter(t => t.type === "income") .reduce((s, t) => s + t.amount, 0);
  const totalExpenses = transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0);
  const balance       = totalIncome - totalExpenses;

  // ── Filter + Sort ─────────────────────────────────────────────────────────
  let filtered = [...transactions];
  if (filterType !== "all")     filtered = filtered.filter(t => t.type === filterType);
  if (filterCategory !== "all") filtered = filtered.filter(t => t.category === filterCategory);
  filtered.sort((a, b) => {
    if (sortBy === "date-desc")   return new Date(b.date)   - new Date(a.date);
    if (sortBy === "date-asc")    return new Date(a.date)   - new Date(b.date);
    if (sortBy === "amount-desc") return b.amount - a.amount;
    if (sortBy === "amount-asc")  return a.amount - b.amount;
    return 0;
  });

  // ── CRUD — all paths go under users/{uid}/transactions ───────────────────
  const userCol = () => collection(db, 'users', user.uid, 'transactions');
  const userDoc = (id) => doc(db, 'users', user.uid, 'transactions', id);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) { setFormError("Description is required."); return; }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setFormError("Please enter a valid positive amount."); return;
    }
    setFormError(""); setSaving(true);
    try {
      if (editId) {
        await updateDoc(userDoc(editId), {
          description: description.trim(), amount: parseFloat(amount), type, category,
        });
        setEditId(null);
      } else {
        await addDoc(userCol(), {
          description: description.trim(),
          amount:      parseFloat(amount),
          type, category,
          date:      new Date().toISOString().split('T')[0],
          createdAt: Date.now(),
        });
      }
      setDescription(""); setAmount(""); setType("expense"); setCategory("food");
    } catch (err) { setFormError("Firebase error: " + err.message); }
    setSaving(false);
  };

  const handleEdit = (t) => {
    setEditId(t.firestoreId);
    setDescription(t.description); setAmount(String(t.amount));
    setType(t.type); setCategory(t.category);
    setFormError("");
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (firestoreId) => {
    if (!window.confirm("Delete this transaction?")) return;
    try { await deleteDoc(userDoc(firestoreId)); }
    catch (err) { alert("Delete failed: " + err.message); }
    if (editId === firestoreId) {
      setEditId(null); setDescription(""); setAmount(""); setType("expense"); setCategory("food");
    }
  };

  const handleCancelEdit = () => {
    setEditId(null); setDescription(""); setAmount(""); setType("expense"); setCategory("food"); setFormError("");
  };

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  const shareToWhatsApp = (period) => {
    window.open(`https://wa.me/?text=${encodeURIComponent(buildWhatsAppMessage(period, transactions))}`, '_blank');
  };

  // ── Category breakdown ────────────────────────────────────────────────────
  const categoryTotals = CATEGORIES
    .map(cat => ({ cat, total: transactions.filter(t => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amount, 0) }))
    .filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // ── Render: loading / login / app ─────────────────────────────────────────
  if (authLoading) {
    return <div className="full-center"><p>Loading...</p></div>;
  }

  if (!user) {
    return <LoginScreen onLogin={handleLogin} error={authError} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Finance Tracker</h1>
          <p className="subtitle">Track your income and expenses · Powered by Firebase</p>
        </div>
        <div className="header-right">
          <div className="whatsapp-group">
            <span className="wa-label">📲 Share:</span>
            <button className="wa-btn" onClick={() => shareToWhatsApp('daily')}>Daily</button>
            <button className="wa-btn" onClick={() => shareToWhatsApp('weekly')}>Weekly</button>
            <button className="wa-btn" onClick={() => shareToWhatsApp('monthly')}>Monthly</button>
          </div>
          <div className="user-info">
            <img src={user.photoURL} alt={user.displayName} className="user-avatar" referrerPolicy="no-referrer" />
            <span className="user-name">{user.displayName?.split(' ')[0]}</span>
            <button className="logout-btn" onClick={handleLogout}>Sign out</button>
          </div>
        </div>
      </header>

      {fbError && <div className="fb-error">{fbError}</div>}

      {/* Summary */}
      <div className="summary">
        <div className="summary-card">
          <h3>Total Income</h3>
          <p className="income-amount">{fmt(totalIncome)}</p>
        </div>
        <div className="summary-card">
          <h3>Total Expenses</h3>
          <p className="expense-amount">{fmt(totalExpenses)}</p>
        </div>
        <div className="summary-card">
          <h3>Balance</h3>
          <p className={`balance-amount ${balance >= 0 ? 'positive' : 'negative'}`}>{fmt(balance)}</p>
        </div>
      </div>

      {/* Breakdown */}
      {categoryTotals.length > 0 && (
        <div className="breakdown-section">
          <h2>Spending Breakdown</h2>
          <div className="breakdown-bars">
            {categoryTotals.map(({ cat, total }) => (
              <div key={cat} className="breakdown-row">
                <span className="breakdown-label">{cat}</span>
                <div className="breakdown-bar-wrap">
                  <div className="breakdown-bar" style={{ width: `${Math.min(100, (total / totalExpenses) * 100)}%` }} />
                </div>
                <span className="breakdown-val">{fmt(total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Form */}
      <div className="add-transaction">
        <h2>{editId ? '✏️ Edit Transaction' : 'Add Transaction'}</h2>
        <form onSubmit={handleSubmit}>
          <input type="text"   placeholder="Description" value={description} onChange={(e) => { setDescription(e.target.value); setFormError(""); }} />
          <input type="number" placeholder="Amount" min="0.01" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setFormError(""); }} />
          <select value={type}     onChange={(e) => setType(e.target.value)}>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <button type="submit" disabled={saving}>{saving ? 'Saving...' : editId ? 'Update' : 'Add'}</button>
          {editId && <button type="button" className="cancel-btn" onClick={handleCancelEdit}>Cancel</button>}
        </form>
        {formError && <p className="form-error">{formError}</p>}
      </div>

      {/* Transactions */}
      <div className="transactions">
        <h2>Transactions</h2>
        <div className="filters">
          <select value={filterType}     onChange={(e) => setFilterType(e.target.value)}>
            <option value="all">All Types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </select>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
            <option value="all">All Categories</option>
            {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-desc">Highest Amount</option>
            <option value="amount-asc">Lowest Amount</option>
          </select>
        </div>

        {loading ? (
          <div className="empty-state"><p>⏳ Loading your transactions...</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><p>No transactions found. Add your first one above!</p></div>
        ) : (
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.firestoreId} className={editId === t.firestoreId ? 'editing-row' : ''}>
                  <td>{t.date}</td>
                  <td>{t.description}</td>
                  <td><span className="category-badge">{t.category}</span></td>
                  <td className={t.type === "income" ? "income-amount" : "expense-amount"}>
                    {t.type === "income" ? "+" : "-"}{fmt(t.amount)}
                  </td>
                  <td className="action-cell">
                    <button className="edit-btn"   onClick={() => handleEdit(t)}>Edit</button>
                    <button className="delete-btn" onClick={() => handleDelete(t.firestoreId)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default App