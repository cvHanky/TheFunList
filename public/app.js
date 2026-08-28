(() => {
  'use strict';

  const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const fmtPrice = (p) => (p === null || p === undefined || p === '' ? '—' : currency.format(p));

  // ---------- State ----------
  let allItems = [];
  let currentView = 'home';
  let dragSourceId = null;
  let pendingDeleteId = null;

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const tabs = document.querySelectorAll('.tab');
  const viewHome = $('#view-home');
  const viewList = $('#view-list');
  const top3Grid = $('#top3-grid');
  const statsBar = $('#stats-bar');
  const activeListEl = $('#active-list');
  const purchasedListEl = $('#purchased-list');
  const purchasedToggle = $('#purchased-toggle');
  const purchasedCaret = $('#purchased-caret');
  const purchasedCount = $('#purchased-count');
  const searchInput = $('#search-input');
  const categoryFilter = $('#category-filter');
  const categorySuggestions = $('#category-suggestions');

  const modalOverlay = $('#modal-overlay');
  const modalTitle = $('#modal-title');
  const itemForm = $('#item-form');
  const fieldId = $('#item-id');
  const fieldName = $('#field-name');
  const fieldPrice = $('#field-price');
  const fieldCategory = $('#field-category');
  const fieldNotes = $('#field-notes');
  const formError = $('#form-error');

  const confirmOverlay = $('#confirm-overlay');
  const confirmText = $('#confirm-text');

  const toastEl = $('#toast');
  let toastTimer = null;

  // ---------- API ----------
  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      let msg = `Request failed (${res.status})`;
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function loadItems() {
    allItems = await api('/api/items');
  }

  // ---------- Toast ----------
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
  }

  // ---------- View switching ----------
  function setView(view) {
    currentView = view;
    tabs.forEach((t) => {
      const active = t.dataset.view === view;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', String(active));
    });
    viewHome.classList.toggle('hidden', view !== 'home');
    viewList.classList.toggle('hidden', view !== 'list');
    render();
  }

  tabs.forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));

  // ---------- Theme ----------
  const themeToggle = $('#theme-toggle');
  function applyTheme(theme) {
    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      themeToggle.textContent = '☀️';
    } else {
      document.documentElement.removeAttribute('data-theme');
      themeToggle.textContent = '🌙';
    }
  }
  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem('funlist-theme'); } catch (_) {}
    if (!saved) {
      saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    applyTheme(saved);
  }
  themeToggle.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    const next = isLight ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('funlist-theme', next); } catch (_) {}
  });

  // ---------- Rendering: Home ----------
  function renderHome() {
    const active = allItems.filter((i) => !i.purchased).sort((a, b) => a.rank - b.rank);
    const top3 = active.slice(0, 3);

    top3Grid.innerHTML = '';

    if (allItems.length === 0) {
      top3Grid.innerHTML = `
        <div class="empty-state">
          <div class="big">🎯</div>
          <p>Your Fun List is empty. Add something you've been wanting!</p>
        </div>`;
    } else {
      for (let i = 0; i < 3; i++) {
        const item = top3[i];
        const rankNum = i + 1;
        if (item) {
          const card = document.createElement('div');
          card.className = `top3-card glass rank-${rankNum}`;
          card.innerHTML = `
            <div class="rank-badge">#${rankNum}</div>
            ${item.category ? `<span class="item-category">${escapeHtml(item.category)}</span>` : '<span></span>'}
            <div class="item-name">${escapeHtml(item.name)}</div>
            <div class="item-price">${fmtPrice(item.price)}</div>
            ${item.notes ? `<div class="item-notes">${escapeHtml(item.notes)}</div>` : ''}
          `;
          top3Grid.appendChild(card);
        } else {
          const empty = document.createElement('div');
          empty.className = `top3-empty rank-${rankNum}`;
          empty.textContent = `Slot #${rankNum} is open — add another item!`;
          top3Grid.appendChild(empty);
        }
      }
    }

    const activeTotal = active.reduce((sum, i) => sum + (i.price || 0), 0);
    const top3Total = top3.reduce((sum, i) => sum + (i.price || 0), 0);
    const purchasedItems = allItems.filter((i) => i.purchased);

    statsBar.innerHTML = `
      <div class="stat">
        <span class="stat-value">${active.length}</span>
        <span class="stat-label">Active items</span>
      </div>
      <div class="stat">
        <span class="stat-value">${currency.format(activeTotal)}</span>
        <span class="stat-label">Total wishlist cost</span>
      </div>
      <div class="stat">
        <span class="stat-value">${currency.format(top3Total)}</span>
        <span class="stat-label">Top 3 combined</span>
      </div>
      <div class="stat">
        <span class="stat-value">${purchasedItems.length}</span>
        <span class="stat-label">Purchased</span>
      </div>
    `;
  }

  // ---------- Rendering: List ----------
  function populateCategoryFilter() {
    const cats = Array.from(new Set(allItems.map((i) => i.category).filter(Boolean))).sort();
    const currentVal = categoryFilter.value;
    categoryFilter.innerHTML = '<option value="">All categories</option>' +
      cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    if (cats.includes(currentVal)) categoryFilter.value = currentVal;

    categorySuggestions.innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
  }

  function matchesFilters(item) {
    const q = searchInput.value.trim().toLowerCase();
    const cat = categoryFilter.value;
    if (cat && item.category !== cat) return false;
    if (q) {
      const hay = `${item.name} ${item.notes || ''} ${item.category || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function renderList() {
    populateCategoryFilter();

    const active = allItems
      .filter((i) => !i.purchased)
      .sort((a, b) => a.rank - b.rank)
      .filter(matchesFilters);
    const purchased = allItems
      .filter((i) => i.purchased)
      .filter(matchesFilters);

    activeListEl.innerHTML = '';
    if (active.length === 0) {
      activeListEl.innerHTML = `<div class="empty-state"><div class="big">🗒️</div><p>Nothing here yet. Click "+ Add Item" to start your list.</p></div>`;
    } else {
      active.forEach((item, idx) => activeListEl.appendChild(buildRow(item, idx + 1, true)));
    }

    purchasedCount.textContent = purchased.length;
    purchasedListEl.innerHTML = '';
    purchased.forEach((item) => purchasedListEl.appendChild(buildRow(item, null, false)));
  }

  function buildRow(item, rankNum, draggable) {
    const row = document.createElement('div');
    row.className = `item-row glass${item.purchased ? ' purchased' : ''}`;
    row.dataset.id = item.id;
    row.draggable = draggable;

    row.innerHTML = `
      ${draggable ? '<span class="drag-handle" title="Drag to reorder">⠿</span>' : '<span class="drag-handle" style="visibility:hidden">⠿</span>'}
      ${rankNum !== null ? `<span class="item-rank">#${rankNum}</span>` : '<span class="item-rank">✓</span>'}
      <div class="item-main">
        <div class="item-title-row">
          <span class="item-name${item.purchased ? ' strike' : ''}">${escapeHtml(item.name)}</span>
          ${item.category ? `<span class="item-category">${escapeHtml(item.category)}</span>` : ''}
        </div>
        ${item.notes ? `<span class="item-notes-line">${escapeHtml(item.notes)}</span>` : ''}
      </div>
      <span class="item-price">${fmtPrice(item.price)}</span>
      <div class="item-actions">
        <button class="btn-check${item.purchased ? ' checked' : ''}" title="${item.purchased ? 'Move back to active list' : 'Mark as purchased'}">${item.purchased ? '↺' : '✓'}</button>
        <button class="btn-edit" title="Edit">✎</button>
        <button class="btn-delete" title="Delete">🗑</button>
      </div>
    `;

    row.querySelector('.btn-check').addEventListener('click', () => togglePurchased(item));
    row.querySelector('.btn-edit').addEventListener('click', () => openModal(item));
    row.querySelector('.btn-delete').addEventListener('click', () => openConfirm(item));

    if (draggable) {
      row.addEventListener('dragstart', () => {
        dragSourceId = item.id;
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        document.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
      });
      row.addEventListener('dragover', (e) => {
        e.preventDefault();
        row.classList.add('drag-over');
      });
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
      row.addEventListener('drop', (e) => {
        e.preventDefault();
        row.classList.remove('drag-over');
        if (dragSourceId !== null && dragSourceId !== item.id) {
          reorderByDrop(dragSourceId, item.id);
        }
      });
    }

    return row;
  }

  async function reorderByDrop(sourceId, targetId) {
    const active = allItems.filter((i) => !i.purchased).sort((a, b) => a.rank - b.rank);
    const fromIdx = active.findIndex((i) => i.id === sourceId);
    const toIdx = active.findIndex((i) => i.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = active.splice(fromIdx, 1);
    active.splice(toIdx, 0, moved);
    const orderedIds = active.map((i) => i.id);

    // optimistic re-render
    orderedIds.forEach((id, idx) => {
      const item = allItems.find((i) => i.id === id);
      if (item) item.rank = idx + 1;
    });
    renderList();

    try {
      allItems = await api('/api/items/reorder', {
        method: 'PUT',
        body: JSON.stringify({ orderedIds }),
      });
      render();
    } catch (err) {
      toast('Could not save new order: ' + err.message);
      await refresh();
    }
  }

  // ---------- Purchased toggle section ----------
  purchasedToggle.addEventListener('click', () => {
    const isHidden = purchasedListEl.classList.toggle('hidden');
    purchasedCaret.classList.toggle('open', !isHidden);
  });

  async function togglePurchased(item) {
    try {
      await api(`/api/items/${item.id}/purchased`, {
        method: 'PATCH',
        body: JSON.stringify({ purchased: !item.purchased }),
      });
      toast(item.purchased ? `Moved "${item.name}" back to your active list` : `Nice! "${item.name}" marked as purchased 🎉`);
      await refresh();
    } catch (err) {
      toast('Error: ' + err.message);
    }
  }

  // ---------- Search / filter ----------
  searchInput.addEventListener('input', renderList);
  categoryFilter.addEventListener('change', renderList);

  // ---------- Add / Edit modal ----------
  const addItemBtn = $('#add-item-btn');
  const modalCancel = $('#modal-cancel');

  function openModal(item) {
    formError.classList.add('hidden');
    itemForm.reset();
    if (item) {
      modalTitle.textContent = 'Edit Item';
      fieldId.value = item.id;
      fieldName.value = item.name;
      fieldPrice.value = item.price ?? '';
      fieldCategory.value = item.category ?? '';
      fieldNotes.value = item.notes ?? '';
    } else {
      modalTitle.textContent = 'Add Item';
      fieldId.value = '';
    }
    modalOverlay.classList.remove('hidden');
    setTimeout(() => fieldName.focus(), 50);
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
  }

  addItemBtn.addEventListener('click', () => openModal(null));
  modalCancel.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  itemForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError.classList.add('hidden');

    const payload = {
      name: fieldName.value.trim(),
      price: fieldPrice.value === '' ? null : Number(fieldPrice.value),
      category: fieldCategory.value.trim() || null,
      notes: fieldNotes.value.trim() || null,
    };
    if (!payload.name) {
      formError.textContent = 'Name is required.';
      formError.classList.remove('hidden');
      return;
    }

    const id = fieldId.value;
    try {
      if (id) {
        await api(`/api/items/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast(`Updated "${payload.name}"`);
      } else {
        await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
        toast(`Added "${payload.name}" to your list`);
      }
      closeModal();
      await refresh();
    } catch (err) {
      formError.textContent = err.message;
      formError.classList.remove('hidden');
    }
  });

  // ---------- Delete confirm ----------
  const confirmCancel = $('#confirm-cancel');
  const confirmDelete = $('#confirm-delete');

  function openConfirm(item) {
    pendingDeleteId = item.id;
    confirmText.textContent = `"${item.name}" will be permanently removed from your list.`;
    confirmOverlay.classList.remove('hidden');
  }
  function closeConfirm() {
    confirmOverlay.classList.add('hidden');
    pendingDeleteId = null;
  }
  confirmCancel.addEventListener('click', closeConfirm);
  confirmOverlay.addEventListener('click', (e) => {
    if (e.target === confirmOverlay) closeConfirm();
  });
  confirmDelete.addEventListener('click', async () => {
    if (pendingDeleteId === null) return;
    try {
      await api(`/api/items/${pendingDeleteId}`, { method: 'DELETE' });
      toast('Item deleted');
      closeConfirm();
      await refresh();
    } catch (err) {
      toast('Error: ' + err.message);
      closeConfirm();
    }
  });

  // ---------- Keyboard ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalOverlay.classList.contains('hidden')) closeModal();
      if (!confirmOverlay.classList.contains('hidden')) closeConfirm();
    }
  });

  // ---------- Helpers ----------
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function render() {
    if (currentView === 'home') renderHome();
    else renderList();
  }

  async function refresh() {
    await loadItems();
    render();
  }

  // ---------- Init ----------
  initTheme();
  refresh().catch((err) => toast('Failed to load: ' + err.message));
})();
