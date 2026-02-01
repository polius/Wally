const I18N_STORAGE_KEY = 'language';
const DEFAULT_LANG = 'en';

class I18n {
  constructor() {
    this.locale = localStorage.getItem(I18N_STORAGE_KEY) || DEFAULT_LANG;
    this.translations = {};
    this.onLanguageChangeCallbacks = [];
  }

  async init() {
    await this.loadTranslations(this.locale);
    this.updatePage();
  }

  async loadTranslations(lang) {
    this.locale = lang;
    localStorage.setItem(I18N_STORAGE_KEY, lang);
    document.documentElement.lang = lang;

    try {
      const response = await fetch(`locales/${lang}.json`);
      if (!response.ok) {
        throw new Error(`Could not load translations for ${lang}`);
      }
      this.translations = await response.json();
    } catch (error) {
      console.error('Error loading translations:', error);
      if (lang !== DEFAULT_LANG) {
        await this.loadTranslations(DEFAULT_LANG);
      }
    }
  }

  async setLanguage(lang) {
    await this.loadTranslations(lang);
    this.updatePage();
    this.onLanguageChangeCallbacks.forEach(callback => callback());
  }

  onLanguageChange(callback) {
    this.onLanguageChangeCallbacks.push(callback);
  }

  get currentLanguage() {
    return this.locale;
  }

  t(key) {
    const keys = key.split('.');
    let value = this.translations;
    for (const k of keys) {
      if (value && value[k]) {
        value = value[k];
      } else {
        return key;
      }
    }
    return value;
  }

  updatePage() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.textContent = this.t(key);
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      el.placeholder = this.t(key);
    });

    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      el.title = this.t(key);
    });

    const docTitleKey = document.body.getAttribute('data-i18n-document-title');
    if (docTitleKey) {
      document.title = this.t(docTitleKey);
    }
  }

  showPage() {
    document.body.classList.add('i18n-loaded');
  }
}

const i18n = new I18n();
