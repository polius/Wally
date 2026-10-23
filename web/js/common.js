/* Wally v2 — shared runtime. */
const API = '/api';

const W = (() => {
  const state = {
    people: [],
    categories: [],
    tags: [],
    currency: { name: 'EUR', symbol: '€', position: 'right' },
    recurring: [],
    version: '2.0',
    coreLoaded: false,
  };

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
  }

  function avatarColor(person) {
    const palette = ['#0B62C4', '#0E7C5A', '#8A5CF6', '#B8433A', '#B7791F', '#0E7490'];
    if (!person) return '#6B6B70';
    let hash = 0;
    for (const ch of person.id || person.name || '') hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    return palette[hash % palette.length];
  }

  function avatar(person, size = '') {
    if (!person) {
      return `<span class="avatar-person shared ${size}" aria-hidden="true">${icon('people')}</span>`;
    }
    return `<span class="avatar-person ${size}" style="--av:${avatarColor(person)}" aria-hidden="true">${escapeHtml(initials(person.name))}</span>`;
  }

  function personName(id) {
    if (id === null || id === undefined || id === '') return null;
    return state.people.find((p) => p.id === id)?.name || null;
  }

  function numberLocale() {
    const map = { en: 'en-GB', ca: 'ca-ES', es: 'es-ES', fr: 'fr-FR', de: 'de-DE', it: 'it-IT', pt: 'pt-PT', ru: 'ru-RU', ja: 'ja-JP', ko: 'ko-KR', zh: 'zh-CN', hi: 'hi-IN', ar: 'ar-EG' };
    return map[window.i18n?.locale] || 'en-GB';
  }

  function decimal(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number : 0;
  }

  function formatNumber(value, options = {}) {
    const { min = 2, max = 2 } = options;
    return new Intl.NumberFormat(numberLocale(), {
      minimumFractionDigits: min,
      maximumFractionDigits: max,
    }).format(decimal(value));
  }

  function money(value, options = {}) {
    const { signed = false, sign = '', plus = false } = options;
    const abs = Math.abs(decimal(value));
    const symbol = state.currency.symbol || state.currency.name || '';
    const body = state.currency.position === 'left'
      ? `${symbol}${formatNumber(abs)}`
      : `${formatNumber(abs)} ${symbol}`;
    if (signed || plus || sign) {
      const prefix = sign || (decimal(value) < 0 ? '−' : (plus ? '+' : ''));
      return `${prefix}${body}`;
    }
    return body;
  }

  function compactMoney(value) {
    const abs = Math.abs(decimal(value));
    if (abs >= 10000) return money(value, { signed: true });
    return money(value, { signed: true });
  }

  function parseAmount(value) {
    if (typeof value === 'number') return value;
    let normalised = String(value ?? '').replace(/\s/g, '').replace(/[^0-9,.-]/g, '');
    const lastComma = normalised.lastIndexOf(',');
    const lastDot = normalised.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      // Whichever separator comes last is the decimal mark; the other is grouping.
      normalised = lastComma > lastDot
        ? normalised.replace(/\./g, '').replace(/,/g, '.')
        : normalised.replace(/,/g, '');
    } else if (lastComma >= 0) {
      const parts = normalised.split(',');
      const grouping = parts.length === 2 && parts[1].length === 3 && parts[0] !== '0';
      normalised = parts.length > 2 || grouping
        ? normalised.replace(/,/g, '')
        : normalised.replace(',', '.');
    }
    const number = Number.parseFloat(normalised);
    return Number.isFinite(number) ? number : 0;
  }

  function parseDate(value) {
    if (value instanceof Date) return value;
    if (!value) return new Date();
    const [y, m, d] = String(value).split('-').map(Number);
    if (!y || !m || !d) return new Date(value);
    return new Date(y, m - 1, d);
  }

  function dateISO(date) {
    const d = parseDate(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function monthKey(date) {
    const d = parseDate(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthLabel(date, short = false) {
    const d = parseDate(date);
    return `${short ? MONTHS[d.getMonth()].slice(0, 3) : MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  }

  function dayLabel(value) {
    const d = parseDate(value);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (dateISO(d) === dateISO(today)) return 'Today';
    if (dateISO(d) === dateISO(yesterday)) return 'Yesterday';
    return d.toLocaleDateString(numberLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
  }

  function longDate(value) {
    return parseDate(value).toLocaleDateString(numberLocale(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function shortDate(value) {
    return parseDate(value).toLocaleDateString(numberLocale(), { day: 'numeric', month: 'short' });
  }

  function dateTimeLabel(value) {
    if (!value) return '—';
    const d = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(numberLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function addMonths(date, delta) {
    const d = parseDate(date);
    return new Date(d.getFullYear(), d.getMonth() + delta, 1);
  }

  function addYears(date, delta) {
    const d = parseDate(date);
    return new Date(d.getFullYear() + delta, d.getMonth(), d.getDate());
  }

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });

    if (response.status === 401) {
      window.location.href = '/login';
      throw new Error('Unauthorised');
    }

    let body = null;
    const text = await response.text();
    if (text) {
      try { body = JSON.parse(text); } catch { body = text; }
    }

    if (!response.ok) {
      let message = 'Something went wrong.';
      if (response.status === 405) message = window.i18n?.t('settings.messages.demo_action_unavailable') || 'This action is not available in the demo.';
      else if (response.status === 422 && Array.isArray(body?.detail)) message = body.detail[0]?.msg || message;
      else if (typeof body?.detail === 'string') message = body.detail;
      else if (typeof body === 'string' && body) message = body.replace(/^"|"$/g, '');
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function loadCore(force = false) {
    if (state.coreLoaded && !force) return state;
    const [people, categories, tags, currency, version] = await Promise.all([
      api('/people'),
      api('/categories'),
      api('/tags'),
      api('/currency'),
      api('/version').catch(() => ({ version: '2.0' })),
    ]);
    state.people = people;
    state.categories = categories;
    state.tags = tags;
    const selected = currency.currencies.find((c) => c.name === currency.selected) || currency.currencies.find((c) => c.selected) || {};
    state.currency = { name: currency.selected, symbol: selected.symbol || currency.selected, position: currency.position };
    state.version = version?.version || '2.0';
    state.coreLoaded = true;
    return state;
  }

  async function refreshPeople() {
    state.people = await api('/people');
    return state.people;
  }

  async function refreshRecurring() {
    state.recurring = await api('/recurring');
    return state.recurring;
  }

  function hasPeople() {
    return state.people.length > 0;
  }

  function hasSharedPeople() {
    return state.people.length >= 2;
  }

  function defaultOwner() {
    if (!hasPeople()) return null;
    const stored = localStorage.getItem('wally_owner');
    if (stored === 'shared' && hasSharedPeople()) return 'shared';
    if (state.people.some((p) => p.id === stored)) return stored;
    return state.people.find((p) => p.is_self)?.id || state.people[0].id;
  }

  function setDefaultOwner(id) {
    if (id) localStorage.setItem('wally_owner', id);
    else localStorage.removeItem('wally_owner');
  }

  /* ---------------------------- theme ---------------------------- */
  function resolveTheme(preference) {
    if (preference === 'light' || preference === 'dark') return preference;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme() {
    const pref = localStorage.getItem('theme') || 'system';
    const resolved = resolveTheme(pref);
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themePreference = pref;
    document.documentElement.style.colorScheme = resolved;
  }

  function setTheme(pref) {
    localStorage.setItem('theme', pref);
    applyTheme();
    document.dispatchEvent(new CustomEvent('wally:theme', { detail: pref }));
  }

  /* --------------------------- toasts ---------------------------- */
  let toastTimer = null;
  function toast(message, options = {}) {
    const { actionLabel = '', onAction = null, tone = 'default', duration = 6000 } = options;
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    stack.innerHTML = '';
    const toast = document.createElement('div');
    toast.className = `toast ${tone}`;
    toast.innerHTML = `<span class="toast-message">${escapeHtml(message)}</span>${actionLabel ? `<button type="button" class="toast-action">${escapeHtml(actionLabel)}</button>` : ''}`;
    stack.appendChild(toast);
    clearTimeout(toastTimer);
    const close = () => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 180);
    };
    toast.querySelector('.toast-action')?.addEventListener('click', () => {
      close();
      onAction?.();
    });
    toastTimer = setTimeout(close, duration);
  }

  /* --------------------------- dialogs --------------------------- */
  function openDialog(el) {
    if (!el) return;
    if (typeof el.showModal === 'function') el.showModal();
    else el.setAttribute('open', '');
  }

  function closeDialog(el) {
    if (!el) return;
    if (typeof el.close === 'function') el.close();
    else el.removeAttribute('open');
  }

  let dynamicDialog = null;
  let dialogSequence = 0;
  function buildDialog({ title, description = '', body = '', actions = [], danger = false }) {
    dynamicDialog?.remove();
    dynamicDialog = document.createElement('dialog');
    dynamicDialog.className = 'dialog';
    const titleId = `dialog-title-${++dialogSequence}`;
    const descriptionId = description ? `dialog-description-${dialogSequence}` : '';
    dynamicDialog.setAttribute('aria-labelledby', titleId);
    if (descriptionId) dynamicDialog.setAttribute('aria-describedby', descriptionId);
    dynamicDialog.innerHTML = `
      <div class="dialog-head">
        <div><h2 class="dialog-title" id="${titleId}">${escapeHtml(title)}</h2>${description ? `<p class="dialog-sub" id="${descriptionId}">${escapeHtml(description)}</p>` : ''}</div>
        <button type="button" class="icon-btn dialog-close" aria-label="${window.i18n?.t('common.close') || 'Close'}">${icon('close')}</button>
      </div>
      <div class="dialog-body">${body}</div>
      <div class="dialog-foot"></div>`;
    const foot = dynamicDialog.querySelector('.dialog-foot');
    return { dialog: dynamicDialog, foot, danger };
  }

  function dialog({ title, description = '', body = '', confirmLabel = 'Save', cancelLabel = 'Cancel', danger = false, onConfirm = null }) {
    return new Promise((resolve) => {
      const { dialog: el, foot } = buildDialog({ title, description, body, danger });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = cancelLabel;
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = `btn ${danger ? 'danger' : 'primary'}`;
      confirm.textContent = confirmLabel;
      foot.append(cancel, confirm);
      document.body.appendChild(el);
      openDialog(el);
      el.querySelector('.dialog-close').addEventListener('click', () => finish(null));
      cancel.addEventListener('click', () => finish(null));
      el.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
      confirm.addEventListener('click', async () => {
        if (onConfirm) {
          confirm.disabled = true;
          try {
            const result = await onConfirm(el);
            if (result !== false) finish(result ?? true);
          } catch (error) {
            el.querySelector('.dialog-error')?.remove();
            const p = document.createElement('p');
            p.className = 'dialog-error';
            p.textContent = error.message;
            foot.before(p);
          } finally {
            confirm.disabled = false;
          }
        } else {
          finish(true);
        }
      });
      function finish(value) {
        closeDialog(el);
        setTimeout(() => el.remove(), 200);
        resolve(value);
      }
      const focusTarget = el.querySelector('.dialog-body input, .dialog-body textarea, .dialog-body select, .dialog-body button') || el.querySelector('.dialog-close');
      focusTarget?.focus();
    });
  }

  function confirmDialog({ title, message, confirmLabel = 'Delete', cancelLabel = 'Cancel', danger = true }) {
    return dialog({
      title,
      body: `<p class="dialog-message">${escapeHtml(message)}</p>`,
      confirmLabel,
      cancelLabel,
      danger,
    }).then(Boolean);
  }

  function promptDialog({ title, label = '', value = '', placeholder = '', description = '', confirmLabel = 'Save', danger = false, maxLength = 60 }) {
    return new Promise((resolve) => {
      const { dialog: el, foot } = buildDialog({
        title,
        description,
        body: `<label class="field"><span class="flabel">${escapeHtml(label)}</span><input class="input" id="prompt-value" maxlength="${maxLength}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}"></label>`,
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'Cancel';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = `btn ${danger ? 'danger' : 'primary'}`;
      confirm.textContent = confirmLabel;
      foot.append(cancel, confirm);
      document.body.appendChild(el);
      openDialog(el);
      const input = el.querySelector('#prompt-value');
      input.focus();
      input.select();
      const finish = (v) => { closeDialog(el); setTimeout(() => el.remove(), 200); resolve(v); };
      el.querySelector('.dialog-close').addEventListener('click', () => finish(null));
      cancel.addEventListener('click', () => finish(null));
      el.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
      confirm.addEventListener('click', () => {
        const next = input.value.trim();
        if (!next) { input.focus(); return; }
        finish(next);
      });
      input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); confirm.click(); } });
    });
  }

  function choiceDialog({ title, description = '', options = [], value = null, confirmLabel = 'Save', columns = 1, danger = false }) {
    return new Promise((resolve) => {
      const { dialog: el, foot } = buildDialog({
        title,
        description,
        body: `<div class="choice-list ${columns === 2 ? 'two-col' : ''}" role="radiogroup">${options.map((o) => `<button type="button" class="choice ${o.value === value ? 'on' : ''}" role="radio" aria-checked="${o.value === value}" data-value="${escapeHtml(o.value)}"><span class="choice-title">${escapeHtml(o.label)}</span>${o.detail ? `<span class="choice-detail">${escapeHtml(o.detail)}</span>` : ''}</button>`).join('')}</div>`,
      });
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'Cancel';
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = `btn ${danger ? 'danger' : 'primary'}`;
      confirm.textContent = confirmLabel;
      foot.append(cancel, confirm);
      document.body.appendChild(el);
      openDialog(el);
      let chosen = value;
      const choices = [...el.querySelectorAll('.choice')];
      const choose = (button) => {
        chosen = button.dataset.value;
        choices.forEach((b) => {
          const on = b === button;
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', String(on));
        });
      };
      choices.forEach((button, index) => {
        button.addEventListener('click', () => choose(button));
        button.addEventListener('keydown', (event) => {
          if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) return;
          event.preventDefault();
          const direction = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
          const next = choices[(index + direction + choices.length) % choices.length];
          choose(next);
          next.focus();
        });
      });
      (choices.find((b) => b.classList.contains('on')) || choices[0])?.focus();
      const finish = (v) => { closeDialog(el); setTimeout(() => el.remove(), 200); resolve(v); };
      el.querySelector('.dialog-close').addEventListener('click', () => finish(null));
      cancel.addEventListener('click', () => finish(null));
      el.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
      confirm.addEventListener('click', () => finish(chosen));
    });
  }

  /* ----------------------------- csv ----------------------------- */
  function csvRows(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];
      if (quoted) {
        if (ch === '"' && source[i + 1] === '"') { field += '"'; i += 1; }
        else if (ch === '"') quoted = false;
        else field += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
  }

  function csvParse(text) {
    const rows = csvRows(text);
    if (!rows.length) return { headers: [], rows: [] };
    const headers = rows[0].map((h) => String(h).trim());
    return {
      headers,
      rows: rows.slice(1).map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))),
    };
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function csvStringify(rows, columns) {
    const head = columns.map(csvEscape).join(',');
    const body = rows.map((row) => columns.map((c) => csvEscape(row[c])).join(',')).join('\r\n');
    return body ? `${head}\r\n${body}` : head;
  }

  function tagsToCell(tags) {
    if (!Array.isArray(tags) || !tags.length) return '';
    return tags.map(csvEscape).join(',');
  }

  function cellToTags(cell) {
    if (cell === null || cell === undefined || String(cell).trim() === '') return [];
    const row = csvRows(String(cell))[0] || [];
    return row.map((t) => String(t).trim()).filter(Boolean);
  }

  function download(filename, content, type = 'text/csv;charset=utf-8') {
    const blob = new Blob([content], { type });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = filename;
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------------------- icons ---------------------------- */
  const ICONS = {
    close: '<path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/>',
    plus: '<path d="M8 3.2v9.6M3.2 8h9.6"/>',
    search: '<circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/>',
    filter: '<path d="M2.5 4h11M4.5 8h7M6.5 12h3"/>',
    chevron: '<path d="M5.5 6.5 8 9l2.5-2.5"/>',
    chevronRight: '<path d="M6.5 4.5 10 8l-3.5 3.5"/>',
    arrowLeft: '<path d="M10 3.5 5.5 8l4.5 4.5"/>',
    overview: '<path d="M3.2 12.8V8.4M8 12.8V3.4M12.8 12.8v-6"/>',
    transactions: '<path d="M3 4.5h10M3 8h10M3 11.5h6"/>',
    settings: '<path d="M2.5 4.5h4M9.5 4.5h4M2.5 8h6M11.5 8h2M2.5 11.5h4M9.5 11.5h4"/><circle cx="8" cy="4.5" r="1.2"/><circle cx="10" cy="8" r="1.2"/><circle cx="8" cy="11.5" r="1.2"/>',
    sliders: '<path d="M2.5 4.5h4M9.5 4.5h4M2.5 8h6M11.5 8h2M2.5 11.5h4M9.5 11.5h4"/><circle cx="8" cy="4.5" r="1.3"/><circle cx="10" cy="8" r="1.3"/><circle cx="8" cy="11.5" r="1.3"/>',
    people: '<circle cx="6" cy="6" r="2.3"/><path d="M1.8 13c.4-2.2 2.1-3.5 4.2-3.5s3.8 1.3 4.2 3.5"/><path d="M10.6 4.2a2 2 0 0 1 0 3.8M11.4 9.8c1.6.3 2.6 1.4 2.9 3.2"/>',
    person: '<circle cx="8" cy="5.2" r="2.6"/><path d="M2.8 13.4c.5-2.7 2.6-4.2 5.2-4.2s4.7 1.5 5.2 4.2"/>',
    tag: '<path d="M2.8 7.6V2.8h4.8l5.6 5.6-4.8 4.8-5.6-5.6Z"/><circle cx="5.4" cy="5.4" r=".9"/>',
    repeat: '<path d="M3 6.2A3.2 3.2 0 0 1 6.2 3H13M13 3l-2-2M13 3l-2 2M13 9.8A3.2 3.2 0 0 1 9.8 13H3M3 13l2 2M3 13l2-2"/>',
    swap: '<path d="M3 5.5h9.5M11 4l1.5 1.5L11 7M13 10.5H3.5M5 9l-1.5 1.5L5 12"/>',
    key: '<circle cx="5.2" cy="10.8" r="2.3"/><path d="M7 9l6-6M10.4 5.6l1.6 1.6M12 4l1.6 1.6"/>',
    info: '<circle cx="8" cy="8" r="6"/><path d="M8 7.2v4M8 5.2v.2"/>',
    sun: '<circle cx="8" cy="8" r="2.8"/><path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1"/>',
    moon: '<path d="M12.8 9.6A5.4 5.4 0 0 1 6.4 3.2 5.4 5.4 0 1 0 12.8 9.6Z"/>',
    shield: '<path d="M8 2.2 13 4v3.8c0 3.1-2.1 5-5 6-2.9-1-5-2.9-5-6V4l5-1.8Z"/><path d="M6 8 7.4 9.4 10.2 6.6"/>',
    check: '<path d="M3 8.4 6.4 12 13 4.6"/>',
    trash: '<path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 9h5.8l.6-9M6.8 7v4M9.2 7v4"/>',
    edit: '<path d="M3 13h2.6l7-7a1.8 1.8 0 0 0-2.6-2.6l-7 7V13Z"/><path d="M8.6 5l2.4 2.4"/>',
    copy: '<rect x="5" y="5" width="8" height="8" rx="1.4"/><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2H3.5A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5"/>',
    eye: '<path d="M1.8 8s2.2-3.8 6.2-3.8S14.2 8 14.2 8s-2.2 3.8-6.2 3.8S1.8 8 1.8 8Z"/><circle cx="8" cy="8" r="1.7"/>',
    eyeOff: '<path d="M2 2l12 12M6.2 4.5A6.6 6.6 0 0 1 8 4.2c4 0 6.2 3.8 6.2 3.8a11 11 0 0 1-2.1 2.4M4.1 5.7A10.8 10.8 0 0 0 1.8 8s2.2 3.8 6.2 3.8c.8 0 1.5-.1 2.1-.4"/>',
    income: '<path d="M8 13V3M4 7l4-4 4 4"/>',
    expense: '<path d="M8 3v10M4 9l4 4 4-4"/>',
    download: '<path d="M8 2.5v8M4.8 7.5 8 10.7l3.2-3.2M2.8 13.5h10.4"/>',
    upload: '<path d="M8 10.5v-8M4.8 5.5 8 2.3l3.2 3.2M2.8 13.5h10.4"/>',
    logout: '<path d="M6 3H3.5A1.5 1.5 0 0 0 2 4.5v7A1.5 1.5 0 0 0 3.5 13H6M10 5l3 3-3 3M13 8H6"/>',
    spark: '<path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5 8 2.2Z"/>',
    alert: '<path d="M8 2.8 14 12.8H2L8 2.8Z"/><path d="M8 6.4v3.1M8 11.3v.2"/>',
    groceries: '<path d="M2.5 5.5h11l-1 7h-9l-1-7Z"/><path d="M5.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5"/>',
    food: '<path d="M5 2.5v5M3 2.5v3.2c0 .9.7 1.6 1.6 1.6H5.4c.9 0 1.6-.7 1.6-1.6V2.5M5 7.3v6.2M11.5 2.5v11M10 2.5c2 1 2.4 3.4 1.5 5"/>',
    rent: '<path d="M2.8 7.2 8 2.8l5.2 4.4v6H2.8v-6Z"/><path d="M6.3 13V9.2h3.4V13"/>',
    entertainment: '<rect x="2.2" y="4.2" width="11.6" height="8" rx="1.6"/><path d="M6.2 6.3 10 8.3l-3.8 2V6.3Z"/>',
    healthcare: '<path d="M8 13.2S2.5 10 2.5 6.2A2.8 2.8 0 0 1 8 4.4a2.8 2.8 0 0 1 5.5 1.8C13.5 10 8 13.2 8 13.2Z"/>',
    shopping: '<path d="M3.2 5.5h9.6l-.8 7.2H4L3.2 5.5Z"/><path d="M6 5.5V4a2 2 0 0 1 4 0v1.5"/>',
    travel: '<path d="M2.5 8.5 13.4 3.2l-3 9.6-2.1-3.5-3.3-1.8Z"/><path d="M8.3 9.3 13.4 3.2"/>',
    utilities: '<path d="M8.6 2 3.5 9h3.1L6 14l5.1-7H8L8.6 2Z"/>',
    miscellaneous: '<circle cx="3.2" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12.8" cy="8" r="1"/>',
    more: '<circle cx="3.2" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12.8" cy="8" r="1"/>',
    repeatRow: '<path d="M3 6.2A3.2 3.2 0 0 1 6.2 3H13M13 3l-2-2M13 3l-2 2M13 9.8A3.2 3.2 0 0 1 9.8 13H3"/>',
    wallet: '<rect x="2.2" y="4.2" width="11.6" height="8.4" rx="1.8"/><path d="M2.2 6.4h11.6M10.2 9.5h1.6"/>',
    gift: '<rect x="2.5" y="5.5" width="11" height="7.5" rx="1"/><path d="M2.5 8.2h11M8 5.5v7.5M8 5.5C6.8 3 4 3.2 4 4.7c0 1.3 2.2 1 4 .8Zm0 0c1.2-2.5 4-2.3 4-.8 0 1.3-2.2 1-4 .8Z"/>',
  };

  const CATEGORY_ICONS = {
    Groceries: 'groceries', Food: 'food', Rent: 'rent', Entertainment: 'entertainment',
    Healthcare: 'healthcare', Shopping: 'shopping', Travel: 'travel', Utilities: 'utilities',
    Income: 'income', Miscellaneous: 'miscellaneous',
  };

  function icon(name, cls = '') {
    const body = ICONS[name] || ICONS.miscellaneous;
    return `<svg class="i ${cls}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  function categoryIcon(name) {
    return icon(CATEGORY_ICONS[name] || 'miscellaneous');
  }

  const CATEGORY_COLORS = {
    Groceries: '#E8665D',
    Food: '#E59A52',
    Rent: '#E7C65B',
    Entertainment: '#78C99A',
    Shopping: '#5BC4C9',
    Healthcare: '#6AA9E9',
    Travel: '#9B8BE8',
    Miscellaneous: '#E88AAE',
    Utilities: '#C9C9CE',
    Income: '#0E7C5A',
  };

  function categoryColor(name) {
    if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
    const palette = ['#E8665D', '#E59A52', '#E7C65B', '#78C99A', '#5BC4C9', '#6AA9E9', '#9B8BE8', '#E88AAE', '#C9C9CE', '#8A8A8F'];
    let hash = 0;
    for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    return palette[hash % palette.length];
  }

  /* ----------------------------- data ---------------------------- */
  function sharesFor(transaction) {
    if (!Array.isArray(transaction.shares) || !transaction.shares.length) return [];
    return transaction.shares.map((s) => ({ person_id: s.person_id, amount: decimal(s.amount) }));
  }

  function ownerLabel(transaction) {
    if (transaction.person_id) return personName(transaction.person_id) || '—';
    if (sharesFor(transaction).length) return 'Shared';
    return null;
  }

  function sharedPeople(transaction) {
    return sharesFor(transaction).map((s) => ({ ...s, name: personName(s.person_id) || '—' }));
  }

  /**
   * Totals for a set of transactions, honouring shares.
   * `spent` per person excludes shared costs; the shared pot is its own row.
   */
  function summarise(transactions) {
    let income = 0;
    let expense = 0;
    const perPerson = {};
    for (const person of state.people) {
      perPerson[person.id] = { person, spent: 0, earned: 0, count: 0, shares: 0 };
    }
    const shared = { spent: 0, count: 0, parts: {} };
    for (const transaction of transactions) {
      const amount = decimal(transaction.amount);
      const shares = sharesFor(transaction);
      if (transaction.type === 'income') {
        income += amount;
        if (transaction.person_id && perPerson[transaction.person_id]) {
          perPerson[transaction.person_id].earned += amount;
          perPerson[transaction.person_id].count += 1;
        }
      } else {
        expense += amount;
        if (transaction.person_id && perPerson[transaction.person_id]) {
          perPerson[transaction.person_id].spent += amount;
          perPerson[transaction.person_id].count += 1;
        } else if (shares.length) {
          shared.spent += amount;
          shared.count += 1;
          for (const share of shares) {
            if (perPerson[share.person_id]) {
              perPerson[share.person_id].shares += share.amount;
              shared.parts[share.person_id] = (shared.parts[share.person_id] || 0) + share.amount;
            }
          }
        }
      }
    }
    for (const row of Object.values(perPerson)) row.net = row.earned - row.spent;
    return { income, expense, net: income - expense, perPerson, shared };
  }

  function groupByDay(transactions) {
    const groups = new Map();
    for (const transaction of transactions) {
      const key = transaction.date;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(transaction);
    }
    return [...groups.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, items]) => {
        items.sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
        const net = items.reduce((sum, t) => sum + (t.type === 'income' ? decimal(t.amount) : -decimal(t.amount)), 0);
        return { date, items, net };
      });
  }

  function monthTransactions(transactions, date) {
    const key = monthKey(date);
    return transactions.filter((t) => String(t.date).startsWith(key));
  }

  /* ----------------------------- shell --------------------------- */
  function initShell(active = 'overview') {
    applyTheme();
    document.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('on', el.dataset.nav === active);
      el.setAttribute('aria-current', el.dataset.nav === active ? 'page' : 'false');
    });
    const avatar = document.getElementById('navAvatar');
    if (avatar) avatar.textContent = 'PA';
    document.querySelectorAll('[data-compose]').forEach((button) => {
      if (!button.hasAttribute('data-bound')) {
        button.setAttribute('data-bound', '');
      }
    });
  }

  function applyRangeLabel(el, range) {
    if (!el) return;
    if (range.type === 'all') el.textContent = 'All time';
    else if (range.type === 'custom') el.textContent = `${monthLabel(range.from, true)} – ${monthLabel(range.to, true)}`;
    else el.textContent = monthLabel(range.to);
  }

  function rangeDescription(range) {
    if (range.type === 'all') return 'Every transaction';
    if (range.type === 'custom') return `${monthLabel(range.from)} – ${monthLabel(range.to)}`;
    const count = range.type === 'current' ? 1 : range.type === '3m' ? 3 : range.type === '6m' ? 6 : range.type === '12m' ? 12 : 10;
    return `${monthLabel(addMonths(range.to, -(count - 1)))} – ${monthLabel(range.to)}`;
  }

  function rangeToFromTo(range) {
    if (range.type === 'all') return { from: null, to: null };
    if (range.type === 'current') return { from: range.to, to: range.to };
    if (range.type === '3m') return { from: addMonths(range.to, -2), to: range.to };
    if (range.type === '6m') return { from: addMonths(range.to, -5), to: range.to };
    if (range.type === '12m') return { from: addMonths(range.to, -11), to: range.to };
    if (range.type === 'ytd') return { from: new Date(range.to.getFullYear(), 0, 1), to: range.to };
    return { from: range.from, to: range.to };
  }

  async function fetchRangeTransactions(range) {
    const { from, to } = rangeToFromTo(range);
    if (!from) return api('/transactions');
    const path = `/transactions/range/${from.getFullYear()}-${from.getMonth() + 1}/${to.getFullYear()}-${to.getMonth() + 1}`;
    return api(path);
  }

  /* --------------------------- range menu ------------------------ */
  let rangePop = null;
  function openRangePopover(anchor, range, onChange) {
    closeRangePopover();
    const pop = document.createElement('div');
    pop.className = 'range-pop';
    pop.setAttribute('role', 'menu');
    const options = [
      { value: 'current', label: 'This month', detail: monthLabel(range.to) },
      { value: '3m', label: 'Last 3 months', detail: rangeDescription({ ...range, type: '3m' }) },
      { value: '6m', label: 'Last 6 months', detail: rangeDescription({ ...range, type: '6m' }) },
      { value: '12m', label: 'Last 12 months', detail: rangeDescription({ ...range, type: '12m' }) },
      { value: 'ytd', label: 'Year to date', detail: rangeDescription({ ...range, type: 'ytd' }) },
      { value: 'all', label: 'All time', detail: 'Every transaction' },
    ];
    const thisMonth = monthLabel(range.to);
    pop.innerHTML = `
      <div class="range-head"><b>Date range</b><button type="button" class="icon-btn small range-close" aria-label="Close">${icon('close')}</button></div>
      <div class="range-list">
        ${options.map((o) => `<button type="button" class="range-item ${range.type === o.value ? 'on' : ''}" role="menuitemradio" aria-checked="${range.type === o.value}" data-range="${o.value}"><span class="range-label">${o.label}</span><span class="range-detail">${o.detail}</span>${range.type === o.value ? `<span class="range-check">${icon('check')}</span>` : ''}</button>`).join('')}
      </div>
      <div class="range-div"></div>
      <div class="range-custom">
        <label class="range-field"><span>From</span><input type="month" class="input" value="${monthKey(range.from || range.to)}"></label>
        <span class="range-to">to</span>
        <label class="range-field"><span>To</span><input type="month" class="input" value="${monthKey(range.to)}"></label>
      </div>
      <button type="button" class="range-reset">Reset to ${thisMonth}</button>`;
    document.body.appendChild(pop);
    pop.style.position = 'absolute';
    pop.style.zIndex = '60';
    const rect = anchor.getBoundingClientRect();
    pop.style.left = `${Math.max(12, Math.min(rect.left + window.scrollX, window.innerWidth - 300 + window.scrollX))}px`;
    pop.style.top = `${rect.bottom + window.scrollY + 8}px`;
    rangePop = pop;

    const close = () => closeRangePopover();
    pop.querySelector('.range-close').addEventListener('click', close);
    pop.querySelectorAll('[data-range]').forEach((button) => {
      button.addEventListener('click', () => {
        const type = button.dataset.range;
        const next = type === 'current'
          ? { type, to: new Date(), from: new Date() }
          : type === 'all'
            ? { type, to: range.to, from: range.from }
            : { ...range, type };
        close();
        onChange(next);
      });
    });
    const [fromInput, toInput] = pop.querySelectorAll('input[type="month"]');
    const applyCustom = () => {
      if (!fromInput.value || !toInput.value) return;
      const [fy, fm] = fromInput.value.split('-').map(Number);
      const [ty, tm] = toInput.value.split('-').map(Number);
      const from = new Date(fy, fm - 1, 1);
      const to = new Date(ty, tm - 1, 1);
      if (from > to) return;
      close();
      onChange({ type: 'custom', from, to });
    };
    fromInput.addEventListener('change', applyCustom);
    toInput.addEventListener('change', applyCustom);
    pop.querySelector('.range-reset').addEventListener('click', () => {
      close();
      onChange({ type: 'current', from: new Date(), to: new Date() });
    });

    pop.querySelector('.range-item.on')?.focus();
    setTimeout(() => {
      const onDoc = (event) => {
        if (!pop.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) {
          closeRangePopover();
          document.removeEventListener('pointerdown', onDoc);
        }
      };
      document.addEventListener('pointerdown', onDoc);
      pop._onDoc = onDoc;
    }, 0);
  }

  function closeRangePopover() {
    if (!rangePop) return;
    if (rangePop._onDoc) document.removeEventListener('pointerdown', rangePop._onDoc);
    rangePop.remove();
    rangePop = null;
  }

  /* ----------------------------- tags ---------------------------- */
  async function createTag(name) {
    await api('/tags', { method: 'POST', body: JSON.stringify({ name }) });
    state.tags = await api('/tags');
    return name;
  }

  /* --------------------------- composer -------------------------- */
  const REPEATS = [
    { value: 'never', label: 'Never' },
    { value: 'daily', label: 'Daily' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'yearly', label: 'Yearly' },
  ];

  class Composer {
    constructor({ onSaved } = {}) {
      this.onSaved = onSaved || (() => {});
      this.el = null;
      this.state = null;
      this._bound = false;
    }

    ensure() {
      if (this.el) return;
      const el = document.createElement('dialog');
      el.className = 'composer';
      el.setAttribute('aria-label', 'Transaction');
      el.innerHTML = `
        <div class="sheet-head">
          <button type="button" class="sheet-cancel">Cancel</button>
          <b class="sheet-title" id="composerTitle">New transaction</b>
          <button type="button" class="sheet-save">Add</button>
        </div>
        <button type="button" class="composer-close icon-btn" aria-label="Close">${icon('close')}</button>
        <div class="composer-body">
          <div class="amount-hero focus" id="amountHero">
            <button type="button" class="amount-sign" id="amountSign" aria-label="Switch between expense and income">−</button>
            <span class="cur">${escapeHtml(state.currency.symbol)}</span>
            <input class="amount-input" id="amountInput" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Amount">
            <span class="code">${escapeHtml(state.currency.name)}</span>
          </div>
          <div class="merchant-wrap">
            <input class="merchant-input" id="merchantInput" autocomplete="off" spellcheck="false" placeholder="What was it?" aria-label="Name">
            <button type="button" class="icon-btn merchant-clear" id="merchantClear" aria-label="Clear name">${icon('close')}</button>
            <div class="suggest" id="merchantSuggest" role="listbox" hidden></div>
          </div>
          <div class="group-list">
            <div class="glist-row" id="typeRow" role="button" tabindex="0"><span class="glist-label">Type</span><span class="glist-val" id="typeVal">Expense</span><span class="glist-chev">${icon('chevronRight')}</span></div>
            <div class="glist-row expander" id="categoryRow" role="button" tabindex="0" aria-expanded="false"><span class="glist-label">Category</span><span class="glist-val" id="categoryVal">Uncategorized</span><span class="glist-chev" id="categoryChev">${icon('chevronRight')}</span></div>
            <div class="tiles-cell" id="categoryTiles" hidden></div>
            <div class="glist-row"><span class="glist-label">Date</span><span class="glist-val date-val"><input type="date" id="dateInput" aria-label="Date"></span></div>
            <div class="glist-row" id="repeatRow" role="button" tabindex="0"><span class="glist-label">Repeat</span><span class="glist-val" id="repeatVal">Never</span><span class="glist-chev">${icon('chevronRight')}</span></div>
            <div class="glist-row owner-row" id="ownerRow" hidden><span class="glist-label">Owner</span><span class="ownrow" id="ownerPills" role="group" aria-label="Owner"></span></div>
          </div>
          <div class="splitbox" id="splitBox" hidden>
            <div class="split-h"><span>Split between</span><button type="button" class="link" id="splitEven">Split evenly</button></div>
            <div id="splitRows"></div>
            <div class="split-foot"><span id="splitStatus"></span></div>
          </div>
          <div class="group-list">
            <div class="glist-row tag-row"><span class="glist-label">Tags</span><span class="tagrow" id="tagRow"></span></div>
            <div class="tag-picker" id="tagPicker" hidden>
              <div class="tag-picker-list" id="tagPickerList"></div>
              <form class="tag-new" id="tagNewForm"><input class="input" id="tagNewInput" placeholder="New tag" maxlength="30" aria-label="New tag"><button type="submit" class="btn ghost sm">Add</button></form>
            </div>
          </div>
          <button type="button" class="danger-link" id="composerDelete" hidden>${icon('trash')} Delete transaction</button>
        </div>
        <div class="composer-foot">
          <button type="button" class="btn primary" id="composerSubmit">Add</button>
        </div>`;
      document.body.appendChild(el);
      this.el = el;
      this._bind();
    }

    _bind() {
      const el = this.el;
      el.querySelector('.sheet-cancel').addEventListener('click', () => this.close());
      el.querySelector('.composer-close').addEventListener('click', () => this.close());
      el.addEventListener('cancel', (event) => { event.preventDefault(); this.close(); });
      el.querySelector('.sheet-save').addEventListener('click', () => this.save());
      el.querySelector('#composerSubmit').addEventListener('click', () => this.save());
      el.querySelector('#amountInput').addEventListener('input', () => {
        this.state.amount = parseAmount(el.querySelector('#amountInput').value);
        if (this.state.person === 'shared' && !this._splitTouched) this.evenSplit();
        this.renderSave();
        this.renderSplit();
      });
      el.querySelector('#amountSign').addEventListener('click', () => this.toggleType());
      el.querySelector('#typeRow').addEventListener('click', () => this.toggleType());
      el.querySelector('#categoryRow').addEventListener('click', () => this.toggleCategories());
      el.querySelector('#repeatRow').addEventListener('click', () => this.pickRepeat());
      ['#typeRow', '#categoryRow', '#repeatRow'].forEach((selector) => {
        const row = el.querySelector(selector);
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          row.click();
        });
      });
      el.querySelector('#merchantInput').addEventListener('input', () => this.suggest());
      el.querySelector('#merchantClear').addEventListener('click', () => {
        el.querySelector('#merchantInput').value = '';
        this.state.name = '';
      });
      el.querySelector('#dateInput').addEventListener('change', (event) => {
        this.state.date = event.target.value;
      });
      el.querySelector('#splitEven').addEventListener('click', () => this.evenSplit());
      el.querySelector('#composerDelete').addEventListener('click', () => this.delete());
      el.querySelector('#tagNewForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const input = el.querySelector('#tagNewInput');
        const name = input.value.trim().toLowerCase();
        if (!name) return;
        try {
          if (!state.tags.includes(name)) await createTag(name);
          this.state.tags = [...new Set([...this.state.tags, name])];
          input.value = '';
          this.renderTags();
          this.renderTagPicker();
        } catch (error) { toast(error.message, { tone: 'danger' }); }
      });
      el.addEventListener('close', () => {
        document.body.classList.remove('composer-open');
        this.el?.querySelector('.suggest')?.setAttribute('hidden', '');
      });
    }

    reset() {
      this.ensure();
      const el = this.el;
      el.querySelector('#merchantSuggest').hidden = true;
      el.querySelector('#categoryTiles').hidden = true;
      el.querySelector('#categoryRow').setAttribute('aria-expanded', 'false');
      el.querySelector('#categoryChev').innerHTML = icon('chevronRight');
      el.querySelector('#tagPicker').hidden = true;
      this._splitTouched = false;
      el.querySelector('.dialog-error')?.remove();
      el.querySelectorAll('.tiles-cell').forEach((n) => { n.hidden = true; });
      el.querySelector('#composerDelete').hidden = true;
      el.querySelector('#composerTitle').textContent = 'New transaction';
      el.querySelector('.sheet-save').textContent = 'Add';
      el.querySelector('.sheet-cancel').textContent = 'Cancel';
    }

    async open({ transaction = null, duplicate = false } = {}) {
      await loadCore();
      this.ensure();
      const editing = Boolean(transaction) && !duplicate;
      this.state = {
        mode: editing ? 'edit' : 'add',
        original: transaction,
        amount: transaction ? decimal(transaction.amount) : 0,
        type: transaction?.type || 'expense',
        name: transaction?.name || '',
        category: transaction?.category || '',
        date: transaction?.date || dateISO(new Date()),
        tags: [...(transaction?.tags || [])],
        person: editing ? (transaction.person_id || (sharesFor(transaction).length ? 'shared' : null)) : defaultOwner(),
        shares: editing && sharesFor(transaction).length
          ? sharesFor(transaction)
          : [],
        repeat: 'never',
        recurringLinked: Boolean(transaction?.recurringID),
      };
      if (this.state.mode === 'edit' && transaction?.recurringID) {
        const rule = state.recurring.find((r) => r.id === transaction.recurringID);
        this.state.repeat = rule?.frequency || 'never';
      }
      this.reset();
      this._splitTouched = editing && this.state.shares.length > 0;
      const el = this.el;

      el.querySelector('#amountInput').value = this.state.amount ? formatNumber(this.state.amount) : '';
      el.querySelector('#merchantInput').value = this.state.name;
      el.querySelector('#dateInput').value = this.state.date;
      el.querySelector('#categoryVal').textContent = this.state.category || 'Uncategorized';

      if (this.state.person === 'shared' && !this.state.shares.length) this.evenSplit();
      if (this.state.mode === 'edit') {
        el.querySelector('#composerTitle').textContent = 'Edit transaction';
        el.querySelector('.sheet-save').textContent = 'Save';
        el.querySelector('#composerDelete').hidden = false;
        el.querySelector('#repeatRow').classList.add('locked');
      }
      if (this.state.type === 'income') this.applyType();
      this.renderOwner();
      this.renderRepeat();
      this.renderTags();
      this.renderTagPicker();
      this.renderSave();
      document.body.classList.add('composer-open');
      openDialog(el);
      requestAnimationFrame(() => {
        const amount = el.querySelector('#amountInput');
        amount.focus();
        amount.select();
      });
    }

    close() {
      closeDialog(this.el);
    }

    toggleType() {
      this.state.type = this.state.type === 'expense' ? 'income' : 'expense';
      this.applyType();
      if (this.state.type === 'income' && this.state.person === 'shared') {
        this.state.person = state.people[0]?.id || null;
        this.state.shares = [];
        this.renderOwner();
      }
    }

    applyType() {
      const el = this.el;
      const income = this.state.type === 'income';
      el.querySelector('#amountHero').classList.toggle('income', income);
      el.querySelector('#amountSign').textContent = income ? '+' : '−';
      el.querySelector('#typeVal').textContent = income ? 'Income' : 'Expense';
      if (income && !this.state.category) this.state.category = 'Income';
      if (!income && this.state.category === 'Income') this.state.category = '';
      el.querySelector('#categoryVal').textContent = this.state.category || 'Uncategorized';
      if (!el.querySelector('#categoryTiles').hidden) this.renderCategoryTiles();
    }

    get categoriesForType() {
      // Categories are user-owned; Income is the conventional one. Show every
      // category and put income categories first for income.
      const all = [...state.categories];
      if (this.state.type === 'income') {
        return [...all].sort((a, b) => (b === 'Income') - (a === 'Income') || a.localeCompare(b));
      }
      return all.filter((c) => c !== 'Income');
    }

    toggleCategories() {
      const el = this.el;
      const tiles = el.querySelector('#categoryTiles');
      const open = tiles.hidden;
      tiles.hidden = !open;
      el.querySelector('#categoryRow').setAttribute('aria-expanded', String(open));
      el.querySelector('#categoryChev').innerHTML = icon(open ? 'chevron' : 'chevronRight');
      if (open) this.renderCategoryTiles();
    }

    renderCategoryTiles() {
      const el = this.el;
      const tiles = el.querySelector('#categoryTiles');
      const cats = this.categoriesForType;
      const chosen = this.state.category;
      const visible = cats.slice(0, 9);
      tiles.innerHTML = `<div class="txn-cats">${visible.map((c) => `<button type="button" class="txn-cat ${c === chosen ? 'on' : ''}" data-cat="${escapeHtml(c)}"><span class="ic">${categoryIcon(c)}</span>${escapeHtml(c)}</button>`).join('')}</div>`;
      tiles.querySelectorAll('[data-cat]').forEach((button) => {
        button.addEventListener('click', () => {
          this.state.category = button.dataset.cat;
          el.querySelector('#categoryVal').textContent = this.state.category;
          tiles.hidden = true;
          el.querySelector('#categoryRow').setAttribute('aria-expanded', 'false');
          el.querySelector('#categoryChev').innerHTML = icon('chevronRight');
        });
      });
      tiles.scrollIntoView({ block: 'nearest' });
    }

    async suggest() {
      const value = this.el.querySelector('#merchantInput').value.trim();
      this.state.name = value;
      const box = this.el.querySelector('#merchantSuggest');
      if (value.length < 2) { box.hidden = true; return; }
      try {
        const results = await api(`/transactions/names/search?q=${encodeURIComponent(value)}`);
        const filtered = results.filter((r) => r.name.toLowerCase() !== value.toLowerCase()).slice(0, 4);
        if (!filtered.length) { box.hidden = true; return; }
        box.innerHTML = filtered.map((r) => `<button type="button" class="suggest-item" data-name="${escapeHtml(r.name)}" data-cat="${escapeHtml(r.category)}"><span>${escapeHtml(r.name)}</span><small>${escapeHtml(r.category || 'Uncategorized')}</small></button>`).join('');
        box.hidden = false;
        box.querySelectorAll('.suggest-item').forEach((button) => {
          button.addEventListener('click', () => {
            this.state.name = button.dataset.name;
            this.el.querySelector('#merchantInput').value = this.state.name;
            if (button.dataset.cat) {
              this.state.category = button.dataset.cat;
              this.el.querySelector('#categoryVal').textContent = this.state.category;
            }
            box.hidden = true;
          });
        });
      } catch { box.hidden = true; }
    }

    async pickRepeat() {
      if (this.state.recurringLinked) {
        toast('This transaction belongs to a recurring rule. Change the rule in Settings → Recurring.', { tone: 'default' });
        return;
      }
      const value = await choiceDialog({
        title: 'Repeat',
        description: this.state.mode === 'edit' ? 'A one-off edit does not change its rule.' : 'Wally writes the occurrences for you.',
        options: REPEATS.map((r) => ({ value: r.value, label: r.label })),
        value: this.state.repeat,
      });
      if (value === null) return;
      if (this.state.person === 'shared' && value !== 'never') {
        toast('A shared cost cannot repeat yet. Choose a person first.', { tone: 'default' });
        return;
      }
      this.state.repeat = value;
      this.renderRepeat();
    }

    renderRepeat() {
      const el = this.el;
      const repeat = REPEATS.find((r) => r.value === this.state.repeat);
      let label = repeat?.label || 'Never';
      if (this.state.recurringLinked && this.state.mode === 'edit') label = 'Recurring';
      if (this.state.repeat !== 'never' && !this.state.recurringLinked) {
        const start = parseDate(this.state.date);
        const next = this.state.repeat === 'daily' ? new Date(start.getTime() + 86400000)
          : this.state.repeat === 'weekly' ? new Date(start.getTime() + 7 * 86400000)
            : this.state.repeat === 'monthly' ? addMonths(start, 1)
              : addYears(start, 1);
        label = `${repeat.label} · next ${shortDate(next)}`;
      }
      el.querySelector('#repeatVal').textContent = label;
    }

    renderOwner() {
      const el = this.el;
      const row = el.querySelector('#ownerRow');
      if (!hasPeople()) { row.hidden = true; el.querySelector('#splitBox').hidden = true; return; }
      row.hidden = false;
      const pills = [];
      for (const person of state.people) {
        pills.push(`<button type="button" class="own ${this.state.person === person.id ? 'on' : ''}" data-owner="${person.id}" aria-pressed="${this.state.person === person.id}">${avatar(person, 'tiny')}${escapeHtml(person.name)}</button>`);
      }
      if (hasSharedPeople() && this.state.type === 'expense') {
        pills.push(`<button type="button" class="own shared ${this.state.person === 'shared' ? 'on' : ''}" data-owner="shared" aria-pressed="${this.state.person === 'shared'}">${icon('people')}Shared</button>`);
      }
      el.querySelector('#ownerPills').innerHTML = pills.join('');
      el.querySelectorAll('[data-owner]').forEach((button) => {
        button.addEventListener('click', () => {
          this.state.person = button.dataset.owner;
          if (this.state.person === 'shared') {
            this._splitTouched = false;
            this.evenSplit();
            setDefaultOwner('shared');
          } else {
            this.state.shares = [];
            this._splitTouched = false;
            setDefaultOwner(this.state.person);
          }
          this.renderOwner();
          this.renderSplit();
        });
      });
      const shared = this.state.person === 'shared';
      el.querySelector('#splitBox').hidden = !shared;
      if (shared) this.renderSplit();
      this.renderSave();
    }

    evenSplit() {
      const total = this.state.amount || 0;
      const people = state.people;
      const each = Math.floor((total / Math.max(people.length, 1)) * 100) / 100;
      let allocated = 0;
      this.state.shares = people.map((person, index) => {
        const amount = index === people.length - 1 ? Math.round((total - allocated) * 100) / 100 : each;
        allocated = Math.round((allocated + amount) * 100) / 100;
        return { person_id: person.id, amount };
      });
      this.renderSplit();
    }

    renderSplit() {
      const box = this.el.querySelector('#splitBox');
      if (box.hidden) return;
      const rows = this.el.querySelector('#splitRows');
      if (!this.state.shares.length) this.evenSplit();
      rows.innerHTML = this.state.shares.map((share) => {
        const person = state.people.find((p) => p.id === share.person_id);
        return `<label class="split-row"><span class="split-name">${escapeHtml(person?.name || '—')}</span><span class="input split-input"><span>${escapeHtml(state.currency.symbol)}</span><input type="text" inputmode="decimal" data-share="${share.person_id}" value="${formatNumber(share.amount)}" aria-label="${escapeHtml(person?.name || '')} share"></label>`;
      }).join('');
      rows.querySelectorAll('[data-share]').forEach((input) => {
        input.addEventListener('input', () => {
          const id = input.dataset.share;
          const part = this.state.shares.find((s) => s.person_id === id);
          this._splitTouched = true;
          part.amount = parseAmount(input.value);
          this.renderSplitStatus();
        });
        input.addEventListener('blur', () => {
          input.value = formatNumber(this.state.shares.find((s) => s.person_id === input.dataset.share).amount);
        });
      });
      this.renderSplitStatus();
    }

    renderSplitStatus() {
      const total = this.state.amount;
      const split = this.state.shares.reduce((sum, s) => sum + decimal(s.amount), 0);
      const diff = Math.round((total - split) * 100) / 100;
      const status = this.el.querySelector('#splitStatus');
      status.textContent = diff === 0 ? `${money(total)} split ${this.state.shares.length} ways` : `${money(split)} of ${money(total)} — ${money(Math.abs(diff))} ${diff > 0 ? 'left' : 'over'}`;
      status.classList.toggle('bad', diff !== 0);
      this.renderSave();
    }

    renderTags() {
      const row = this.el.querySelector('#tagRow');
      const chosen = this.state.tags;
      row.innerHTML = chosen.map((tag) => `<button type="button" class="tg" data-remove-tag="${escapeHtml(tag)}" aria-label="Remove tag ${escapeHtml(tag)}">${escapeHtml(tag)} <span aria-hidden="true">×</span></button>`).join('') + `<button type="button" class="tg add" id="tagAdd">+ Add</button>`;
      row.querySelectorAll('[data-remove-tag]').forEach((button) => {
        button.addEventListener('click', () => {
          this.state.tags = this.state.tags.filter((t) => t !== button.dataset.removeTag);
          this.renderTags();
          this.renderTagPicker();
        });
      });
      row.querySelector('#tagAdd').addEventListener('click', () => {
        const picker = this.el.querySelector('#tagPicker');
        picker.hidden = !picker.hidden;
        this.renderTagPicker();
      });
    }

    renderTagPicker() {
      const list = this.el.querySelector('#tagPickerList');
      if (!list) return;
      list.innerHTML = state.tags.map((tag) => `<button type="button" class="chip2 ${this.state.tags.includes(tag) ? 'on' : ''}" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('');
      list.querySelectorAll('[data-tag]').forEach((button) => {
        button.addEventListener('click', () => {
          const tag = button.dataset.tag;
          this.state.tags = this.state.tags.includes(tag) ? this.state.tags.filter((t) => t !== tag) : [...this.state.tags, tag];
          this.renderTags();
          this.renderTagPicker();
        });
      });
    }

    renderSave() {
      const el = this.el;
      const amount = this.state.amount;
      const shared = this.state.person === 'shared';
      let splitOk = true;
      if (shared) {
        const split = this.state.shares.reduce((sum, s) => sum + decimal(s.amount), 0);
        splitOk = Math.abs(split - amount) < 0.01 && this.state.shares.length >= 2;
      }
      const valid = amount > 0 && splitOk;
      const label = this.state.mode === 'edit' ? 'Save' : (amount > 0 ? `Add ${money(amount)}` : 'Add');
      el.querySelector('#composerSubmit').textContent = label;
      el.querySelector('#composerSubmit').disabled = !valid;
      el.querySelector('.sheet-save').disabled = !valid;
      el.querySelector('.sheet-save').textContent = this.state.mode === 'edit' ? 'Save' : 'Add';
      el.querySelector('#composerSubmit').classList.toggle('is-disabled', !valid);
    }

    payload() {
      const shared = this.state.person === 'shared';
      return {
        name: this.state.name.trim(),
        category: this.state.category || (this.state.type === 'income' ? 'Income' : 'Miscellaneous'),
        tags: this.state.tags,
        amount: Math.round(this.state.amount * 100) / 100,
        type: this.state.type,
        date: this.state.date,
        person_id: shared || !this.state.person ? null : this.state.person,
        shares: shared ? this.state.shares.map((s) => ({ person_id: s.person_id, amount: Math.round(s.amount * 100) / 100 })) : [],
      };
    }

    async save() {
      if (!this.state.amount) return;
      const button = this.el.querySelector('#composerSubmit');
      button.disabled = true;
      try {
        const data = this.payload();
        if (this.state.mode === 'edit') {
          await api(`/transactions/${this.state.original.id}`, { method: 'PUT', body: JSON.stringify(data) });
          this.close();
          toast('Transaction saved.');
          this.onSaved({ mode: 'edit' });
        } else if (this.state.repeat !== 'never') {
          const start = parseDate(this.state.date);
          await api('/recurring', {
            method: 'POST',
            body: JSON.stringify({
              ...data,
              startDate: this.state.date,
              endDate: dateISO(addYears(start, 2)),
              frequency: this.state.repeat,
            }),
          });
          this.close();
          toast('Recurring transaction added.');
          this.onSaved({ mode: 'recurring' });
        } else {
          const created = await api('/transactions', { method: 'POST', body: JSON.stringify(data) });
          this.state.createdId = created?.id;
          this.close();
          toast('Transaction added.', {
            actionLabel: 'Undo',
            onAction: async () => {
              try {
                if (this.state.createdId) await api(`/transactions/${this.state.createdId}`, { method: 'DELETE' });
              } catch { /* the row may already be gone */ }
              this.onSaved({ mode: 'undo' });
            },
          });
          this.onSaved({ mode: 'add' });
        }
      } catch (error) {
        toast(error.message, { tone: 'danger' });
        button.disabled = false;
      }
    }

    async delete() {
      if (!this.state.original) return;
      const ok = await confirmDialog({
        title: 'Delete transaction?',
        message: `“${this.state.original.name || 'This transaction'}” will be removed. You can undo for six seconds.`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      try {
        await api(`/transactions/${this.state.original.id}`, { method: 'DELETE' });
        this.close();
        toast('Transaction deleted.', {
          actionLabel: 'Undo',
          duration: 6000,
          onAction: async () => {
            try {
              await api('/transactions', { method: 'POST', body: JSON.stringify(this.payload()) });
              this.onSaved({ mode: 'undo' });
            } catch (error) { toast(error.message, { tone: 'danger' }); }
          },
        });
        this.onSaved({ mode: 'delete' });
      } catch (error) { toast(error.message, { tone: 'danger' }); }
    }
  }

  /* ------------------------- boot helpers ------------------------ */
  function installThemeListener() {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', () => {
      if ((localStorage.getItem('theme') || 'system') === 'system') applyTheme();
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  return {
    API,
    state,
    MONTHS,
    escapeHtml,
    initials,
    avatar,
    avatarColor,
    personName,
    formatNumber,
    money,
    compactMoney,
    parseAmount,
    parseDate,
    dateISO,
    monthKey,
    monthLabel,
    dayLabel,
    longDate,
    shortDate,
    dateTimeLabel,
    addMonths,
    addYears,
    api,
    loadCore,
    refreshPeople,
    refreshRecurring,
    hasPeople,
    hasSharedPeople,
    defaultOwner,
    setDefaultOwner,
    applyTheme,
    setTheme,
    toast,
    openDialog,
    closeDialog,
    dialog,
    confirmDialog,
    promptDialog,
    choiceDialog,
    icon,
    categoryIcon,
    categoryColor,
    sharesFor,
    ownerLabel,
    sharedPeople,
    summarise,
    groupByDay,
    monthTransactions,
    initShell,
    applyRangeLabel,
    rangeDescription,
    rangeToFromTo,
    fetchRangeTransactions,
    openRangePopover,
    closeRangePopover,
    createTag,
    csv: { rows: csvRows, parse: csvParse, stringify: csvStringify, escape: csvEscape, tagsToCell, cellToTags },
    download,
    Composer,
    installThemeListener,
    ready,
  };
})();
