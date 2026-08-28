# The Fun List

A personal wishlist/priority tracker: keep every "thing I want to buy or invest in"
in one place, rank them by priority, and see your top 3 at a glance.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

Leave the terminal window open while you use the app — it's running a small local
server. Close the terminal (or `Ctrl+C`) to stop it; run `npm start` again anytime
to bring it back up.

## Where your data lives

Everything is stored in a real SQLite database file at `data/funlist.db`. That one
file *is* your data — back it up by copying it, and it'll be right there next
time you start the app. Nothing is sent anywhere over the network.

## Using it

- **Home** shows your top 3 items by priority, with price and a running total.
- **My List** is where you manage everything:
  - **+ Add Item** to create a new item (name, price, category, notes).
  - Drag the `⠿` handle to reorder items — top of the list = highest priority,
    and that's what feeds the Home page's top 3.
  - ✎ to edit, 🗑 to delete (with a confirmation), ✓ to mark something as
    purchased (it moves to the collapsed "Purchased" section at the bottom;
    ↺ brings it back).
  - Search and filter by category from the toolbar.
- The 🌙/☀️ button in the header toggles light/dark mode (remembered per browser).

## Tech notes

Plain Node.js + Express backend with Node's built-in `node:sqlite` module (no
native compilation needed), and a dependency-free HTML/CSS/JS frontend. You'll
see an "ExperimentalWarning: SQLite is an experimental feature" line in the
terminal on startup — that's expected and harmless (Node's SQLite support is
new but stable enough for this).
