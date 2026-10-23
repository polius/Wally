(() => {
  const MANAGED_TAGS = new Set([
    'urgent', 'monthly', 'recurring', 'gift', 'bonus', 'vacation', 'subscription',
    'online', 'special', 'daily', 'fun', 'salary',
  ]);

  const LANGUAGES = [
    { value: 'en', label: 'English', detail: 'English' },
    { value: 'ca', label: 'Català', detail: 'Catalan' },
    { value: 'de', label: 'Deutsch', detail: 'German' },
    { value: 'es', label: 'Español', detail: 'Spanish' },
    { value: 'fr', label: 'Français', detail: 'French' },
    { value: 'hi', label: 'हिन्दी', detail: 'Hindi' },
    { value: 'it', label: 'Italiano', detail: 'Italian' },
    { value: 'ja', label: '日本語', detail: 'Japanese' },
    { value: 'ko', label: '한국어', detail: 'Korean' },
    { value: 'pt', label: 'Português', detail: 'Portuguese' },
    { value: 'ru', label: 'Русский', detail: 'Russian' },
    { value: 'zh', label: '中文', detail: 'Chinese' },
    { value: 'ar', label: 'العربية', detail: 'Arabic' },
  ];

  const state = {
    section: 'general',
    all: [],
    month: [],
    rules: [],
    keys: [],
    loginEnabled: false,
    editCats: false,
    editTags: false,
    selectedCats: new Set(),
    selectedTags: new Set(),
    importStatus: '',
    loaded: false,
  };

  const $ = (id) => document.getElementById(id);

  function languageLabel(code) {
    return LANGUAGES.find((l) => l.value === code)?.label || code;
  }

  function destinationList() {
    const list = [
      { id: 'general', label: 'General', icon: 'sliders' },
    ];
    if (W.hasPeople()) list.push({ id: 'people', label: 'People', icon: 'people' });
    list.push(
      { id: 'categories', label: 'Categories & tags', icon: 'tag' },
      { id: 'recurring', label: 'Recurring', icon: 'repeat' },
      { id: 'data', label: 'Data', icon: 'swap' },
      { id: 'access', label: 'Access', icon: 'key' },
      { id: 'about', label: 'About', icon: 'info' },
    );
    return list;
  }

  function railValue(id) {
    if (id === 'general') {
      const theme = localStorage.getItem('theme') || 'system';
      return `${theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'} · ${W.state.currency.name} · ${languageLabel(i18n.locale)}`;
    }
    if (id === 'people') {
      const names = W.state.people.map((p) => p.name);
      return names.length ? `${names.slice(0, 2).join(' · ')}${names.length > 2 ? ` +${names.length - 2}` : ''}` : 'Not used';
    }
    if (id === 'categories') return `${W.state.categories.length} categories · ${W.state.tags.length} tags`;
    if (id === 'recurring') return state.rules.length ? `${state.rules.length} ${state.rules.length === 1 ? 'rule' : 'rules'}` : 'No rules';
    if (id === 'data') return 'Import and export';
    if (id === 'access') return state.loginEnabled ? 'Password on · API keys' : 'No password · API keys';
    if (id === 'about') return `Version ${W.state.version}`;
    return '';
  }

  function renderRail() {
    const rail = $('settingsRail');
    const destinations = destinationList();
    rail.innerHTML = destinations.map((d) => `
      <a class="item ${state.section === d.id ? 'on' : ''}" href="#${d.id}" data-section="${d.id}" ${state.section === d.id ? 'aria-current="page"' : ''}>
        <span class="sic">${W.icon(d.icon)}</span>
        <span class="rail-l"><span class="rail-name">${d.label}</span><small class="rail-val">${W.escapeHtml(railValue(d.id))}</small></span>
        <span class="rail-chev" aria-hidden="true">${W.icon('chevronRight')}</span>
      </a>`).join('');
    rail.querySelectorAll('[data-section]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        location.hash = link.dataset.section;
      });
    });
  }

  function isSmall() {
    return window.matchMedia('(max-width: 860px)').matches;
  }

  function showSection(id, { scroll = true } = {}) {
    const destinations = destinationList();
    const requested = destinations.some((d) => d.id === id) ? id : null;
    const active = requested || 'general';
    const detail = !isSmall() || Boolean(requested);
    state.section = active;
    const root = document.querySelector('.settings');
    root?.classList.toggle('detail', detail);
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.classList.toggle('on', detail && panel.dataset.panel === active);
    });
    document.querySelectorAll('#settingsRail [data-section]').forEach((link) => {
      link.classList.toggle('on', detail && link.dataset.section === active);
      if (detail && link.dataset.section === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    document.title = `${requested ? destinations.find((d) => d.id === requested)?.label : 'Settings'} · Wally`;
    if (scroll && isSmall() && requested) {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  /* ------------------------------ data ------------------------------ */
  async function loadAll() {
    await W.loadCore(true);
    const [all, rules, keys, loginEnabled] = await Promise.all([
      W.api('/transactions'),
      W.api('/recurring'),
      W.api('/api-keys').catch(() => []),
      W.api('/login/check').catch(() => false),
    ]);
    state.all = all;
    state.rules = rules;
    W.state.recurring = rules;
    state.keys = keys;
    state.loginEnabled = Boolean(loginEnabled);
    const now = new Date();
    state.month = W.monthTransactions(all, now);
    state.loaded = true;
    renderAll();
  }

  function renderAll() {
    renderRail();
    renderGeneral();
    renderPeople();
    renderTokens('categories');
    renderTokens('tags');
    renderRules();
    renderData();
    renderAccess();
    renderAbout();
    showSection(location.hash.replace('#', ''), { scroll: false });
  }

  function categoryCounts() {
    const counts = new Map();
    for (const t of state.all) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    return counts;
  }

  function tagCounts() {
    const counts = new Map();
    for (const t of state.all) {
      for (const tag of t.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    return counts;
  }

  /* ----------------------------- general ---------------------------- */
  function renderGeneral() {
    const preference = localStorage.getItem('theme') || 'system';
    const themeChoices = [...document.querySelectorAll('[data-theme-choice]')];
    themeChoices.forEach((button, index) => {
      const on = button.dataset.themeChoice === preference;
      button.classList.toggle('on', on);
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
      button.onclick = () => {
        W.setTheme(button.dataset.themeChoice);
        renderGeneral();
      };
      button.onkeydown = (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
        const next = themeChoices[(index + step + themeChoices.length) % themeChoices.length];
        next.focus();
        next.click();
      };
    });

    $('currencyValue').textContent = `${W.state.currency.name} · ${W.state.currency.symbol}`;
    $('currencyPositionValue').textContent = W.state.currency.position === 'left' ? 'Before' : 'After';
    $('languageValue').textContent = languageLabel(i18n.locale);
    $('categoryRowSub').textContent = `${W.state.categories.length} categories · ${state.month.length} transactions this month`;
    $('tagRowSub').textContent = `${W.state.tags.length} tags · filter chips on transactions`;
    if (W.hasPeople()) {
      const names = W.state.people.map((p) => p.name);
      $('peopleRowValue').textContent = names.length <= 2 ? names.join(' & ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
      $('peopleRowSub').textContent = 'Shared costs, splits and balances.';
    } else {
      $('peopleRowValue').textContent = 'Not used';
      $('peopleRowSub').textContent = 'Add someone to split a cost.';
    }

    const owner = W.defaultOwner();
    $('ownerDefaultValue').textContent = !W.hasPeople()
      ? 'No people yet'
      : owner === 'shared'
        ? 'Shared'
        : W.personName(owner) || 'First person';

    $('currencyRow').onclick = openCurrencyDialog;
    $('currencyPositionRow').onclick = openCurrencyPositionDialog;
    $('languageRow').onclick = openLanguageDialog;
    $('manageCategoriesRow').onclick = () => { location.hash = 'categories'; };
    $('manageTagsRow').onclick = () => { location.hash = 'categories'; };
    $('peopleRow').onclick = () => {
      if (W.hasPeople()) location.hash = 'people';
      else addPerson();
    };
    $('ownerDefaultRow').onclick = openOwnerDefault;
    $('ownerDefaultReset').onclick = () => {
      W.setDefaultOwner(null);
      renderGeneral();
      W.toast('New transactions will start with the first person.');
    };
    const generalValue = document.querySelector('#settingsRail [data-section="general"] .rail-val');
    if (generalValue) generalValue.textContent = railValue('general');
  }

  async function openCurrencyDialog() {
    let data;
    try {
      data = await W.api('/currency');
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
      return;
    }
    const body = `
      <label class="field"><span class="flabel">Currency</span>
        <select class="input" id="currencySelect">
          ${data.currencies.map((c) => `<option value="${W.escapeHtml(c.name)}" ${c.name === data.selected ? 'selected' : ''}>${W.escapeHtml(c.name)} · ${W.escapeHtml(c.symbol)}</option>`).join('')}
        </select>
      </label>
      <label class="field"><span class="flabel">Symbol position</span>
        <select class="input" id="currencyPosition">
          <option value="left" ${data.position === 'left' ? 'selected' : ''}>Before the amount — ${W.escapeHtml(data.currencies.find((c) => c.name === data.selected)?.symbol || '')}12.34</option>
          <option value="right" ${data.position === 'right' ? 'selected' : ''}>After the amount — 12.34 ${W.escapeHtml(data.currencies.find((c) => c.name === data.selected)?.symbol || '')}</option>
        </select>
      </label>
      <p class="card-note">Existing amounts are not converted. Only the symbol and its position change.</p>`;
    const result = await W.dialog({
      title: 'Currency',
      description: 'One currency for the whole ledger.',
      body,
      confirmLabel: 'Save',
      onConfirm: async (el) => {
        const name = el.querySelector('#currencySelect').value;
        const position = el.querySelector('#currencyPosition').value;
        if (name !== W.state.currency.name) await W.api(`/currency/${encodeURIComponent(name)}`, { method: 'PUT' });
        if (position !== W.state.currency.position) await W.api(`/currency/position/${position}`, { method: 'PUT' });
        return true;
      },
    });
    if (result) {
      await W.loadCore(true);
      renderGeneral();
      W.toast('Currency updated.');
    }
  }

  async function openCurrencyPositionDialog() {
    const current = W.state.currency.position;
    const result = await W.choiceDialog({
      title: 'Symbol position',
      description: 'Where the currency symbol sits in an amount.',
      options: [
        { value: 'left', label: 'Before the amount', detail: `${W.state.currency.symbol}12.34` },
        { value: 'right', label: 'After the amount', detail: `12.34 ${W.state.currency.symbol}` },
      ],
      value: current,
      confirmLabel: 'Use position',
    });
    if (!result || result === current) return;
    try {
      await W.api(`/currency/position/${result}`, { method: 'PUT' });
      await W.loadCore(true);
      renderGeneral();
      W.toast('Symbol position updated.');
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  async function openLanguageDialog() {
    const result = await W.choiceDialog({
      title: 'Language',
      description: 'Existing translations are kept. New labels fall back to English.',
      options: LANGUAGES,
      value: i18n.locale,
      confirmLabel: 'Use language',
    });
    if (!result || result === i18n.locale) return;
    await i18n.setLanguage(result);
    renderGeneral();
    W.toast('Language updated.');
  }

  async function openOwnerDefault() {
    if (!W.hasPeople()) {
      addPerson();
      return;
    }
    const current = W.defaultOwner();
    const options = W.state.people.map((p) => ({ value: p.id, label: p.name, detail: p.is_self ? 'This browser' : 'Person' }));
    if (W.state.people.length >= 2) options.push({ value: 'shared', label: 'Shared', detail: 'Start with a split' });
    const result = await W.choiceDialog({
      title: 'Default owner',
      description: 'The owner a new transaction starts with on this browser.',
      options,
      value: current,
      confirmLabel: 'Use owner',
    });
    if (!result) return;
    W.setDefaultOwner(result);
    renderGeneral();
    W.toast('Default owner set for this browser.');
  }

  /* ------------------------------ people ---------------------------- */
  function sharedRow() {
    return W.summarise(state.month);
  }

  function renderPeople() {
    const list = $('peopleList');
    $('peopleCount').textContent = W.hasPeople()
      ? `${W.state.people.length} ${W.state.people.length === 1 ? 'person' : 'people'} · ${state.month.length} transactions this month`
      : 'No people yet';

    if (!W.hasPeople()) {
      list.innerHTML = `<div class="empty" style="padding:26px 18px">
        <span class="eic">${W.icon('people')}</span>
        <b>A ledger for one</b>
        <span>Add someone when a cost is shared. People are real owners, never tags.</span>
        <button type="button" class="btn primary sm" id="emptyAddPerson" style="margin-top:8px">Add the first person</button>
      </div>`;
      list.querySelector('#emptyAddPerson')?.addEventListener('click', addPerson);
      $('householdSub').textContent = '—';
      $('householdNet').textContent = '—';
      $('peopleNotice').innerHTML = '';
      return;
    }

    const sum = sharedRow();
    const rows = W.state.people.map((person) => {
      const row = sum.perPerson[person.id] || { spent: 0, earned: 0, net: 0, shares: 0, count: 0 };
      return `<div class="person-row">
        ${W.avatar(person)}
        <button type="button" class="pn-wrap" data-edit-person="${person.id}">
          <span class="pn">${W.escapeHtml(person.name)}</span>
          <span class="ps">${person.is_self ? 'This browser' : 'Person'} · ${row.count} ${row.count === 1 ? 'transaction' : 'transactions'}</span>
        </button>
        <span class="pval ${row.net - row.shares > 0 ? 'pos' : row.net - row.shares < 0 ? 'muted' : ''}">${W.money(row.net - row.shares, { signed: true, plus: true })}</span>
        <button type="button" class="icon-btn small" data-delete-person="${person.id}" aria-label="Delete ${W.escapeHtml(person.name)}">${W.icon('trash')}</button>
      </div>`;
    }).join('');

    const shared = sum.shared;
    const partEntries = Object.entries(shared.parts);
    const equalParts = partEntries.length > 1 && partEntries.every(([, amount]) => Math.abs(amount - partEntries[0][1]) < 0.01);
    const splitNote = equalParts
      ? `${W.money(partEntries[0][1])} each`
      : partEntries.map(([pid, amount]) => `${W.personName(pid)} ${W.money(amount)}`).join(' · ');
    const sharedRowMarkup = shared.count ? `<div class="person-row shared-row">
      <span class="avatar-person shared">${W.icon('people')}</span>
      <span class="pn-wrap static">
        <span class="pn">Shared</span>
        <span class="ps">${shared.count} ${shared.count === 1 ? 'transaction' : 'transactions'}${splitNote ? ` · ${W.escapeHtml(splitNote)}` : ''}</span>
      </span>
      <span class="pval muted">${W.money(-shared.spent, { signed: true })}</span>
    </div>` : '';

    list.innerHTML = rows + sharedRowMarkup + `<button type="button" class="add-person-row" id="addPersonRow">+ Add person</button>`;
    list.querySelector('#addPersonRow')?.addEventListener('click', addPerson);
    list.querySelectorAll('[data-edit-person]').forEach((button) => {
      button.addEventListener('click', () => editPerson(button.dataset.editPerson));
    });
    list.querySelectorAll('[data-delete-person]').forEach((button) => {
      button.addEventListener('click', () => deletePerson(button.dataset.deletePerson));
    });

    const keptRate = sum.income > 0 ? (sum.net / sum.income) * 100 : 0;
    $('householdSub').textContent = `${state.month.length} transactions · ${keptRate.toFixed(1)}% of income kept`;
    $('householdNet').textContent = W.money(sum.net, { signed: true, plus: true });
    $('householdNet').style.color = sum.net >= 0 ? 'var(--positive)' : 'var(--danger)';

    renderMigration();
  }

  function renderMigration() {
    const notice = $('peopleNotice');
    if (!W.hasPeople() || !state.all.length) { notice.innerHTML = ''; return; }
    const counts = new Map();
    for (const t of state.all) {
      for (const tag of t.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
    }
    const threshold = Math.max(5, Math.ceil(state.all.length * 0.22));
    const candidate = [...counts.entries()]
      .filter(([tag, count]) => count >= threshold && !MANAGED_TAGS.has(tag.toLowerCase()) && !localStorage.getItem(`wally_dismiss_migrate_${tag}`))
      .sort((a, b) => b[1] - a[1])[0];
    if (!candidate) { notice.innerHTML = ''; return; }
    const [tag, count] = candidate;
    notice.innerHTML = `<div class="notice">
      <div class="nt">A tag might be a person</div>
      <div class="nd">“${W.escapeHtml(tag)}” follows ${count} of ${state.all.length} transactions. If it names someone, turn it into a person so it can own rows and carry a split. The tag is removed from those rows.</div>
      <div class="na">
        <button type="button" class="btn primary sm" id="migrateTag">Make ${W.escapeHtml(tag)} a person</button>
        <button type="button" class="btn ghost sm" id="dismissMigrate">Not a person</button>
      </div>
    </div>`;
    notice.querySelector('#migrateTag')?.addEventListener('click', async () => {
      const name = await W.promptDialog({
        title: 'Name this person',
        description: `“${tag}” will become a person and be removed from the tagged transactions.`,
        label: 'Name',
        value: tag.charAt(0).toUpperCase() + tag.slice(1),
        confirmLabel: 'Make person',
      });
      if (!name) return;
      try {
        await W.api('/people/from-tag', { method: 'POST', body: JSON.stringify({ tag, name }) });
        await loadAll();
        W.toast('Tag became a person.');
      } catch (error) {
        W.toast(error.message, { tone: 'danger' });
      }
    });
    notice.querySelector('#dismissMigrate')?.addEventListener('click', () => {
      localStorage.setItem(`wally_dismiss_migrate_${tag}`, '1');
      notice.innerHTML = '';
    });
  }

  async function addPerson() {
    const name = await W.promptDialog({
      title: 'Add person',
      description: 'A person can own transactions and take part in a shared split.',
      label: 'Name',
      placeholder: 'e.g. Alex',
      confirmLabel: 'Add person',
    });
    if (!name) return;
    try {
      const person = await W.api('/people', { method: 'POST', body: JSON.stringify({ name }) });
      await loadAll();
      if (!W.defaultOwner()) W.setDefaultOwner(person.id);
      W.toast(`${person.name} added.`);
      location.hash = 'people';
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  async function editPerson(id) {
    const person = W.state.people.find((p) => p.id === id);
    if (!person) return;
    const body = `
      <label class="field"><span class="flabel">Name</span><input class="input" id="personName" maxlength="60" value="${W.escapeHtml(person.name)}"></label>
      <label class="check"><input type="checkbox" id="personSelf" ${person.is_self ? 'checked' : ''}> Use this person as “this browser”</label>
      <p class="card-note">Renaming is safe. Transactions keep their owner; only the label changes.</p>`;
    const result = await W.dialog({
      title: 'Edit person',
      body,
      confirmLabel: 'Save',
      onConfirm: async (el) => {
        const name = el.querySelector('#personName').value.trim();
        if (!name) throw new Error('A person needs a name.');
        const makeSelf = el.querySelector('#personSelf').checked;
        if (name !== person.name || makeSelf !== person.is_self) {
          await W.api(`/people/${person.id}`, { method: 'PUT', body: JSON.stringify({ name, is_self: makeSelf }) });
        }
        return true;
      },
    });
    if (result) {
      await loadAll();
      W.toast('Person updated.');
    }
  }

  async function deletePerson(id) {
    const person = W.state.people.find((p) => p.id === id);
    if (!person) return;
    const ok = await W.confirmDialog({
      title: `Delete ${person.name}?`,
      message: 'Every transaction stays. Their rows become unowned, and a shared split loses their part. This cannot be undone.',
      confirmLabel: 'Delete person',
    });
    if (!ok) return;
    try {
      await W.api(`/people/${person.id}`, { method: 'DELETE' });
      if (W.defaultOwner() === person.id) W.setDefaultOwner(null);
      await loadAll();
      W.toast(`${person.name} removed.`);
      if (!W.hasPeople()) location.hash = 'general';
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  /* -------------------------- categories/tags ----------------------- */
  function renderTokens(kind) {
    const isCat = kind === 'categories';
    const container = isCat ? $('categoryTokens') : $('tagTokens');
    const counts = isCat ? categoryCounts() : tagCounts();
    const items = isCat ? W.state.categories : W.state.tags;
    const editing = isCat ? state.editCats : state.editTags;
    const selected = isCat ? state.selectedCats : state.selectedTags;
    const editButton = isCat ? $('editCategories') : $('editTags');
    const hint = isCat ? $('categoryHint') : $('tagHint');
    editButton.textContent = editing ? 'Done' : 'Edit';

    if (!items.length) {
      container.innerHTML = `<span class="card-note">Nothing here yet.</span>`;
      hint.textContent = isCat ? 'Tap a token to rename it.' : 'Tap a tag to rename it.';
      return;
    }

    container.innerHTML = items.map((name) => {
      const on = selected.has(name);
      return `<button type="button" class="token ${on ? 'sel' : ''}" data-kind="${kind}" data-name="${W.escapeHtml(name)}" ${editing ? `aria-pressed="${on}"` : `aria-label="Rename ${W.escapeHtml(name)}"`}>
        ${W.escapeHtml(name)} <span class="cnt">${counts.get(name) || 0}</span>
        ${editing && on ? `<span class="x" aria-hidden="true">${W.icon('check')}</span>` : ''}
      </button>`;
    }).join('');

    container.querySelectorAll('[data-name]').forEach((button) => {
      button.addEventListener('click', () => {
        const name = button.dataset.name;
        if (editing) {
          if (selected.has(name)) selected.delete(name); else selected.add(name);
          renderTokens(kind);
        } else {
          renameItem(kind, name);
        }
      });
    });

    if (editing && selected.size) {
      hint.innerHTML = `<b style="color:var(--ink)">${selected.size} selected</b> <button type="button" class="link danger" id="deleteTokens">Delete</button>`;
      hint.querySelector('#deleteTokens')?.addEventListener('click', () => deleteTokens(kind));
    } else if (editing) {
      hint.textContent = isCat ? 'Select categories to remove. A category in use stays.' : 'Select tags to remove. They leave every transaction.';
    } else {
      hint.textContent = isCat ? 'Tap a token to rename it.' : 'Tap a tag to rename it.';
    }
  }

  function toggleTokenEdit(kind) {
    if (kind === 'categories') {
      state.editCats = !state.editCats;
      state.selectedCats.clear();
    } else {
      state.editTags = !state.editTags;
      state.selectedTags.clear();
    }
    renderTokens(kind);
  }

  async function renameItem(kind, name) {
    const isCat = kind === 'categories';
    const next = await W.promptDialog({
      title: isCat ? 'Rename category' : 'Rename tag',
      description: isCat
        ? 'Transactions and recurring rules that use it move with the name.'
        : 'Transactions and recurring rules that carry it move with the name.',
      label: 'Name',
      value: name,
      confirmLabel: 'Rename',
    });
    if (!next || next === name) return;
    try {
      await W.api(`/${isCat ? 'categories' : 'tags'}/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify({ name: next }),
      });
      await loadAll();
      W.toast(`${name} renamed to ${next}.`);
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  async function addToken(kind) {
    const isCat = kind === 'categories';
    const name = await W.promptDialog({
      title: isCat ? 'Add category' : 'Add tag',
      label: 'Name',
      placeholder: isCat ? 'e.g. Education' : 'e.g. reimbursable',
      confirmLabel: 'Add',
    });
    if (!name) return;
    try {
      await W.api(`/${isCat ? 'categories' : 'tags'}`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      await loadAll();
      W.toast(`${name} added.`);
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  async function deleteTokens(kind) {
    const isCat = kind === 'categories';
    const selected = isCat ? state.selectedCats : state.selectedTags;
    const names = [...selected];
    if (!names.length) return;
    const ok = await W.confirmDialog({
      title: `Delete ${names.length} ${names.length === 1 ? (isCat ? 'category' : 'tag') : (isCat ? 'categories' : 'tags')}?`,
      message: isCat
        ? 'Categories still used by a transaction or rule cannot be removed. Wally will keep those and report them.'
        : 'Tags are removed from every transaction and recurring rule that carries them. The transactions stay.',
      confirmLabel: 'Delete',
    });
    if (!ok) return;
    const failures = [];
    for (const name of names) {
      try {
        await W.api(`/${isCat ? 'categories' : 'tags'}/${encodeURIComponent(name)}`, { method: 'DELETE' });
      } catch (error) {
        failures.push(name);
      }
    }
    selected.clear();
    await loadAll();
    if (failures.length) {
      W.toast(`${failures.length} could not be removed because they are still in use.`, { tone: 'danger' });
    } else {
      W.toast(`${names.length} removed.`);
    }
  }

  /* ----------------------------- recurring -------------------------- */
  function advanceDate(date, frequency) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    if (frequency === 'daily') next.setDate(next.getDate() + 1);
    else if (frequency === 'weekly') next.setDate(next.getDate() + 7);
    else if (frequency === 'monthly') {
      const day = next.getDate();
      next.setDate(1);
      next.setMonth(next.getMonth() + 1);
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
    } else {
      const day = next.getDate();
      next.setDate(1);
      next.setFullYear(next.getFullYear() + 1);
      next.setMonth(date.getMonth());
      const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(day, last));
    }
    return next;
  }

  function nextOccurrence(rule) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = W.parseDate(rule.endDate);
    let cursor = W.parseDate(rule.startDate);
    if (end < today) return null;
    for (let i = 0; i < 5000 && cursor < today; i += 1) cursor = advanceDate(cursor, rule.frequency);
    if (cursor > end) return null;
    return cursor;
  }

  function frequencyLabel(frequency) {
    return { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[frequency] || frequency;
  }

  function renderRules() {
    const active = state.rules.filter((r) => W.parseDate(r.endDate) >= new Date()).length;
    $('rulesCount').textContent = state.rules.length
      ? `${state.rules.length} ${state.rules.length === 1 ? 'rule' : 'rules'} · ${active} active`
      : 'No rules yet';

    if (!state.rules.length) {
      $('rulesList').innerHTML = `<div class="empty" style="padding:28px 18px">
        <span class="eic">${W.icon('repeat')}</span>
        <b>Nothing repeats yet</b>
        <span>A rule writes occurrences on its own. Rent, a salary, a subscription.</span>
        <button type="button" class="btn primary sm" id="emptyAddRule" style="margin-top:8px">Add a rule</button>
      </div>`;
      $('rulesList').querySelector('#emptyAddRule')?.addEventListener('click', () => openRuleDialog());
      return;
    }

    $('rulesList').innerHTML = state.rules.map((rule) => {
      const next = nextOccurrence(rule);
      const owner = rule.person_id ? W.personName(rule.person_id) : 'No owner';
      return `<button type="button" class="wrule" data-rule="${rule.id}">
        <span class="ric">${W.icon('repeat')}</span>
        <span>
          <span class="rn">${W.escapeHtml(rule.name || rule.category)}</span>
          <span class="rs">${frequencyLabel(rule.frequency)} · ${next ? `next ${W.shortDate(next)}` : 'ended'} · ${W.escapeHtml(owner)}</span>
        </span>
        <span class="ra" style="${rule.type === 'income' ? 'color:var(--positive)' : ''}">${W.money(rule.amount, { signed: true, sign: rule.type === 'income' ? '+' : '−' })}</span>
        <span class="rmore" aria-hidden="true">${W.icon('chevronRight')}</span>
      </button>`;
    }).join('');

    $('rulesList').querySelectorAll('[data-rule]').forEach((button) => {
      button.addEventListener('click', () => openRuleDialog(state.rules.find((r) => r.id === button.dataset.rule)));
    });
  }

  function openRuleDialog(rule = null) {
    const categories = [...new Set([...(W.state.categories || []), rule?.category].filter(Boolean))];
    const tags = [...new Set([...(W.state.tags || []), ...(rule?.tags || [])])];
    const today = new Date();
    const defaultEnd = W.dateISO(W.addYears(today, 1));
    const defaultPerson = rule ? rule.person_id : (W.defaultOwner() === 'shared' ? null : W.defaultOwner());
    const body = `
      <label class="field"><span class="flabel">Name</span><input class="input" id="ruleName" maxlength="80" value="${W.escapeHtml(rule?.name || '')}" placeholder="e.g. Rent"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span class="flabel">Amount</span><input class="input" id="ruleAmount" inputmode="decimal" value="${rule ? Number(rule.amount).toFixed(2) : ''}" placeholder="0.00"></label>
        <label class="field"><span class="flabel">Type</span><select class="input" id="ruleType"><option value="expense" ${rule?.type !== 'income' ? 'selected' : ''}>Expense</option><option value="income" ${rule?.type === 'income' ? 'selected' : ''}>Income</option></select></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span class="flabel">Category</span><select class="input" id="ruleCategory">${categories.map((c) => `<option value="${W.escapeHtml(c)}" ${c === rule?.category ? 'selected' : ''}>${W.escapeHtml(c)}</option>`).join('')}</select></label>
        <label class="field"><span class="flabel">Repeats</span><select class="input" id="ruleFrequency">${['daily', 'weekly', 'monthly', 'yearly'].map((f) => `<option value="${f}" ${(rule?.frequency || 'monthly') === f ? 'selected' : ''}>${frequencyLabel(f)}</option>`).join('')}</select></label>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span class="flabel">Starts</span><input class="input" type="date" id="ruleStart" value="${rule?.startDate || W.dateISO(today)}" ${rule ? 'disabled' : ''}></label>
        <label class="field"><span class="flabel">Ends</span><input class="input" type="date" id="ruleEnd" value="${rule?.endDate || defaultEnd}"></label>
      </div>
      ${W.hasPeople() ? `<label class="field"><span class="flabel">Owner</span><select class="input" id="rulePerson"><option value="">No owner</option>${W.state.people.map((p) => `<option value="${p.id}" ${defaultPerson === p.id ? 'selected' : ''}>${W.escapeHtml(p.name)}</option>`).join('')}</select></label>` : ''}
      <div class="field"><span class="flabel">Tags</span><div class="chips" id="ruleTags">${tags.map((tag) => `<button type="button" class="chip2 ${rule?.tags?.includes(tag) ? 'on' : ''}" data-rule-tag="${W.escapeHtml(tag)}">${W.escapeHtml(tag)}</button>`).join('') || '<span class="card-note">No tags yet. Add them in Categories &amp; tags.</span>'}</div></div>
      ${rule ? `<label class="field"><span class="flabel">Apply changes to</span><select class="input" id="ruleApply"><option value="future">Future occurrences</option><option value="all">Every occurrence</option></select></label>` : ''}
      ${rule ? `<button type="button" class="danger-link" id="deleteRuleButton">${W.icon('trash')} Delete this rule</button>` : ''}`;

    const pending = W.dialog({
      title: rule ? 'Edit rule' : 'Add rule',
      description: rule ? 'The start date is fixed. Changes can leave the past alone.' : 'A rule writes its own rows from the start date until the end date.',
      body,
      confirmLabel: rule ? 'Save' : 'Add rule',
      onConfirm: async (el) => {
        const name = el.querySelector('#ruleName').value.trim();
        const amount = W.parseAmount(el.querySelector('#ruleAmount').value);
        const category = el.querySelector('#ruleCategory').value;
        const type = el.querySelector('#ruleType').value;
        const frequency = el.querySelector('#ruleFrequency').value;
        const start = rule?.startDate || el.querySelector('#ruleStart').value;
        const end = el.querySelector('#ruleEnd').value;
        const person = el.querySelector('#rulePerson')?.value || null;
        const selectedTags = [...el.querySelectorAll('[data-rule-tag].on')].map((b) => b.dataset.ruleTag);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter an amount above zero.');
        if (!category) throw new Error('Choose a category.');
        if (!end) throw new Error('Choose an end date.');
        if (W.parseDate(end) <= W.parseDate(start)) throw new Error('The end date must be after the start date.');
        const payload = { name, category, tags: selectedTags, amount, type, endDate: end, frequency, person_id: person };
        if (rule) {
          payload.applyTo = el.querySelector('#ruleApply').value;
          await W.api(`/recurring/${rule.id}`, { method: 'PUT', body: JSON.stringify(payload) });
        } else {
          payload.startDate = start;
          await W.api('/recurring', { method: 'POST', body: JSON.stringify(payload) });
        }
        return true;
      },
    });

    pending.then(async (result) => {
      if (result) {
        await loadAll();
        W.toast(rule ? 'Rule updated.' : 'Rule added.');
      }
    });

    setTimeout(() => {
      const deleteButton = document.querySelector('dialog.dialog[open] #deleteRuleButton');
      deleteButton?.addEventListener('click', async () => {
        const dialog = deleteButton.closest('dialog');
        dialog.close();
        setTimeout(() => dialog.remove(), 200);
        const applyTo = await W.choiceDialog({
          title: 'Delete this rule?',
          description: 'Choose what happens to the occurrences it already wrote.',
          options: [
            { value: 'future', label: 'Keep past occurrences', detail: 'Only future rows are removed. Past rows stay as one-offs.' },
            { value: 'all', label: 'Delete every occurrence', detail: 'Past and future rows created by this rule are removed.' },
          ],
          value: 'future',
          confirmLabel: 'Delete rule',
          danger: true,
        });
        if (!applyTo) return;
        try {
          await W.api(`/recurring/${rule.id}`, { method: 'DELETE', body: JSON.stringify({ applyTo }) });
          await loadAll();
          W.toast('Rule deleted.');
        } catch (error) {
          W.toast(error.message, { tone: 'danger' });
        }
      });
    }, 40);
  }

  /* ------------------------------- data ----------------------------- */
  function renderData() {
    const last = localStorage.getItem('wally_last_export');
    $('lastExport').textContent = last ? `Last export ${W.dateTimeLabel(last)}` : 'No export from this browser yet.';
    $('importStatus').innerHTML = state.importStatus;
  }

  async function exportAll() {
    try {
      if (!state.all.length) { W.toast('There is nothing to export yet.'); return; }
      const withPeople = W.hasPeople();
      const columns = ['name', 'category', 'tags', 'amount', 'type', 'date'];
      if (withPeople) columns.push('person');
      const rows = state.all.map((t) => ({
        name: t.name || '',
        category: t.category || '',
        tags: W.csv.tagsToCell(t.tags || []),
        amount: Number(t.amount).toFixed(2),
        type: t.type,
        date: t.date,
        person: t.person_id ? (W.personName(t.person_id) || '') : (W.sharesFor(t).length ? 'Shared' : ''),
      }));
      const stamp = W.dateISO(new Date());
      W.download(`wally-${stamp}.csv`, W.csv.stringify(rows, columns));
      localStorage.setItem('wally_last_export', new Date().toISOString());
      renderData();
      W.toast(`${rows.length} ${rows.length === 1 ? 'transaction' : 'transactions'} exported.`);
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  function normalizeDateCell(value) {
    const text = String(value ?? '').trim();
    if (!text) throw new Error('A date is required.');
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) throw new Error(`The date “${text}” could not be read.`);
    return W.dateISO(parsed);
  }

  async function importFile(file) {
    if (!file) return;
    state.importStatus = '<b>Reading the file…</b>';
    renderData();
    try {
      const text = await file.text();
      const parsed = W.csv.parse(text);
      const byLower = Object.fromEntries(parsed.headers.map((h) => [h.toLowerCase().trim(), h]));
      const get = (row, key) => {
        const header = byLower[key.toLowerCase()];
        return header === undefined ? '' : row[header];
      };
      if (!parsed.rows.length) throw new Error('The file has no data rows.');
      for (const required of ['date', 'name', 'amount']) {
        if (!(required in byLower)) throw new Error(`The file is missing the “${required}” column.`);
      }

      const peopleByName = new Map(W.state.people.map((p) => [p.name.toLowerCase(), p]));
      const unknownPeople = new Set();
      for (const row of parsed.rows) {
        const person = String(get(row, 'person') ?? '').trim();
        if (person && person.toLowerCase() !== 'shared' && !peopleByName.has(person.toLowerCase())) unknownPeople.add(person);
      }
      for (const name of unknownPeople) {
        try {
          const person = await W.api('/people', { method: 'POST', body: JSON.stringify({ name }) });
          peopleByName.set(person.name.toLowerCase(), person);
        } catch (error) {
          throw new Error(`Could not add “${name}”: ${error.message}`);
        }
      }

      const payload = parsed.rows.map((row, index) => {
        const line = index + 2;
        const name = String(get(row, 'name') ?? '').trim();
        const category = String(get(row, 'category') ?? '').trim() || 'Miscellaneous';
        const type = String(get(row, 'type') ?? 'expense').trim().toLowerCase() || 'expense';
        if (type !== 'expense' && type !== 'income') throw new Error(`Row ${line}: type must be expense or income.`);
        const amount = W.parseAmount(get(row, 'amount'));
        if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Row ${line}: the amount must be above zero.`);
        let person_id = null;
        const personCell = String(get(row, 'person') ?? '').trim();
        if (personCell && personCell.toLowerCase() !== 'shared') {
          const person = peopleByName.get(personCell.toLowerCase());
          if (!person) throw new Error(`Row ${line}: “${personCell}” is not a person.`);
          person_id = person.id;
        }
        return {
          name,
          category,
          tags: W.csv.cellToTags(get(row, 'tags')),
          amount,
          type,
          date: normalizeDateCell(get(row, 'date')),
          person_id,
          shares: [],
        };
      });

      state.importStatus = `<b>Importing ${payload.length} ${payload.length === 1 ? 'row' : 'rows'}…</b>`;
      renderData();
      const chunk = 400;
      for (let i = 0; i < payload.length; i += chunk) {
        await W.api('/transactions/import', { method: 'POST', body: JSON.stringify(payload.slice(i, i + chunk)) });
      }
      await loadAll();
      state.importStatus = `<b>${payload.length} ${payload.length === 1 ? 'row' : 'rows'} imported.</b> ${unknownPeople.size ? `${unknownPeople.size} ${unknownPeople.size === 1 ? 'person' : 'people'} created.` : ''} Dates, names, amounts and tags were read; person was matched by name.`;
      renderData();
      W.toast(`${payload.length} imported.`);
    } catch (error) {
      state.importStatus = `<b style="color:var(--danger)">Import stopped.</b> ${W.escapeHtml(error.message)}`;
      renderData();
      W.toast(error.message, { tone: 'danger' });
    }
  }

  /* ------------------------------ access ---------------------------- */
  function renderAccess() {
    const enabled = state.loginEnabled;
    $('loginStatus').textContent = enabled ? 'On' : 'Off';
    $('loginStatus').className = `status ${enabled ? 'ok' : 'off'}`;
    $('loginStatusSub').textContent = enabled
      ? 'A password is required. A session lasts up to a year on this browser.'
      : 'Anyone who can reach this host can open the ledger.';
    $('loginToggle').textContent = enabled ? 'Disable' : 'Enable';
    $('loginToggle').classList.toggle('ghost', enabled);

    const list = $('apiKeyList');
    if (!state.keys.length) {
      list.innerHTML = `<div class="set-row"><div class="l"><b>No keys yet</b><small>A key lets a script read and write the ledger without a browser session.</small></div></div>`;
    } else {
      list.innerHTML = state.keys.map((key) => `<div class="set-row">
        <div class="l"><b>${W.escapeHtml(key.id)}</b><small>Created ${W.dateTimeLabel(key.created_at)}</small></div>
        <span class="v">${key.last_used ? `Used ${W.dateTimeLabel(key.last_used)}` : 'Never used'}</span>
        <button type="button" class="icon-btn small" data-delete-key="${key.id}" aria-label="Delete key ${W.escapeHtml(key.id)}">${W.icon('trash')}</button>
      </div>`).join('');
      list.querySelectorAll('[data-delete-key]').forEach((button) => {
        button.addEventListener('click', async () => {
          const ok = await W.confirmDialog({
            title: 'Delete API key?',
            message: 'Any script using this key stops working immediately.',
            confirmLabel: 'Delete key',
          });
          if (!ok) return;
          try {
            await W.api(`/api-keys/${encodeURIComponent(button.dataset.deleteKey)}`, { method: 'DELETE' });
            state.keys = await W.api('/api-keys');
            renderAccess();
            W.toast('Key deleted.');
          } catch (error) {
            W.toast(error.message, { tone: 'danger' });
          }
        });
      });
    }
    $('addKeyButton').disabled = state.keys.length >= 3;
    $('addKeyButton').title = state.keys.length >= 3 ? 'Three keys is the limit.' : '';
  }

  function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch { /* no clipboard */ }
    area.remove();
    return Promise.resolve();
  }

  async function toggleLogin() {
    if (state.loginEnabled) {
      const ok = await W.confirmDialog({
        title: 'Disable login?',
        message: 'Anyone who can reach this host will be able to read and change the ledger. The session on this browser ends.',
        confirmLabel: 'Disable login',
      });
      if (!ok) return;
      try {
        await W.api('/login/password', { method: 'POST', body: JSON.stringify({ password: '' }) });
        await W.api('/logout', { method: 'POST' });
        location.assign('/');
      } catch (error) {
        W.toast(error.message, { tone: 'danger' });
      }
      return;
    }

    const result = await W.dialog({
      title: 'Enable login',
      description: 'A password protects this ledger on every device that can reach it.',
      body: `<label class="field"><span class="flabel">Password</span><input class="input" type="password" id="newLoginPassword" autocomplete="new-password"></label>
        <label class="field"><span class="flabel">Repeat password</span><input class="input" type="password" id="newLoginPassword2" autocomplete="new-password"></label>
        <p class="card-note">There is no email reset. A recovery file on the host is the way back in.</p>`,
      confirmLabel: 'Enable login',
      onConfirm: async (el) => {
        const password = el.querySelector('#newLoginPassword').value;
        const repeat = el.querySelector('#newLoginPassword2').value;
        if (password.length < 4) throw new Error('Use at least four characters.');
        if (password !== repeat) throw new Error('The passwords do not match.');
        await W.api('/login/password', { method: 'POST', body: JSON.stringify({ password }) });
        await W.api('/login', { method: 'POST', body: JSON.stringify({ password }) });
        state.loginEnabled = true;
        await loadAll();
        return true;
      },
    });
    if (result) W.toast('Login enabled.');
  }

  async function changePassword() {
    const result = await W.dialog({
      title: state.loginEnabled ? 'Change password' : 'Set a password',
      description: state.loginEnabled ? 'Rotate the password without touching the ledger.' : 'Setting a password also turns login on.',
      body: `<label class="field"><span class="flabel">New password</span><input class="input" type="password" id="changePassword" autocomplete="new-password"></label>
        <label class="field"><span class="flabel">Repeat password</span><input class="input" type="password" id="changePassword2" autocomplete="new-password"></label>`,
      confirmLabel: 'Save password',
      onConfirm: async (el) => {
        const password = el.querySelector('#changePassword').value;
        const repeat = el.querySelector('#changePassword2').value;
        if (password.length < 4) throw new Error('Use at least four characters.');
        if (password !== repeat) throw new Error('The passwords do not match.');
        await W.api('/login/password', { method: 'POST', body: JSON.stringify({ password }) });
        await W.api('/login', { method: 'POST', body: JSON.stringify({ password }) });
        state.loginEnabled = true;
        return true;
      },
    });
    if (result) {
      renderAccess();
      W.toast('Password changed.');
    }
  }

  async function recoverPassword() {
    const ok = await W.confirmDialog({
      title: 'Generate a recovery password?',
      message: 'Wally writes a single-use password to /wally/password.txt on the host. Sign in with it, and the file is deleted. Anyone who can read that file can enter this ledger.',
      confirmLabel: 'Generate file',
    });
    if (!ok) return;
    try {
      const response = await W.api('/login/recover', { method: 'POST' });
      await W.dialog({
        title: 'Recovery file written',
        description: 'One use, then it is gone.',
        body: `<p class="dialog-message">Open the file on the host and copy the password.</p>
          <div class="keybox">${W.escapeHtml(response.file || '/wally/password.txt')}</div>
          <p class="card-note">The next successful sign-in deletes the file. If you do not use it, generate another to replace it.</p>`,
        confirmLabel: 'Done',
        cancelLabel: 'Close',
      });
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  async function createKey() {
    if (state.keys.length >= 3) {
      W.toast('Three keys is the limit. Delete one first.', { tone: 'danger' });
      return;
    }
    try {
      const created = await W.api('/api-keys', { method: 'POST' });
      state.keys = await W.api('/api-keys');
      renderAccess();
      await W.dialog({
        title: 'API key created',
        description: 'Copy it now. Wally keeps only a hash.',
        body: `<p class="dialog-message">Use it as a bearer token against the API.</p>
          <div class="keybox" id="newKeyValue">${W.escapeHtml(created.key)}</div>
          <p class="card-note">This is the only time the key is shown.</p>`,
        confirmLabel: 'Copy and close',
        cancelLabel: 'Close',
        onConfirm: async () => {
          await copyText(created.key);
          W.toast('Key copied.');
          return true;
        },
      });
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  async function logout() {
    const ok = await W.confirmDialog({
      title: 'Log out?',
      message: 'The session on this browser ends. The ledger stays where it is.',
      confirmLabel: 'Log out',
    });
    if (!ok) return;
    try {
      await W.api('/logout', { method: 'POST' });
      location.assign('/login');
    } catch {
      location.assign('/login');
    }
  }

  /* ------------------------------ about ----------------------------- */
  function renderAbout() {
    $('aboutVersion').textContent = W.state.version;
    $('versionPill').textContent = `v${W.state.version}`;
  }

  /* ------------------------------- bind ----------------------------- */
  function bind() {
    $('editCategories').onclick = () => toggleTokenEdit('categories');
    $('editTags').onclick = () => toggleTokenEdit('tags');
    $('addCategory').onclick = () => addToken('categories');
    $('addTag').onclick = () => addToken('tags');
    $('addPersonButton')?.addEventListener('click', addPerson);
    $('addRuleButton').onclick = () => openRuleDialog();
    $('exportButton').onclick = exportAll;

    const drop = $('dropZone');
    drop.onclick = () => $('csvFile').click();
    drop.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        $('csvFile').click();
      }
    };
    drop.ondragover = (event) => { event.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = (event) => {
      event.preventDefault();
      drop.classList.remove('over');
      importFile(event.dataTransfer.files?.[0]);
    };
    $('csvFile').onchange = (event) => {
      importFile(event.target.files?.[0]);
      event.target.value = '';
    };

    $('loginToggle').onclick = toggleLogin;
    $('changePasswordRow').onclick = changePassword;
    $('recoverRow').onclick = recoverPassword;
    $('logoutRow').onclick = logout;
    $('addKeyButton').onclick = createKey;

    window.addEventListener('hashchange', () => {
      showSection(location.hash.replace('#', ''));
    });
    window.addEventListener('resize', () => {
      showSection(location.hash.replace('#', ''), { scroll: false });
    });
    $('settingsBack').addEventListener('click', () => {
      if (location.hash) history.replaceState(null, '', location.pathname);
      showSection('', { scroll: true });
    });
  }

  async function boot() {
    W.initShell('settings');
    W.installThemeListener();
    await i18n.init();
    bind();
    try {
      await loadAll();
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
      $('peopleCount').textContent = error.message;
    }
    const avatar = $('navAvatar');
    avatar.textContent = W.initials(W.state.people.find((p) => p.is_self)?.name || 'PA');
    const composer = new W.Composer({ onSaved: () => loadAll() });
    document.querySelectorAll('[data-compose]').forEach((button) => {
      button.addEventListener('click', () => composer.open());
    });
  }

  W.ready(boot);
})();
