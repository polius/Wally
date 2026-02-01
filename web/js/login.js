const API_URL = '/api';

// Initialize i18n
(async function() {
  await i18n.init();
  i18n.showPage();
})();

checkLogin();

async function checkLogin() {
  const response = await fetch(`${API_URL}/login/check`, {
    method: 'GET',
    credentials: 'include',
  });
  if (response.ok) window.location.href = '/';
}

async function login(event) {
  event.preventDefault();

  // Disable the submit button
  const submitButton = document.getElementById("submit");
  const submitLoading = document.getElementById("loading");
  submitButton.setAttribute("disabled", "");
  submitLoading.style.display = 'inline-flex';

  // Get form data
  const formData = new FormData(event.target);
  const data = Object.fromEntries(formData.entries());

  // Perform login
  try {
    const response = await fetch(`${API_URL}/login`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    const json = await response.json()

    if (!response.ok) {
      if (response.status === 401) throw new Error(i18n.t('login.invalid_password'))
      throw new Error(i18n.t('login.error_occurred'))
    }
    else {
      window.location.href = '/';
    }
  }
  catch (error) {
    // Show error message
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})

    // Enable login button
    submitButton.removeAttribute("disabled");
    submitLoading.style.display = 'none';
  }
}

async function recoverPassword(event) {
  event.preventDefault()

  try {
    const response = await fetch(`${API_URL}/login/recover`, {
      method: 'POST',
      credentials: 'include',
    });

    const json = await response.json()

    if (!response.ok) {
      throw new Error(i18n.t('login.error_occurred'));
    }
    else {
      const message = i18n.t('login.recovery_message').replace('{file}', json.file);
      bootstrap.showToast({body: message, delay: 30000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-primary"});
    }
  }
  catch (error) {
    bootstrap.showToast({body: `${error}`, delay: 2000, position: "top-0 start-50 translate-middle-x", toastClass: "text-bg-danger"})
  }
}
