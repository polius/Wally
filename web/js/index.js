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
    const { from, to } = W.rangeToFromTo(state.range);
    let span = '';
    if (from && to) {
      span = from.getTime() === to.getTime()
        ? W.monthLabel(to)
        : `${W.shortDate(from)} – ${W.longDate(to).replace(/^\w+, /, '')}`;
    }
    $('pageSub').innerHTML = state.loading
      ? 'Loading your ledger…'
      : `${countRange(txs)} ${countRange(txs) === 1 ? 'transaction' : 'transactions'} · ${span} · <b>${W.state.currency.name}</b>`;
    $('rangeLabel').textContent = rangeLabel(state.range);
    $('heroRange').textContent = state.scope ? W.personName(state.scope) : rangeLabel(state.range).toLowerCase();
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
    document.querySelector('.dash-grid').hidden = empty;
    if (empty) $('peopleCard').hidden = true;
  }

  function renderHero() {
    const scoped = scopeTransactions();
    const sum = W.summarise(scoped);
    const spent = sum.expense;
    const earned = sum.income;
    const kept = earned - spent;
    const keptRate = earned > 0 ? Math.round((kept / earned) * 100) : null;

    $('heroSpent').textContent = W.money(spent);
    $('heroSub').innerHTML = earned > 0
      ? `<b>${W.money(earned)}</b> income · ${keptRate}% kept`
      : 'No income recorded in this range';
    $('heroNote').textContent = state.scope
      ? 'Shared costs are not included in a personal scope; they live in the People card.'
      : (sum.shared.count
        ? `Shared costs are counted once, in the household total. ${sum.shared.count} ${sum.shared.count === 1 ? 'cost' : 'costs'} this range.`
        : `Every amount is in ${W.state.currency.name}. The ledger stores cents, not estimates.`);

    const prevSum = W.summarise(state.previousTransactions).expense;
    const delta = $('heroDelta');
    if (state.range.type !== 'all' && prevSum > 0 && spent > 0) {
      const change = ((spent - prevSum) / prevSum) * 100;
      const rounded = Math.abs(change).toFixed(change < 1 && change > 0 ? 1 : 0);
      delta.hidden = false;
      delta.className = `hero-delta ${change < -0.5 ? '' : change > 0.5 ? 'neg' : 'flat'}`;
      delta.textContent = change < -0.5
        ? `↓ ${rounded}% less than the previous period`
        : change > 0.5
          ? `↑ ${rounded}% more than the previous period`
          : 'About the same as the previous period';
    } else {
      delta.hidden = true;
    }

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
    const peak = Math.max(...series.map((s) => Math.max(s.income, s.expense)));
    $('trendPeak').textContent = peak > 0 ? `Peak ${W.money(peak)}` : '';

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
    const latest = series[last];
    $('trendSub').textContent = latest ? `${W.money(latest.expense)} spent · ${W.money(latest.income)} in` : 'Spending against income';
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
    $('peopleSub').textContent = `${rangeLongLabel(state.range)} · ${state.transactions.length} ${state.transactions.length === 1 ? 'transaction' : 'transactions'}`;
    const end = W.rangeToFromTo(state.range).to || new Date();
    const rangeMonths = Array.from({ length: 6 }, (_, i) => W.addMonths(end, i - 5));
    const useMonths = state.peopleMode === 'months';
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
              <span><i>Net</i><b class="${row.net - row.shares >= 0 ? 'k' : ''}">${W.money(row.net - row.shares, { signed: true })}</b></span>
            </span>
          </div>
          <div class="pc-chart">
            ${useMonths ? `<div class="minirow" role="img" aria-label="${W.escapeHtml(person.name)}: income, spending and what was kept, ${W.monthLabel(rangeMonths[0])} to ${W.monthLabel(rangeMonths[5])}">${bars}</div>` : `<div class="pcat-list">${topCats.length ? topCats.map(([name, amount]) => `<span class="pcat"><span class="pcat-n">${W.escapeHtml(name)}</span><span class="pcat-b"><i style="width:${((amount / catMax) * 100).toFixed(0)}%"></i></span><span class="pcat-v">${W.money(amount)}</span></span>`).join('') : '<span class="card-note">No spending in this range.</span>'}</div>`}
          </div>
        </div>`;
    }).join('');

    const axis = useMonths ? `<div class="pc-axisrow"><span></span><div class="pc-axis">${rangeMonths.map((m, i) => `<span class="${i === rangeMonths.length - 1 ? 'now' : ''}">${W.monthLabel(m, true).split(' ')[0]}</span>`).join('')}</div></div>` : '';

    const shared = sum.shared;
    const sharedRow = shared.count ? `
      <div class="pc-shared">
        <div><b>Shared</b><small>${shared.count} ${shared.count === 1 ? 'cost' : 'costs'}</small></div>
        <div class="pcs-meta">${Object.entries(shared.parts).map(([pid, amount]) => `${W.escapeHtml(W.personName(pid) || '—')} <em>${W.money(amount)}</em>`).join(' · ') || 'Split equally'}</div>
        <span class="pcs-net">${W.money(-shared.spent, { signed: true })}</span>
      </div>` : '';

    $('peopleBody').innerHTML = rows + axis + sharedRow + `
      <div class="pc-shared" style="border-top:1px solid var(--line);margin-top:7px">
        <div><b>Household</b><small>${state.transactions.length} transactions</small></div>
        <div class="pcs-meta">${W.money(sum.expense)} spent · ${W.money(sum.income)} earned</div>
        <span class="pcs-net">${W.money(sum.net, { signed: true })}</span>
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
    const expenses = total;
    $('rankSub').textContent = mode === 'tags'
      ? `${rangeLongLabel(state.range)} · A transaction with two tags counts twice`
      : `${rangeLongLabel(state.range)} · ${W.money(expenses)} spent`;
    $('rankNote').innerHTML = mode === 'tags'
      ? 'Tags overlap, so these totals are not additive. Select a tag to hide it from the breakdown.'
      : 'Select a row to hide it from the breakdown. The hero total does not change.';

    if (!shown.length) {
      $('categoryRank').innerHTML = `<div class="empty"><span class="eic">${W.icon('tag')}</span><b>Nothing to rank yet</b><span>Expenses will appear here by ${mode === 'tags' ? 'tag' : 'category'} once the range has some.</span></div>`;
      $('categoryShare').innerHTML = '';
      return;
    }

    $('categoryRank').innerHTML = shown.map(([name, amount], index) => {
      const off = hidden.has(name);
      const pct = expenses > 0 ? (amount / expenses) * 100 : 0;
      const color = mode === 'tags'
        ? `hsl(${(index * 41 + 8) % 360} 46% 58%)`
        : W.categoryColor(name);
      return `<div class="rank ${off ? 'off' : ''}" style="--c:${color}">
        <span class="rdot" aria-hidden="true"></span>
        <span class="rname">${W.escapeHtml(name)}</span>
        <span class="rbar" aria-hidden="true"><i style="width:${Math.max(3, (amount / max) * 100).toFixed(1)}%"></i></span>
        <span class="ramt">${W.money(amount)}</span>
        <span class="rpct">${pct.toFixed(pct < 10 ? 1 : 0)}%</span>
        <button type="button" class="reye" data-hide="${W.escapeHtml(name)}" aria-label="${off ? 'Show' : 'Hide'} ${W.escapeHtml(name)} in the breakdown" aria-pressed="${off}">${W.icon(off ? 'eyeOff' : 'eye')}</button>
      </div>`;
    }).join('');

    $('categoryRank').querySelectorAll('[data-hide]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.hide;
        if (hidden.has(name)) hidden.delete(name); else hidden.add(name);
        renderRank();
      });
    });

    const palette = shown.map(([name], index) => mode === 'tags' ? `hsl(${(index * 41 + 8) % 360} 46% 58%)` : W.categoryColor(name));
    const visible = shown.filter(([name]) => !hidden.has(name));
    const visibleTotal = visible.reduce((sum, [, v]) => sum + v, 0) || 1;
    $('categoryShare').innerHTML = visible.map(([name], i) => `<i style="--c:${palette[shown.findIndex(([n]) => n === name)]};width:${((shown.find(([n]) => n === name)?.[1] || 0) / visibleTotal * 100).toFixed(2)}%"></i>`).join('');
    $('categoryShare').hidden = mode === 'tags';
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

    $('insights').innerHTML = facts.slice(0, 3).map((f) => `
      <div class="fact-row">
        <span class="fact-ic">${W.icon(f.icon)}</span>
        <div><div class="fact-t">${f.title}</div><div class="fact-d">${f.detail}</div></div>
      </div>`).join('');
  }

  function renderRecent() {
    const txs = [...scopeTransactions()].sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_date || '').localeCompare(String(a.created_date || ''))).slice(0, 5);
    $('recentSub').textContent = txs.length ? `${txs.length} of ${scopeTransactions().length} entries` : 'The last few entries';
    if (!txs.length) {
      $('recentList').innerHTML = `<div class="empty"><span class="eic">${W.icon('transactions')}</span><b>No recent entries</b><span>Add a transaction and it will appear here.</span></div>`;
      return;
    }
    $('recentList').innerHTML = txs.map((t) => {
      const owner = W.ownerLabel(t);
      const meta = [t.category, owner].filter(Boolean).join(' · ');
      return `<a class="rec-row" href="/transactions.html?focus=${encodeURIComponent(t.id)}">
        <span class="rec-ic">${W.categoryIcon(t.category)}</span>
        <span class="rec-t"><b>${W.escapeHtml(t.name || t.category)}</b><small>${W.escapeHtml(meta)}</small></span>
        <span class="rec-a ${t.type === 'income' ? 'in' : ''}">${W.money(t.amount, { signed: true, sign: t.type === 'income' ? '+' : '−' })}</span>
        <span class="rec-day">${W.shortDate(t.date)}</span>
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
    $('rangeShortcut').setAttribute('aria-label', 'Choose date range');
    $('rangeShortcut').addEventListener('click', () => openRange($('rangeShortcut')));
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
