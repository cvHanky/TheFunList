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
  - **Add Item** to create a new item (name, price, category, notes). Category is
    picked from a dropdown of categories you've defined.
  - **Manage Categories** (in the toolbar, or from inside the Add/Edit Item form)
    opens simple add/rename/delete controls for your category list. Categories are
    case-insensitive and unique — you can't end up with both "Tech" and "tech".
    Deleting a category doesn't delete its items; they just become uncategorized.
  - Drag the grip handle to reorder items — top of the list = highest priority,
    and that's what feeds the Home page's top 3.
  - "Edit"/"Delete" per item (delete asks for confirmation), and the check mark
    moves something to the collapsed "Purchased / Acquired" section at the bottom
    (the restore arrow brings it back).
  - Search and filter by category from the toolbar.
- The button in the header toggles light/dark mode (remembered per browser).
- **Prices are always entered and stored in DKK.** The DKK/EUR/USD switch in the
  header only changes how prices are *displayed* — everywhere (Home, stats, My
  List) — using conversion rates you control via the "Rates" button. EUR/DKK
  defaults to Denmark's long-standing near-fixed peg (~7.46); USD/DKK defaults to
  an approximate market rate that will drift over time, so update it there
  whenever you want a fresher figure.

## Tech notes

Plain Node.js + Express backend with Node's built-in `node:sqlite` module (no
native compilation needed), and a dependency-free HTML/CSS/JS frontend. You'll
see an "ExperimentalWarning: SQLite is an experimental feature" line in the
terminal on startup — that's expected and harmless (Node's SQLite support is
new but stable enough for this).

Older databases created before categories became their own table are migrated
automatically the first time the server starts against them: any free-text
category values are folded into proper category records (case-insensitive
duplicates merged, first-seen casing kept), with every item's data preserved.

## Running behind a reverse proxy at a path prefix

By default the app assumes it's served from the root of its own origin (as it is
with plain `npm start`). To mount it at a path prefix instead (e.g. `/funlist` on
some other app's origin, with the proxy stripping that prefix before forwarding
to Express — so `server.js` itself needs no changes and stays unaware of the
prefix), set the base path the frontend uses for its API calls in
[public/index.html](public/index.html), just before the `app.js` script tag:

```html
<script>window.FUNLIST_BASE_PATH = '/funlist';</script>
```

Leave it as `''` for standalone use. `public/styles.css` and `public/app.js` are
already referenced with relative paths, so they resolve correctly at any mount
path with no changes — this is the only setting that needs to change. Whatever
serves the app at that prefix needs to be reachable with a trailing slash
(`/funlist/`, not `/funlist`) for that relative resolution to work.
