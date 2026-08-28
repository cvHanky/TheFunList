import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ---------- Database setup ----------
const db = new DatabaseSync(path.join(__dirname, 'data', 'funlist.db'));
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
`);

migrateItemsTable();

/**
 * Ensures the `items` table exists with a `category_id` foreign key into
 * `categories`. Older databases stored category as a free-text `category`
 * column, which allowed inconsistent casing (e.g. "Tech" and "tech" as two
 * separate values). This migrates any such database in place, folding
 * case-insensitive duplicates into a single category (first-seen casing
 * wins) while preserving every item's id and other fields. Safe to run on
 * every startup — it's a no-op once the new schema is in place.
 */
function migrateItemsTable() {
  const itemsInfo = db.prepare('PRAGMA table_info(items)').all();
  const tableExists = itemsInfo.length > 0;
  const hasOldCategoryColumn = itemsInfo.some((c) => c.name === 'category');
  const hasCategoryId = itemsInfo.some((c) => c.name === 'category_id');

  if (!tableExists) {
    db.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        notes TEXT,
        purchased INTEGER NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    return;
  }

  if (!hasOldCategoryColumn || hasCategoryId) return; // already migrated

  console.log('Migrating items table to use a proper categories table...');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE items RENAME TO items_old;');
    db.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        price REAL,
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        notes TEXT,
        purchased INTEGER NOT NULL DEFAULT 0,
        rank INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const oldRows = db.prepare('SELECT * FROM items_old ORDER BY id ASC').all();
    const cache = new Map(); // lowercase name -> category id
    const findOrCreateCategory = (rawName) => {
      const trimmed = String(rawName).trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      if (cache.has(key)) return cache.get(key);
      const existing = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(trimmed);
      const id = existing ? existing.id : db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed).lastInsertRowid;
      cache.set(key, id);
      return id;
    };

    const insertItem = db.prepare(`
      INSERT INTO items (id, name, price, category_id, notes, purchased, rank, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of oldRows) {
      const categoryId = row.category ? findOrCreateCategory(row.category) : null;
      insertItem.run(row.id, row.name, row.price, categoryId, row.notes, row.purchased, row.rank, row.created_at);
    }

    db.exec('DROP TABLE items_old;');
    db.exec('COMMIT');
    console.log(`Migration complete (${cache.size} categor${cache.size === 1 ? 'y' : 'ies'}).`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function nextRank() {
  const row = db.prepare('SELECT COALESCE(MAX(rank), 0) AS m FROM items').get();
  return row.m + 1;
}

const ITEM_SELECT = `
  SELECT items.*, categories.name AS category_name
  FROM items
  LEFT JOIN categories ON categories.id = items.category_id
`;

function toClient(row) {
  return {
    id: row.id,
    name: row.name,
    price: row.price === null ? null : row.price,
    categoryId: row.category_id,
    categoryName: row.category_name || null,
    notes: row.notes,
    purchased: !!row.purchased,
    rank: row.rank,
    createdAt: row.created_at,
  };
}

function toCategoryClient(row) {
  return { id: row.id, name: row.name, itemCount: row.item_count };
}

// ---------- App setup ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===================== Categories =====================

app.get('/api/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT categories.*, COUNT(items.id) AS item_count
    FROM categories
    LEFT JOIN items ON items.category_id = categories.id
    GROUP BY categories.id
    ORDER BY categories.name COLLATE NOCASE ASC
  `).all();
  res.json(rows.map(toCategoryClient));
});

app.post('/api/categories', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required.' });

  const existing = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return res.status(409).json({ error: `Category "${name}" already exists.` });

  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
  const row = db.prepare('SELECT *, 0 AS item_count FROM categories WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toCategoryClient(row));
});

app.put('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });

  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Category name is required.' });

  const conflict = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND id != ?').get(name, id);
  if (conflict) return res.status(409).json({ error: `Category "${name}" already exists.` });

  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, id);
  const row = db.prepare(`
    SELECT categories.*, COUNT(items.id) AS item_count
    FROM categories LEFT JOIN items ON items.category_id = categories.id
    WHERE categories.id = ?
    GROUP BY categories.id
  `).get(id);
  res.json(toCategoryClient(row));
});

app.delete('/api/categories/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });

  // Items referencing this category fall back to uncategorized (ON DELETE SET NULL).
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  res.status(204).end();
});

// ===================== Items =====================

app.get('/api/items', (req, res) => {
  const rows = db.prepare(`${ITEM_SELECT} ORDER BY items.purchased ASC, items.rank ASC`).all();
  res.json(rows.map(toClient));
});

app.get('/api/items/top', (req, res) => {
  const n = Math.max(1, Math.min(20, parseInt(req.query.n, 10) || 3));
  const rows = db.prepare(`${ITEM_SELECT} WHERE items.purchased = 0 ORDER BY items.rank ASC LIMIT ?`).all(n);
  res.json(rows.map(toClient));
});

app.get('/api/stats', (req, res) => {
  const active = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total FROM items WHERE purchased = 0').get();
  const purchased = db.prepare('SELECT COUNT(*) AS cnt, COALESCE(SUM(price), 0) AS total FROM items WHERE purchased = 1').get();
  res.json({
    activeCount: active.cnt,
    activeTotal: active.total,
    purchasedCount: purchased.cnt,
    purchasedTotal: purchased.total,
  });
});

function resolveCategoryId(categoryId) {
  if (categoryId === undefined || categoryId === null || categoryId === '') return { ok: true, value: null };
  const id = Number(categoryId);
  if (!Number.isInteger(id)) return { ok: false };
  const exists = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
  if (!exists) return { ok: false };
  return { ok: true, value: id };
}

app.post('/api/items', (req, res) => {
  const { name, price, categoryId, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const category = resolveCategoryId(categoryId);
  if (!category.ok) return res.status(400).json({ error: 'That category no longer exists.' });

  const rank = nextRank();
  const info = db.prepare(`
    INSERT INTO items (name, price, category_id, notes, purchased, rank)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(
    String(name).trim(),
    price === '' || price === undefined || price === null ? null : Number(price),
    category.value,
    notes ? String(notes).trim() : null,
    rank
  );
  const row = db.prepare(`${ITEM_SELECT} WHERE items.id = ?`).get(info.lastInsertRowid);
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
  const rows = db.prepare(`${ITEM_SELECT} ORDER BY items.purchased ASC, items.rank ASC`).all();
  res.json(rows.map(toClient));
});

// UPDATE (name/price/category/notes)
app.put('/api/items/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Item not found.' });

  const { name, price, categoryId, notes } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const category = resolveCategoryId(categoryId);
  if (!category.ok) return res.status(400).json({ error: 'That category no longer exists.' });

  db.prepare(`
    UPDATE items SET name = ?, price = ?, category_id = ?, notes = ? WHERE id = ?
  `).run(
    String(name).trim(),
    price === '' || price === undefined || price === null ? null : Number(price),
    category.value,
    notes ? String(notes).trim() : null,
    id
  );
  const row = db.prepare(`${ITEM_SELECT} WHERE items.id = ?`).get(id);
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
  const row = db.prepare(`${ITEM_SELECT} WHERE items.id = ?`).get(id);
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

app.listen(PORT, () => {
  console.log(`The Fun List is running at http://localhost:${PORT}`);
});
