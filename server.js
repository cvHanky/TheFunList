import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---------- Database setup ----------
const db = new DatabaseSync(path.join(__dirname, 'data', 'funlist.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL,
    category TEXT,
    notes TEXT,
    purchased INTEGER NOT NULL DEFAULT 0,
    rank INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function nextRank() {
  const row = db.prepare('SELECT COALESCE(MAX(rank), 0) AS m FROM items').get();
  return row.m + 1;
}

// ---------- App setup ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET all items, ordered by rank (active first, purchased at the end grouped by purchase order)
app.get('/api/items', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM items ORDER BY purchased ASC, rank ASC'
  ).all();
  res.json(rows.map(toClient));
});

// GET top N by rank among non-purchased items
app.get('/api/items/top', (req, res) => {
  const n = Math.max(1, Math.min(20, parseInt(req.query.n, 10) || 3));
  const rows = db.prepare(
    'SELECT * FROM items WHERE purchased = 0 ORDER BY rank ASC LIMIT ?'
  ).all(n);
  res.json(rows.map(toClient));
});

// GET aggregate stats
app.get('/api/stats', (req, res) => {
  const active = db.prepare(
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total FROM items WHERE purchased = 0'
  ).get();
  const purchased = db.prepare(
    'SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total FROM items WHERE purchased = 1'
  ).get();
  res.json({
    activeCount: active.cnt,
    activeTotal: active.total,
    purchasedCount: purchased.cnt,
    purchasedTotal: purchased.total,
  });
});

// CREATE
app.post('/api/items', (req, res) => {
  const { name, price, category, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const rank = nextRank();
  const stmt = db.prepare(
    `INSERT INTO items (name, price, category, notes, purchased, rank)
     VALUES (?, ?, ?, ?, 0, ?)`
  );
  const info = stmt.run(
    String(name).trim(),
    price === '' || price === undefined || price === null ? null : Number(price),
    category ? String(category).trim() : null,
    notes ? String(notes).trim() : null,
    rank
  );
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toClient(row));
});

// REORDER (drag and drop) - body: { orderedIds: [id, id, id, ...] } for active items
// NOTE: this must be registered before PUT /api/items/:id, otherwise Express
// matches "reorder" as the :id param and this route is never reached.
app.put('/api/items/reorder', (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds)) {
    return res.status(400).json({ error: 'orderedIds must be an array.' });
  }
  const update = db.prepare('UPDATE items SET rank = ? WHERE id = ?');
  orderedIds.forEach((id, index) => {
    update.run(index + 1, Number(id));
  });
  const rows = db.prepare('SELECT * FROM items ORDER BY purchased ASC, rank ASC').all();
  res.json(rows.map(toClient));
});

// UPDATE (name/price/category/notes)
app.put('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  const { name, price, category, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  db.prepare(
    `UPDATE items SET name = ?, price = ?, category = ?, notes = ? WHERE id = ?`
  ).run(
    String(name).trim(),
    price === '' || price === undefined || price === null ? null : Number(price),
    category ? String(category).trim() : null,
    notes ? String(notes).trim() : null,
    id
  );
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  res.json(toClient(row));
});

// TOGGLE purchased
app.patch('/api/items/:id/purchased', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  const purchased = req.body?.purchased ? 1 : 0;
  let rank = existing.rank;
  if (!purchased) {
    // returning to the active list -> put it at the bottom of the priority order
    rank = nextRank();
  }
  db.prepare('UPDATE items SET purchased = ?, rank = ? WHERE id = ?').run(purchased, rank, id);
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  res.json(toClient(row));
});

// DELETE
app.delete('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  res.status(204).end();
});

function toClient(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price === null ? null : row.price,
    category: row.category,
    notes: row.notes,
    purchased: !!row.purchased,
    rank: row.rank,
    createdAt: row.created_at,
  };
}

app.listen(PORT, () => {
  console.log(`The Fun List is running at http://localhost:${PORT}`);
});
