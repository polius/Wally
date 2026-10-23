(() => {
  const state = {
    range: { type: 'current', from: new Date(), to: new Date() },
    transactions: [],
    search: '',
    person: '',
    categories: new Set(),
    tags: new Set(),
    selectMode: false,
    selected: new Set(),
    inspectorId: null,
    pending: [],
    lastFocus: null,
  };

  const $ = (id) => document.getElementById(id);
  const composer = new W.Composer({ onSaved: () => load() });

  function rangeLabel(range) {
    if (range.type === 'all') return 'All time';
    if (range.type === 'custom') return `${W.monthLabel(range.from, true)} – ${W.monthLabel(range.to, true)}`;
    if (range.type === 'current') return W.monthLabel(range.to);
    if (range.type === 'ytd') return 'Year to date';
    return `Last ${range.type.replace('m', '')} months`;
  }

  function setMeta() {
    $('rangeLabel').textContent = rangeLabel(state.range);
    const sum = W.summarise(state.transactions);
    $('txSummary').innerHTML = state.transactions.length
      ? `<b>${state.transactions.length}</b> ${state.transactions.length === 1 ? 'transaction' : 'transactions'}
         <span class="sep">·</span><span>Net <b>${W.money(sum.net, { signed: true, plus: true })}</b></span>
         <span class="sep tx-extra">·</span><span class="in tx-extra">${W.money(sum.income)} in</span>
         <span class="sep tx-extra">·</span><span class="out tx-extra">${W.money(sum.expense)} out</span>`
      : 'No transactions in this range';
    document.title = `${rangeLabel(state.range)} · Wally`;
  }

  function filtered() {
    const term = state.search.trim().toLowerCase();
    return state.transactions.filter((t) => {
      if (state.person === 'shared') {
        if (t.person_id || !W.sharesFor(t).length) return false;
      } else if (state.person && t.person_id !== state.person) {
        return false;
      }
      if (state.categories.size && !state.categories.has(t.category)) return false;
      if (state.tags.size && !(t.tags || []).some((tag) => state.tags.has(tag))) return false;
      if (term) {
        const haystack = [
          t.name,
          t.category,
          ...(t.tags || []),
          W.personName(t.person_id) || (W.sharesFor(t).length ? 'shared' : ''),
          t.type,
          String(t.amount),
        ].join(' ').toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    }).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_date || '').localeCompare(String(a.created_date || '')));
  }

  function ownerMarkup(t) {
    if (t.person_id) {
      const person = W.state.people.find((p) => p.id === t.person_id);
      return `${W.avatar(person, 'tiny')}<span>${W.escapeHtml(person?.name || '—')}</span>`;
    }
    if (W.sharesFor(t).length) {
      return `${W.icon('people')}<span>Shared</span>`;
    }
    return `<span class="card-note">No owner</span>`;
  }

  function rowMarkup(t) {
    const selected = state.selected.has(t.id);
    const rec = t.recurringID ? `<span class="rec" title="Recurring">${W.icon('repeat')}</span>` : '';
    const tagText = (t.tags || []).length ? ` · ${t.tags.join(', ')}` : '';
    const amountText = W.money(t.amount, { signed: true, sign: t.type === 'income' ? '+' : '−' });
    const ownerCell = W.hasPeople() ? `<span class="tx-owner">${ownerMarkup(t)}</span>` : '';
    const spoken = [t.name || t.category, t.category, ...(t.tags || []), ...(W.hasPeople() ? [W.ownerLabel(t) || 'No owner'] : []), amountText].join(', ');
    return `<div class="tx-row ${selected ? 'sel' : ''}" data-id="${t.id}" tabindex="0" role="button" aria-label="Open ${W.escapeHtml(spoken)}">
      <button type="button" class="tx-cb ${selected ? 'on' : ''}" data-select="${t.id}" aria-label="${selected ? 'Deselect' : 'Select'} ${W.escapeHtml(t.name || t.category)}" aria-pressed="${selected}">${selected ? W.icon('check') : ''}</button>
      <span class="tx-ic">${W.categoryIcon(t.category)}</span>
      <span class="tx-name">
        <span class="tx-main">${W.escapeHtml(t.name || t.category)} ${rec}</span>
        <span class="tx-meta">${W.escapeHtml(t.category)}${W.escapeHtml(tagText)}${W.ownerLabel(t) ? ` · ${W.escapeHtml(W.ownerLabel(t))}` : ''}</span>
      </span>
      <span class="tx-cat-cell"><span class="tx-cat" style="--c:${W.categoryColor(t.category)}"><i></i>${W.escapeHtml(t.category)}</span></span>
      ${ownerCell}
      <span class="tx-amt ${t.type === 'income' ? 'in' : ''}">${amountText}</span>
      <button type="button" class="tx-more" data-more="${t.id}" aria-label="More about ${W.escapeHtml(t.name || t.category)}">${W.icon('more')}</button>
    </div>`;
  }

  function renderList() {
    const rows = filtered();
    const scroll = $('txScroll');
    if (!state.transactions.length) {
      scroll.innerHTML = `<div class="empty tx-empty">
        <span class="eic">${W.icon('transactions')}</span>
        <b>No transactions in this range</b>
        <span>Add one, or choose a wider range. The ledger only knows what you write in it.</span>
        <button type="button" class="btn primary sm" data-empty-add style="margin-top:8px">Add a transaction</button>
      </div>`;
    } else if (!rows.length) {
      scroll.innerHTML = `<div class="empty tx-empty">
        <span class="eic">${W.icon('search')}</span>
        <b>Nothing matches</b>
        <span>Try a shorter search, or clear the filters. The range still holds ${state.transactions.length} ${state.transactions.length === 1 ? 'entry' : 'entries'}.</span>
        <button type="button" class="btn ghost sm" data-clear-all style="margin-top:8px">Clear search and filters</button>
      </div>`;
    } else {
      const groups = W.groupByDay(rows);
      scroll.innerHTML = groups.map((group) => `
        <section class="tx-day" aria-label="${W.escapeHtml(W.dayLabel(group.date))}">
          <div class="tx-day-h">
            <b>${W.dayLabel(group.date)}${/^(Today|Yesterday)$/.test(W.dayLabel(group.date)) ? ` · ${W.shortDate(group.date)}` : ''}</b>
            <span class="net ${group.net >= 0 ? 'in' : ''}">${group.net === 0 ? '—' : W.money(group.net, { signed: true, sign: group.net > 0 ? '+' : '−' })}</span>
          </div>
          ${group.items.map(rowMarkup).join('')}
        </section>`).join('');
    }

    scroll.querySelectorAll('[data-id]').forEach((row) => {
      row.addEventListener('click', () => {
        if (state.selectMode) toggleSelected(row.dataset.id);
        else openInspector(row.dataset.id, row);
      });
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          if (state.selectMode) toggleSelected(row.dataset.id);
          else openInspector(row.dataset.id, row);
        }
      });
    });
    scroll.querySelectorAll('[data-select]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!state.selectMode) toggleSelectMode(true);
        toggleSelected(button.dataset.select);
      });
    });
    scroll.querySelectorAll('[data-more]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openInspector(button.dataset.more, button);
      });
    });
    scroll.querySelector('[data-empty-add]')?.addEventListener('click', () => composer.open());
    scroll.querySelector('[data-clear-all]')?.addEventListener('click', clearFilters);

    $('txFoot').hidden = !rows.length;
    $('txAllLabel').innerHTML = `Showing <b>${rows.length}</b> of ${state.transactions.length}`;
    renderBulk();
  }

  function toggleSelected(id) {
    if (state.selected.has(id)) state.selected.delete(id);
    else state.selected.add(id);
    if (!state.selected.size && state.selectMode) {
      // Selection mode stays on until Done; an empty selection is a valid state.
    }
    renderList();
  }

  function toggleSelectMode(force) {
    state.selectMode = typeof force === 'boolean' ? force : !state.selectMode;
    if (!state.selectMode) state.selected.clear();
    const button = $('selectToggle');
    button.querySelector('span').textContent = state.selectMode ? 'Done' : 'Select';
    button.setAttribute('aria-pressed', String(state.selectMode));
    button.setAttribute('aria-label', state.selectMode ? 'Finish selecting transactions' : 'Select transactions');
    button.classList.toggle('on', state.selectMode);
    $('txScroll').classList.toggle('selecting', state.selectMode);
    renderList();
  }

  function renderBulk() {
    const count = state.selected.size;
    $('bulkBar').hidden = !state.selectMode;
    $('bulkCount').textContent = `${count} selected`;
    $('bulkExport').disabled = count === 0;
    $('bulkDelete').disabled = count === 0;
    $('bulkExport').style.opacity = count ? '1' : '.4';
    $('bulkDelete').style.opacity = count ? '1' : '.4';
  }

  function filterCount() {
    return (state.person ? 1 : 0) + state.categories.size + state.tags.size;
  }

  function updateFilterButton() {
    const count = filterCount();
    $('filterCount').hidden = count === 0;
    $('filterCount').textContent = String(count);
    $('filterButton').classList.toggle('on', count > 0);
  }

  function clearFilters() {
    state.search = '';
    state.person = '';
    state.categories.clear();
    state.tags.clear();
    $('searchInput').value = '';
    updateFilterButton();
    renderList();
  }

  function rangeCounts() {
    const people = new Map();
    const categories = new Map();
    const tags = new Map();
    for (const t of state.transactions) {
      if (t.person_id) people.set(t.person_id, (people.get(t.person_id) || 0) + 1);
      else if (W.sharesFor(t).length) people.set('shared', (people.get('shared') || 0) + 1);
      categories.set(t.category, (categories.get(t.category) || 0) + 1);
      for (const tag of t.tags || []) tags.set(tag, (tags.get(tag) || 0) + 1);
    }
    return { people, categories, tags };
  }

  let filterPop = null;
  function openFilter(anchor) {
    closeFilter();
    const counts = rangeCounts();
    const pop = document.createElement('div');
    pop.className = 'filter-pop';
    const personOptions = [
      `<button type="button" class="facet-opt ${!state.person ? 'on' : ''}" data-person="" aria-pressed="${!state.person}">Everyone</button>`,
      ...W.state.people.map((p) => `<button type="button" class="facet-opt ${state.person === p.id ? 'on' : ''}" data-person="${p.id}" aria-pressed="${state.person === p.id}">${W.escapeHtml(p.name)}<span class="cnt">${counts.people.get(p.id) || 0}</span></button>`),
      `<button type="button" class="facet-opt ${state.person === 'shared' ? 'on' : ''}" data-person="shared" aria-pressed="${state.person === 'shared'}">Shared<span class="cnt">${counts.people.get('shared') || 0}</span></button>`,
    ].join('');

    const cats = [...counts.categories.entries()].sort((a, b) => b[1] - a[1]);
    const tagList = [...counts.tags.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    pop.innerHTML = `
      <div class="range-head"><b>Filter</b><button type="button" class="icon-btn small filter-close" aria-label="Close">${W.icon('close')}</button></div>
      ${W.hasPeople() ? `<div class="facet"><div class="facet-h"><span>People</span></div><div class="facet-options">${personOptions}</div></div>` : ''}
      <div class="facet"><div class="facet-h"><span>Category</span><span>${state.categories.size || ''}</span></div><div class="facet-options">${cats.map(([name, count]) => `<button type="button" class="facet-opt ${state.categories.has(name) ? 'on' : ''}" data-cat="${W.escapeHtml(name)}" aria-pressed="${state.categories.has(name)}">${W.escapeHtml(name)}<span class="cnt">${count}</span></button>`).join('') || '<span class="card-note">No categories yet.</span>'}</div></div>
      <div class="facet"><div class="facet-h"><span>Tags</span><span>${state.tags.size || ''}</span></div><div class="facet-options">${tagList.map(([name, count]) => `<button type="button" class="facet-opt ${state.tags.has(name) ? 'on' : ''}" data-tag="${W.escapeHtml(name)}" aria-pressed="${state.tags.has(name)}">${W.escapeHtml(name)}<span class="cnt">${count}</span></button>`).join('') || '<span class="card-note">No tags yet.</span>'}</div></div>
      <div class="surf-f" style="margin:10px -13px -13px;padding:10px 13px"><button type="button" class="link filter-clear">Clear all</button></div>`;

    document.body.appendChild(pop);
    pop.style.position = 'absolute';
    pop.style.zIndex = '70';
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(292, window.innerWidth - 24);
    pop.style.width = `${width}px`;
    pop.style.left = `${Math.max(12, Math.min(rect.left + window.scrollX, window.innerWidth - width - 12 + window.scrollX))}px`;
    pop.style.top = `${rect.bottom + window.scrollY + 8}px`;
    filterPop = pop;
    anchor.setAttribute('aria-expanded', 'true');

    pop.querySelector('.facet-opt')?.focus();
    pop.querySelectorAll('[data-person]').forEach((button) => {
      button.addEventListener('click', () => {
        state.person = button.dataset.person;
        openFilter(anchor);
        updateFilterButton();
        renderList();
      });
    });
    pop.querySelectorAll('[data-cat]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.cat;
        if (state.categories.has(name)) state.categories.delete(name); else state.categories.add(name);
        button.classList.toggle('on', state.categories.has(name));
        button.setAttribute('aria-pressed', String(state.categories.has(name)));
        updateFilterButton();
        renderList();
      });
    });
    pop.querySelectorAll('[data-tag]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.tag;
        if (state.tags.has(name)) state.tags.delete(name); else state.tags.add(name);
        button.classList.toggle('on', state.tags.has(name));
        button.setAttribute('aria-pressed', String(state.tags.has(name)));
        updateFilterButton();
        renderList();
      });
    });
    pop.querySelector('.filter-close').addEventListener('click', () => closeFilter());
    pop.querySelector('.filter-clear').addEventListener('click', () => {
      clearFilters();
      closeFilter();
    });
    setTimeout(() => {
      const onDoc = (event) => {
        if (!pop.contains(event.target) && !anchor.contains(event.target)) {
          closeFilter();
          document.removeEventListener('pointerdown', onDoc);
        }
      };
      document.addEventListener('pointerdown', onDoc);
      pop._onDoc = onDoc;
    }, 0);
  }

  function closeFilter() {
    if (!filterPop) return;
    if (filterPop._onDoc) document.removeEventListener('pointerdown', filterPop._onDoc);
    filterPop.remove();
    filterPop = null;
    $('filterButton').setAttribute('aria-expanded', 'false');
  }

  async function load() {
    setMeta();
    try {
      await W.loadCore();
      state.transactions = await W.fetchRangeTransactions(state.range);
      await W.refreshRecurring().catch(() => {});
      W.state.people = await W.api('/people');
      setMeta();
      renderList();
      updateFilterButton();
    } catch (error) {
      $('txScroll').innerHTML = `<div class="empty tx-empty"><b>Could not read the ledger</b><span>${W.escapeHtml(error.message)}</span><button type="button" class="btn ghost sm" onclick="location.reload()" style="margin-top:8px">Try again</button></div>`;
      W.toast(error.message, { tone: 'danger' });
    }
  }

  /* ----------------------------- inspector ----------------------------- */
  function openInspector(id, trigger) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    state.inspectorId = id;
    state.lastFocus = trigger || document.activeElement;
    const shares = W.sharedPeople(t);
    const rule = W.state.recurring.find((r) => r.id === t.recurringID);
    const owner = W.ownerLabel(t);
    $('inspectorBody').innerHTML = `
      <div class="lgi-top">
        <span class="lgi-ic">${W.categoryIcon(t.category)}</span>
        <div><div class="lgi-name">${W.escapeHtml(t.name || t.category)}</div><div class="lgi-cat">${W.escapeHtml(t.category)}</div></div>
      </div>
      <div class="lgi-amt ${t.type === 'income' ? 'in' : ''}">${W.money(t.amount, { signed: true, sign: t.type === 'income' ? '+' : '−' })}</div>
      <div class="lgi-date">${W.longDate(t.date)}</div>
      <div class="lgi-kv">
        <div class="kv"><span>Type</span><b>${t.type === 'income' ? 'Income' : 'Expense'}</b></div>
        <div class="kv"><span>Owner</span><b>${W.escapeHtml(owner || 'No owner')}</b></div>
        <div class="kv"><span>Tags</span><span class="lgi-tags">${(t.tags || []).length ? t.tags.map((tag) => `<span class="pill">${W.escapeHtml(tag)}</span>`).join('') : '<span class="card-note">None</span>'}</span></div>
        <div class="kv"><span>Repeat</span><b>${rule ? W.escapeHtml(rule.frequency[0].toUpperCase() + rule.frequency.slice(1)) : (t.recurringID ? 'Recurring occurrence' : 'One-off')}</b></div>
        ${rule ? `<div class="kv"><span>Rule</span><b>${W.escapeHtml(rule.name)}</b></div>` : ''}
        <div class="kv"><span>Added</span><b>${W.dateTimeLabel(t.created_date)}</b></div>
      </div>
      ${shares.length ? `<div class="splitbox" style="margin-top:14px"><div class="split-h"><span>Shared split</span><span>${W.money(t.amount)}</span></div>${shares.map((s) => `<div class="split-row"><span class="split-name">${W.escapeHtml(s.name)}</span><span class="input split-input"><span>${W.state.currency.symbol}</span><input readonly value="${W.formatNumber(s.amount)}" aria-label="${W.escapeHtml(s.name)} share"></span></div>`).join('')}</div>` : ''}`;
    $('inspectorDelete').dataset.id = id;
    W.openDialog($('inspector'));
  }

  function closeInspector() {
    W.closeDialog($('inspector'));
  }

  async function deleteOne(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    const ok = await W.confirmDialog({
      title: 'Delete transaction?',
      message: `“${t.name || t.category}” will be removed. You can undo for six seconds.`,
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    closeInspector();
    scheduleDelete([t]);
  }

  function scheduleDelete(txs) {
    if (!txs.length) return;
    const ids = new Set(txs.map((t) => t.id));
    state.transactions = state.transactions.filter((t) => !ids.has(t.id));
    state.selected.clear();
    if (state.selectMode) toggleSelectMode(false);
    setMeta();
    renderList();
    const record = { txs, timer: null };
    record.timer = setTimeout(() => flush(record), 6000);
    state.pending.push(record);
    W.toast(`${txs.length} ${txs.length === 1 ? 'transaction' : 'transactions'} deleted.`, {
      actionLabel: 'Undo',
      duration: 6000,
      onAction: () => {
        clearTimeout(record.timer);
        state.pending = state.pending.filter((p) => p !== record);
        state.transactions.push(...txs);
        setMeta();
        renderList();
        W.toast('Restored.');
      },
    });
  }

  async function flush(record) {
    state.pending = state.pending.filter((p) => p !== record);
    const results = await Promise.allSettled(record.txs.map((t) => W.api(`/transactions/${t.id}`, { method: 'DELETE' })));
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
      W.toast(`${failed.length} could not be deleted. Reloading.`, { tone: 'danger' });
      load();
    }
  }

  function flushAll() {
    for (const record of [...state.pending]) {
      clearTimeout(record.timer);
      flush(record);
    }
  }

  /* ------------------------------- csv -------------------------------- */
  function csvFor(txs) {
    const withPeople = W.hasPeople();
    const columns = ['name', 'category', 'tags', 'amount', 'type', 'date'];
    if (withPeople) columns.push('person');
    const rows = txs.map((t) => ({
      name: t.name || '',
      category: t.category || '',
      tags: W.csv.tagsToCell(t.tags || []),
      amount: Number(t.amount).toFixed(2),
      type: t.type,
      date: t.date,
      person: t.person_id ? (W.personName(t.person_id) || '') : (W.sharesFor(t).length ? 'Shared' : ''),
    }));
    return W.csv.stringify(rows, columns);
  }

  function exportRows(txs, filename = 'transactions.csv') {
    if (!txs.length) { W.toast('There is nothing to export yet.', { tone: 'default' }); return; }
    W.download(filename, csvFor(txs));
    W.toast(`${txs.length} ${txs.length === 1 ? 'row' : 'rows'} exported.`);
  }

  function bulkExport() {
    const txs = state.transactions.filter((t) => state.selected.has(t.id));
    exportRows(txs, `wally-selection-${W.dateISO(new Date())}.csv`);
  }

  function bulkDelete() {
    const txs = state.transactions.filter((t) => state.selected.has(t.id));
    if (!txs.length) return;
    W.confirmDialog({
      title: `Delete ${txs.length} ${txs.length === 1 ? 'transaction' : 'transactions'}?`,
      message: 'The rows leave the ledger together. Undo stays available for six seconds.',
      confirmLabel: `Delete ${txs.length}`,
    }).then((ok) => { if (ok) scheduleDelete(txs); });
  }

  /* ------------------------------ range ------------------------------- */
  function openRange(anchor) {
    anchor.setAttribute('aria-expanded', 'true');
    W.openRangePopover(anchor, state.range, (range) => {
      anchor.setAttribute('aria-expanded', 'false');
      state.range = range;
      load();
    });
  }

  /* ------------------------------ boot -------------------------------- */
  async function applyUrl() {
    const params = new URLSearchParams(window.location.search);
    const category = params.get('category');
    const tag = params.get('tag');
    const person = params.get('person');
    const focus = params.get('focus');
    if (category) state.categories.add(category);
    if (tag) state.tags.add(tag);
    if (person) state.person = person;
    updateFilterButton();
    renderList();

    if (focus) {
      try {
        const rows = await W.api(`/transactions/id/${encodeURIComponent(focus)}`);
        const tx = rows?.[0];
        if (tx) {
          const d = W.parseDate(tx.date);
          state.range = { type: 'current', from: d, to: d };
          await load();
          setTimeout(() => openInspector(tx.id, $('txScroll')), 250);
        }
      } catch { /* the row may be gone; leave the default range */ }
    }
  }

  function bind() {
    document.querySelectorAll('[data-compose]').forEach((button) => {
      button.addEventListener('click', () => composer.open());
    });
    $('selectToggle').setAttribute('aria-label', 'Select transactions');
    $('selectToggle').addEventListener('click', () => toggleSelectMode());
    $('bulkClear').addEventListener('click', () => toggleSelectMode(false));
    $('bulkDelete').addEventListener('click', bulkDelete);
    $('bulkExport').addEventListener('click', bulkExport);
    $('filterButton').addEventListener('click', () => {
      if (filterPop) closeFilter(); else openFilter($('filterButton'));
    });
    $('rangeButton').addEventListener('click', () => openRange($('rangeButton')));
    $('searchInput').addEventListener('input', (event) => {
      state.search = event.target.value;
      renderList();
    });
    document.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        $('searchInput').focus();
        $('searchInput').select();
      }
      if (event.key === 'Escape') {
        closeRangeFilter();
      }
    });
    function closeRangeFilter() {
      W.closeRangePopover();
      closeFilter();
    }
    $('inspectorClose').addEventListener('click', closeInspector);
    $('inspectorDelete').addEventListener('click', () => {
      if (state.inspectorId) deleteOne(state.inspectorId);
    });
    $('inspectorEdit').addEventListener('click', () => {
      const t = state.transactions.find((x) => x.id === state.inspectorId);
      if (!t) return;
      closeInspector();
      composer.open({ transaction: t });
    });
    $('inspectorDuplicate').addEventListener('click', () => {
      const t = state.transactions.find((x) => x.id === state.inspectorId);
      if (!t) return;
      closeInspector();
      setTimeout(() => composer.open({ transaction: t, duplicate: true }), 120);
    });
    $('inspector').addEventListener('close', () => {
      if (state.lastFocus && typeof state.lastFocus.focus === 'function') state.lastFocus.focus();
    });
    window.addEventListener('pagehide', flushAll);
  }

  W.ready(async () => {
    W.initShell('transactions');
    W.installThemeListener();
    await i18n.init();
    bind();
    await W.loadCore();
    document.body.classList.toggle('has-people', W.hasPeople());
    $('navAvatar').textContent = W.initials(W.state.people.find((p) => p.is_self)?.name || 'PA');
    await load();
    await applyUrl();
  });
})();
