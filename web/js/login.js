(() => {
  const $ = (id) => document.getElementById(id);

  function updateThemeButton() {
    const resolved = document.documentElement.dataset.theme || 'light';
    const button = $('loginTheme');
    button.innerHTML = W.icon(resolved === 'dark' ? 'sun' : 'moon');
    button.setAttribute('aria-label', resolved === 'dark' ? 'Use light appearance' : 'Use dark appearance');
  }

  function showError(message) {
    const field = $('passwordField');
    const error = $('loginError');
    field.classList.add('err');
    $('loginErrorText').textContent = message;
    error.hidden = false;
    $('passwordInput').setAttribute('aria-invalid', 'true');
    $('passwordInput').focus();
  }

  function clearError() {
    $('passwordField').classList.remove('err');
    $('loginError').hidden = true;
    $('passwordInput').removeAttribute('aria-invalid');
  }

  async function checkLogin() {
    try {
      const response = await fetch('/api/login/check', { credentials: 'include' });
      if (response.ok) location.replace('/');
    } catch {
      /* offline: leave the form in place */
    }
  }

  async function submit(event) {
    event.preventDefault();
    clearError();
    const password = $('passwordInput').value;
    if (!password) {
      showError('Enter the password.');
      return;
    }
    const button = $('loginButton');
    const label = $('loginButtonLabel');
    button.disabled = true;
    label.textContent = 'Checking…';
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!response.ok) {
        if (response.status === 401) showError(i18n.t('login.invalid_password') || 'That password is not right.');
        else showError('The ledger could not be reached. Try again.');
        return;
      }
      location.replace('/');
    } catch {
      showError('The ledger could not be reached. Try again.');
    } finally {
      button.disabled = false;
      label.textContent = 'Continue';
    }
  }

  async function recover() {
    const ok = await W.confirmDialog({
      title: 'Use the recovery file',
      message: 'Wally writes a single-use password to /wally/password.txt on the host. Sign in with it, and the file is deleted. Anyone who can read that file can enter this ledger.',
      confirmLabel: 'Generate password',
    });
    if (!ok) return;
    try {
      const response = await fetch('/api/login/recover', { method: 'POST', credentials: 'include' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.detail || 'The recovery file could not be written.');
      await W.dialog({
        title: 'Recovery password written',
        description: 'One use, then it is gone.',
        body: `<p class="dialog-message">Open the file on the host and copy the password.</p>
          <div class="keybox">${W.escapeHtml(json.file || '/wally/password.txt')}</div>
          <p class="card-note">The next successful sign-in deletes the file. If you do not use it, generate another to replace it.</p>`,
        confirmLabel: 'Done',
        cancelLabel: 'Close',
      });
    } catch (error) {
      W.toast(error.message, { tone: 'danger' });
    }
  }

  function reveal() {
    const input = $('passwordInput');
    const button = $('passwordReveal');
    const showing = input.type === 'text';
    input.type = showing ? 'password' : 'text';
    button.innerHTML = W.icon(showing ? 'eye' : 'eyeOff');
    button.setAttribute('aria-pressed', String(!showing));
    button.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
    input.focus();
  }

  W.ready(async () => {
    W.applyTheme();
    updateThemeButton();
    $('passwordReveal').innerHTML = W.icon('eyeOff');
    $('loginTheme').addEventListener('click', () => {
      const resolved = document.documentElement.dataset.theme || 'light';
      W.setTheme(resolved === 'dark' ? 'light' : 'dark');
      updateThemeButton();
    });
    $('passwordReveal').addEventListener('click', reveal);
    $('passwordInput').addEventListener('input', clearError);
    $('loginForm').addEventListener('submit', submit);
    $('forgotButton').addEventListener('click', recover);
    await i18n.init();
    checkLogin();
  });
})();
