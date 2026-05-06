import { useState, useEffect } from 'react'
import './App.css'
import { db } from './firebase'
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

// ── WhatsApp report builder ────────────────────────────────────────────────
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
    .filter(c => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .map(c => `  • ${c.cat}: ₹${c.total.toFixed(2)}`)
    .join('\n');

  return `💰 *Finance Tracker – ${label} Report*
📅 ${start.toLocaleDateString('en-IN')} → ${new Date().toLocaleDateString('en-IN')}

✅ Income:   ₹${income.toFixed(2)}
❌ Expenses: ₹${expenses.toFixed(2)}
📊 Balance:  ₹${balance.toFixed(2)}

🧾 *Expense Breakdown:*
${breakdown || '  No expenses in this period.'}

_Sent from Finance Tracker_`;
}

// ── App ────────────────────────────────────────────────────────────────────
function App() {
  const [transactions, setTransactions] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [fbError,  setFbError]  = useState("");
  const [saving,   setSaving]   = useState(false);

  const [description, setDescription] = useState("");
  const [amount,      setAmount]      = useState("");
  const [type,        setType]        = useState("expense");
  const [category,    setCategory]    = useState("food");

  const [filterType,     setFilterType]     = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [sortBy,         setSortBy]         = useState("date-desc");
  const [formError,      setFormError]      = useState("");
  const [editId,         setEditId]         = useState(null);

  // ── Firestore real-time listener ─────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'transactions'), orderBy('createdAt', 'desc'));
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
  }, []);

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

  // ── Add / Update ──────────────────────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!description.trim()) { setFormError("Description is required."); return; }
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      setFormError("Please enter a valid positive amount."); return;
    }
    setFormError(""); setSaving(true);
    try {
      if (editId) {
        await updateDoc(doc(db, 'transactions', editId), {
          description: description.trim(), amount: parseFloat(amount), type, category,
        });
        setEditId(null);
      } else {
        await addDoc(collection(db, 'transactions'), {
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
    try { await deleteDoc(doc(db, 'transactions', firestoreId)); }
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
    const msg = buildWhatsAppMessage(period, transactions);
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
  };

  // ── Category breakdown ────────────────────────────────────────────────────
  const categoryTotals = CATEGORIES
    .map(cat => ({ cat, total: transactions.filter(t => t.type === "expense" && t.category === cat).reduce((s, t) => s + t.amount, 0) }))
    .filter(c => c.total > 0).sort((a, b) => b.total - a.total);

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Finance Tracker</h1>
          <p className="subtitle">Track your income and expenses · Powered by Firebase</p>
        </div>
        <div className="whatsapp-group">
          <span className="wa-label">📲 Share:</span>
          <button className="wa-btn" onClick={() => shareToWhatsApp('daily')}>Daily</button>
          <button className="wa-btn" onClick={() => shareToWhatsApp('weekly')}>Weekly</button>
          <button className="wa-btn" onClick={() => shareToWhatsApp('monthly')}>Monthly</button>
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
          <div className="empty-state"><p>⏳ Loading from Firebase...</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state"><p>No transactions found for the selected filters.</p></div>
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