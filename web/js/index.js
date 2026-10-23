(() => {
  const state = {
    range: { type: 'current', from: new Date(), to: new Date() },
    transactions: [],
    trendTransactions: [],
    previousTransactions: [],
    scope: null,
    rankMode: 'categories',
    peopleMode: 'months',
    hiddenCategories: new Set(),
    hiddenTags: new Set(),
    loading: true,
  };

  const $ = (id) => document.getElementById(id);
  const composer = new W.Composer({ onSaved: () => load() });

  function rangeLabel(range) {
    if (range.type === 'all') return 'All time';
    if (range.type === 'custom') return `${W.monthLabel(range.from, true)} – ${W.monthLabel(range.to, true)}`;
    if (range.type === 'current') return W.monthLabel(range.to);
    if (range.type === 'ytd') return `Year to date`;
    return `Last ${range.type.replace('m', '')} months`;
  }

  function rangeLongLabel(range) {
    if (range.type === 'all') return 'Every month';
    const { from, to } = W.rangeToFromTo(range);
    if (from && to && from.getTime() === to.getTime()) return W.monthLabel(to);
    return from && to ? `${W.monthLabel(from)} – ${W.monthLabel(to)}` : W.monthLabel(range.to);
  }

  function scopeTransactions() {
    if (!state.scope) return state.transactions;
    return state.transactions.filter((t) => t.person_id === state.scope);
  }

  function countRange(txs) {
    return txs.length;
  }

  function setPageMeta() {
    const txs = state.transactions;
    $('pageSub').innerHTML = state.loading
      ? 'Loading your ledger…'
      : 'Income, spending, and what’s left.';
    $('rangeLabel').textContent = rangeLabel(state.range);
    $('heroRange').textContent = state.scope
      ? W.personName(state.scope)
      : (state.range.type === 'all' ? 'all time' : 'this month');
    document.title = `${rangeLabel(state.range)} · Wally`;
  }

  function renderScope() {
    const bar = $('scopeBar');
    const tools = $('dashTools');
    if (!W.hasPeople()) { tools.hidden = true; return; }
    tools.hidden = false;
    const options = [{ id: null, name: 'Everyone' }, ...W.state.people.map((p) => ({ id: p.id, name: p.name }))];
    bar.innerHTML = options.map((o) => `<button type="button" class="${state.scope === o.id ? 'on' : ''}" data-scope="${o.id ?? ''}" aria-pressed="${state.scope === o.id}">${W.escapeHtml(o.name)}</button>`).join('');
    bar.querySelectorAll('[data-scope]').forEach((button) => {
      button.addEventListener('click', () => {
        state.scope = button.dataset.scope || null;
        renderAll();
      });
    });
    $('scopeNote').textContent = state.scope
      ? `Only ${W.personName(state.scope)}’s own transactions. Shared costs stay in the People card.`
      : 'Everyone, including shared costs.';
  }

  function previousRange(range) {
    const { from } = W.rangeToFromTo(range);
    if (!from) return null;
    const to = state.range.to;
    if (range.type === 'current') return { type: 'custom', from: W.addMonths(from, -1), to: W.addMonths(from, -1) };
    if (range.type === '3m') return { type: 'custom', from: W.addMonths(from, -3), to: W.addMonths(to, -3) };
    if (range.type === '6m') return { type: 'custom', from: W.addMonths(from, -6), to: W.addMonths(to, -6) };
    if (range.type === '12m') return { type: 'custom', from: W.addMonths(from, -12), to: W.addMonths(to, -12) };
    if (range.type === 'ytd') return { type: 'custom', from: W.addMonths(from, -12), to: W.addMonths(to, -12) };
    return null;
  }

  async function load() {
    state.loading = true;
    setPageMeta();
    try {
      await W.loadCore();
      state.transactions = await W.fetchRangeTransactions(state.range);
      const prev = previousRange(state.range);
      state.previousTransactions = prev ? await W.fetchRangeTransactions(prev).catch(() => []) : [];

      const { from, to } = W.rangeToFromTo(state.range);
      const end = to || new Date();
      const start = from ? W.addMonths(from, -5) : W.addMonths(new Date(), -5);
      state.trendTransactions = await W.api(`/transactions/range/${start.getFullYear()}-${start.getMonth() + 1}/${end.getFullYear()}-${end.getMonth() + 1}`).catch(() => []);
      state.loading = false;
      renderAll();
    } catch (error) {
      state.loading = false;
      setPageMeta();
      W.toast(error.message, { tone: 'danger' });
    }
  }

  function renderAll() {
    setPageMeta();
    renderScope();
    renderHero();
    renderPeopleCard();
    renderRank();
    renderInsights();
    renderRecent();
    const empty = state.transactions.length === 0;
    $('dashEmpty').hidden = !empty;
    document.querySelector('.hero').hidden = empty;
    document.querySelector('.dash-stack').hidden = empty;
    if (empty) $('peopleCard').hidden = true;
  }

  function renderHero() {
    const scoped = scopeTransactions();
    const sum = W.summarise(scoped);
    const spent = sum.expense;
    const earned = sum.income;
    const kept = earned - spent;
    const keptRate = earned > 0 ? Math.round((kept / earned) * 100) : null;

    $('heroLabel').textContent = kept < 0 ? 'Over' : 'Left';
    $('heroSpent').textContent = W.money(kept, { signed: true });
    $('heroSub').innerHTML = earned > 0
      ? `<b>${keptRate}%</b> of income kept`
      : 'No income recorded in this range';
    $('heroNote').innerHTML = `${W.money(earned)} in · ${W.money(spent)} out`;

    renderTrend();
  }

  function monthlyTotals(txs, months) {
    return months.map((month) => {
      const key = W.monthKey(month);
      let income = 0;
      let expense = 0;
      for (const t of txs) {
        if (!String(t.date).startsWith(key)) continue;
        if (t.type === 'income') income += W.parseAmount(t.amount);
        else expense += W.parseAmount(t.amount);
      }
      return { month, income, expense };
    });
  }

  function renderTrend() {
    const end = W.rangeToFromTo(state.range).to || new Date();
    const months = Array.from({ length: 6 }, (_, i) => W.addMonths(end, i - 5));
    const series = monthlyTotals(state.trendTransactions, months);
    const max = Math.max(1, ...series.flatMap((s) => [s.income, s.expense]));
    const w = 400;
    const h = 116;
    const padL = 2;
    const padR = 2;
    const padT = 8;
    const padB = 6;
    const x = (i) => padL + (i * (w - padL - padR)) / (series.length - 1);
    const y = (v) => padT + (1 - v / max) * (h - padT - padB);

    const incomePoints = series.map((s, i) => `${x(i).toFixed(1)},${y(s.income).toFixed(1)}`);
    const expensePoints = series.map((s, i) => `${x(i).toFixed(1)},${y(s.expense).toFixed(1)}`);
    const incomePath = `M${incomePoints.join(' L')}`;
    const expensePath = `M${expensePoints.join(' L')}`;
    const gap = `M${incomePoints.join(' L')} L${[...expensePoints].reverse().join(' L')} Z`;
    const last = series.length - 1;

    $('trendPlot').innerHTML = `
      <svg class="lines" viewBox="0 0 ${w} ${h}" role="img" aria-label="Income and spending for the last six months">
        <g class="grid">
          ${[0.25, 0.5, 0.75].map((p) => `<line x1="${padL}" x2="${w - padR}" y1="${(padT + p * (h - padT - padB)).toFixed(1)}" y2="${(padT + p * (h - padT - padB)).toFixed(1)}"/>`).join('')}
        </g>
        <path class="gap" d="${gap}"/>
        <path class="spend" d="${expensePath}"/>
        <path class="income" d="${incomePath}"/>
        ${series.map((s, i) => `<circle class="${i === last ? 'dot' : 'dots'}" cx="${x(i).toFixed(1)}" cy="${y(s.expense).toFixed(1)}" r="${i === last ? 3 : 2.1}"/>`).join('')}
        ${series.map((s, i) => `<circle class="${i === last ? 'dot' : 'dots'}" cx="${x(i).toFixed(1)}" cy="${y(s.income).toFixed(1)}" r="${i === last ? 3 : 2.1}"/>`).join('')}
      </svg>`;
    $('trendAxis').innerHTML = months.map((m, i) => `<span class="${i === last ? 'now' : ''}">${W.monthLabel(m, true).split(' ')[0]}</span>`).join('');
  }

  function personMonthly(personId, months) {
    const source = state.trendTransactions.length ? state.trendTransactions : state.transactions;
    return months.map((month) => {
      const key = W.monthKey(month);
      let income = 0;
      let expense = 0;
      for (const t of source) {
        if (!String(t.date).startsWith(key)) continue;
        if (t.person_id === personId) {
          if (t.type === 'income') income += W.parseAmount(t.amount);
          else expense += W.parseAmount(t.amount);
        } else if (!t.person_id && t.type === 'expense') {
          const share = W.sharesFor(t).find((s) => s.person_id === personId);
          if (share) expense += W.parseAmount(share.amount);
        }
      }
      return { month, income, expense };
    });
  }

  function renderPeopleCard() {
    const card = $('peopleCard');
    if (!W.hasPeople() || state.transactions.length === 0) { card.hidden = true; return; }
    card.hidden = false;
    const sum = W.summarise(state.transactions);
    const useMonths = state.peopleMode === 'months';
    $('peopleSub').textContent = `${rangeLongLabel(state.range)} · ${useMonths ? 'six months, one scale' : 'the four categories that carry the month'}`;
    const end = W.rangeToFromTo(state.range).to || new Date();
    const rangeMonths = Array.from({ length: 6 }, (_, i) => W.addMonths(end, i - 5));
    const max = Math.max(1, ...W.state.people.flatMap((p) => personMonthly(p.id, rangeMonths).flatMap((m) => [m.income, m.expense])));

    const rows = W.state.people.map((person) => {
      const row = sum.perPerson[person.id] || { spent: 0, earned: 0, count: 0, shares: 0 };
      const monthly = personMonthly(person.id, rangeMonths);
      const bars = monthly.map((m) => {
        const spend = (m.expense / max) * 38;
        const kept = Math.max(0, (m.income - m.expense) / max) * 38;
        return `<span class="minibar" title="${W.monthLabel(m.month)}: ${W.money(m.expense)} spent"><i class="mkept" style="height:${kept.toFixed(1)}px"></i><i class="mspend" style="height:${spend.toFixed(1)}px"></i></span>`;
      }).join('');
      const topCats = (() => {
        const totals = new Map();
        for (const t of state.transactions) {
          if (t.person_id !== person.id || t.type !== 'expense') continue;
          totals.set(t.category, (totals.get(t.category) || 0) + W.parseAmount(t.amount));
        }
        return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
      })();
      const catMax = Math.max(1, ...topCats.map((c) => c[1]));
      return `
        <div class="pc-row">
          <div class="pc-who">
            <b>${W.avatar(person, 'tiny')}${W.escapeHtml(person.name)}${person.is_self ? '<span class="pill" style="font-size:7.5px;padding:2px 5px">this browser</span>' : ''}</b>
            <span class="pc-tot">
              <span><i>Spent</i><b>${W.money(row.spent + row.shares)}</b></span>
              <span><i>Earned</i><b class="k">${W.money(row.earned)}</b></span>
              <span><i>Kept</i><b class="${row.net - row.shares >= 0 ? 'k' : ''}">${W.money(row.net - row.shares, { signed: true, plus: true })}</b></span>
            </span>
          </div>
          <div class="pc-chart">
            ${useMonths ? `<div class="minirow" role="img" aria-label="${W.escapeHtml(person.name)}: income, spending and what was kept, ${W.monthLabel(rangeMonths[0])} to ${W.monthLabel(rangeMonths[5])}">${bars}</div>` : `<div class="pcat-list">${topCats.length ? topCats.map(([name, amount]) => `<span class="pcat"><span class="pcat-n">${W.escapeHtml(name)}</span><span class="pcat-b"><i style="width:${((amount / catMax) * 100).toFixed(0)}%"></i></span><span class="pcat-v">${W.money(amount)}</span></span>`).join('') : '<span class="card-note">No spending in this range.</span>'}</div>`}
          </div>
        </div>`;
    }).join('');

    const axis = useMonths ? `<div class="pc-axisrow"><span></span><div class="pc-axis">${rangeMonths.map((m, i) => `<span class="${i === rangeMonths.length - 1 ? 'now' : ''}">${W.monthLabel(m, true).split(' ')[0]}</span>`).join('')}</div></div>` : '';

    const shared = sum.shared;
    const partEntries = Object.entries(shared.parts);
    const equalParts = partEntries.length > 1 && partEntries.every(([, amount]) => Math.abs(amount - partEntries[0][1]) < 0.01);
    const sharedParts = equalParts
      ? `${W.money(partEntries[0][1])} each`
      : partEntries.map(([pid, amount]) => `${W.escapeHtml(W.personName(pid) || '—')} <em>${W.money(amount)}</em>`).join(' · ');
    const sharedRow = shared.count ? `
      <div class="pc-shared">
        <div><b>Shared</b><small>${shared.count} ${shared.count === 1 ? 'transaction' : 'transactions'}</small></div>
        <div class="pcs-meta">${W.money(shared.spent)} spent · ${sharedParts || 'split equally'}</div>
        <span class="pcs-net">${W.money(-shared.spent, { signed: true })}</span>
      </div>` : '';

    const keptRate = sum.income > 0 ? (sum.net / sum.income) * 100 : 0;
    $('peopleBody').innerHTML = rows + axis + sharedRow + `
      <div class="legend-foot pc-foot">
        <span>Household · ${state.transactions.length} transactions</span>
        <span>Net <b>${W.money(sum.net, { signed: true, plus: true })}</b> · <b>${keptRate.toFixed(1)}%</b> kept</span>
      </div>`;

    document.querySelectorAll('#peopleMode [data-mode]').forEach((button) => {
      button.classList.toggle('on', button.dataset.mode === state.peopleMode);
      button.setAttribute('aria-pressed', String(button.dataset.mode === state.peopleMode));
      if (!button.dataset.bound) {
        button.dataset.bound = '1';
        button.addEventListener('click', () => {
          state.peopleMode = button.dataset.mode;
          renderPeopleCard();
        });
      }
    });
  }

  function categoryTotals(txs, mode) {
    const totals = new Map();
    let total = 0;
    for (const t of txs) {
      if (t.type !== 'expense') continue;
      const amount = W.parseAmount(t.amount);
      total += amount;
      if (mode === 'tags') {
        const tags = t.tags?.length ? t.tags : ['Untagged'];
        for (const tag of tags) totals.set(tag, (totals.get(tag) || 0) + amount);
      } else {
        totals.set(t.category || 'Miscellaneous', (totals.get(t.category || 'Miscellaneous') || 0) + amount);
      }
    }
    return { totals, total };
  }

  function renderRank() {
    const txs = scopeTransactions();
    const mode = state.rankMode;
    const { totals, total } = categoryTotals(txs, mode);
    const hidden = mode === 'tags' ? state.hiddenTags : state.hiddenCategories;
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...sorted.map(([, v]) => v));
    const shown = sorted.slice(0, 9);
    const visibleTotal = sorted.filter(([name]) => !hidden.has(name)).reduce((sum, [, value]) => sum + value, 0);
    const visibleCount = sorted.filter(([name]) => !hidden.has(name)).length;
    $('rankHeading').textContent = mode === 'tags' ? 'Spending by tag' : 'Spending by category';
    $('rankSub').textContent = mode === 'tags'
      ? `${W.money(visibleTotal)} across ${visibleCount} tags · a transaction with two tags counts twice`
      : `${W.money(visibleTotal)} across ${visibleCount} categories`;
    $('rankNote').innerHTML = mode === 'tags'
      ? 'Tags overlap, so these totals are not additive. Tap a row to include or exclude it.'
      : 'Tap a row to include or exclude it. The category total follows.';

    if (!shown.length) {
      $('categoryRank').innerHTML = `<div class="empty"><span class="eic">${W.icon('tag')}</span><b>Nothing to rank yet</b><span>Expenses will appear here by ${mode === 'tags' ? 'tag' : 'category'} once the range has some.</span></div>`;
      $('categoryShare').innerHTML = '';
      return;
    }

    $('categoryRank').innerHTML = shown.map(([name, amount], index) => {
      const off = hidden.has(name);
      const color = mode === 'tags'
        ? `hsl(${(index * 41 + 8) % 360} 46% 58%)`
        : W.categoryColor(name);
      return `<div class="rank ${off ? 'off' : ''}" style="--c:${color}" role="button" tabindex="0" data-hide="${W.escapeHtml(name)}" aria-pressed="${!off}" aria-label="${off ? 'Include' : 'Exclude'} ${W.escapeHtml(name)}, ${W.escapeHtml(W.money(amount))}">
        <span class="rdot" aria-hidden="true"></span>
        <span class="rname">${W.escapeHtml(name)}</span>
        <span class="rbar" aria-hidden="true"><i style="width:${Math.max(3, (amount / max) * 100).toFixed(1)}%"></i></span>
        <span class="ramt">${W.money(amount)}</span>
      </div>`;
    }).join('');

    $('categoryRank').querySelectorAll('[data-hide]').forEach((row) => {
      const toggle = () => {
        const name = row.dataset.hide;
        if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
        renderRank();
        [...$('categoryRank').querySelectorAll('.rank')].find((item) => item.dataset.hide === name)?.focus();
      };
      row.addEventListener('click', toggle);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggle();
        }
      });
    });

    $('categoryShare').innerHTML = '';
    $('categoryShare').hidden = true;
    if (hidden.size) {
      $('rankNote').innerHTML += ` <button type="button" class="tx-reset" id="unhideAll">Show ${hidden.size} hidden</button>`;
      $('unhideAll')?.addEventListener('click', () => { hidden.clear(); renderRank(); });
    }
  }

  function renderInsights() {
    const txs = scopeTransactions();
    const sum = W.summarise(txs);
    const { totals, total } = categoryTotals(txs, 'categories');
    const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted[0];
    const fixed = ['Rent', 'Utilities'].reduce((acc, name) => acc + (totals.get(name) || 0), 0);
    const sharedTx = txs.filter((t) => !t.person_id && W.sharesFor(t).length);
    const sharedTotal = sharedTx.reduce((acc, t) => acc + W.parseAmount(t.amount), 0);

    const merchantCounts = new Map();
    for (const t of txs) {
      if (t.type !== 'expense' || !t.name) continue;
      merchantCounts.set(t.name, (merchantCounts.get(t.name) || 0) + 1);
    }
    const topMerchant = [...merchantCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    const facts = [];
    if (top && total > 0) {
      facts.push({
        icon: 'spark',
        title: `${top[0]} is the largest category`,
        detail: `${(top[1] / total * 100).toFixed(0)}% of spending — <b>${W.money(top[1])}</b> of ${W.money(total)}.`,
      });
    } else {
      facts.push({ icon: 'spark', title: 'A clean page', detail: 'No expenses in this range yet. The first entry sets the shape.' });
    }
    if (fixed > 0) {
      facts.push({
        icon: 'repeat',
        title: 'Fixed costs',
        detail: `Rent and utilities take <b>${W.money(fixed)}</b>, ${(fixed / Math.max(total, 1) * 100).toFixed(0)}% of what left the account.`,
      });
    } else {
      facts.push({
        icon: 'repeat',
        title: 'No fixed costs recorded',
        detail: 'Rent and utilities would be counted here when they appear.',
      });
    }
    if (sharedTx.length) {
      facts.push({
        icon: 'people',
        title: `${sharedTx.length} shared ${sharedTx.length === 1 ? 'cost' : 'costs'}`,
        detail: `<b>${W.money(sharedTotal)}</b> split between ${W.state.people.length} people. Each person’s part sits in the People card.`,
      });
    } else if (topMerchant) {
      facts.push({
        icon: 'wallet',
        title: `${topMerchant[0]} appears ${topMerchant[1]} ${topMerchant[1] === 1 ? 'time' : 'times'}`,
        detail: 'The most repeated name in this range. Recurring rules would make that explicit.',
      });
    } else {
      facts.push({
        icon: 'wallet',
        title: 'No shared costs',
        detail: W.hasPeople() ? 'Everything in this range has one owner.' : 'Add people in Settings to split a cost.',
      });
    }

    $('insightsSub').textContent = rangeLongLabel(state.range);
    $('insights').innerHTML = facts.slice(0, 3).map((f) => `
      <div class="fact-row">
        <span class="fact-ic">${W.icon(f.icon)}</span>
        <div><div class="fact-t">${f.title}</div><div class="fact-d">${f.detail}</div></div>
      </div>`).join('');
  }

  function renderRecent() {
    const txs = [...scopeTransactions()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_date || '').localeCompare(String(a.created_date || ''))).slice(0, 5);
    $('recentSub').textContent = 'The last five transactions';
    if (!txs.length) {
      $('recentList').innerHTML = `<div class="empty"><span class="eic">${W.icon('transactions')}</span><b>No recent entries</b><span>Add a transaction and it will appear here.</span></div>`;
      return;
    }
    $('recentList').innerHTML = txs.map((t) => {
      const owner = W.ownerLabel(t);
      const when = /^(Today|Yesterday)$/.test(W.dayLabel(t.date))
        ? `${W.dayLabel(t.date)} · ${W.shortDate(t.date)}`
        : W.dayLabel(t.date).replace(/^(\w+) /, '$1, ');
      const meta = [when, t.category, owner].filter(Boolean).join(' · ');
      return `<a class="rec-row" href="/transactions.html?focus=${encodeURIComponent(t.id)}">
        <span class="rec-ic">${W.categoryIcon(t.category)}</span>
        <span class="rec-t"><b>${W.escapeHtml(t.name || t.category)}</b><small>${W.escapeHtml(meta)}</small></span>
        <span class="rec-a ${t.type === 'income' ? 'in' : ''}">${W.money(t.amount, { signed: true, sign: t.type === 'income' ? '+' : '−' })}</span>
      </a>`;
    }).join('');
  }

  function openRange(anchor) {
    anchor.setAttribute('aria-expanded', 'true');
    W.openRangePopover(anchor, state.range, (range) => {
      anchor.setAttribute('aria-expanded', 'false');
      state.range = range;
      state.hiddenCategories.clear();
      state.hiddenTags.clear();
      load();
    });
  }

  function bind() {
    document.querySelectorAll('[data-compose]').forEach((button) => {
      button.addEventListener('click', () => composer.open());
    });
    $('rangeButton').addEventListener('click', () => openRange($('rangeButton')));
    $('rankMode').querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        state.rankMode = button.dataset.mode;
        $('rankMode').querySelectorAll('[data-mode]').forEach((b) => {
          b.classList.toggle('on', b === button);
          b.setAttribute('aria-pressed', String(b === button));
        });
        renderRank();
      });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') W.closeRangePopover();
    });
  }

  W.ready(async () => {
    W.initShell('overview');
    W.installThemeListener();
    await i18n.init();
    bind();
    await W.loadCore();
    const navAvatar = $('navAvatar');
    navAvatar.textContent = W.initials(W.state.people.find((p) => p.is_self)?.name || 'PA');
    load();
  });
})();
