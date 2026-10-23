const I18N_STORAGE_KEY = 'language';
const DEFAULT_LANG = 'en';

class I18n {
  constructor() {
    this.locale = DEFAULT_LANG;
    this.translations = {};
    this.fallbackTranslations = {};
    this.onLanguageChangeCallbacks = [];
  }

  async init() {
    this.locale = await this.getLanguagePreference();
    await this.loadTranslations(this.locale);
    this.updatePage();
  }

  async getLanguagePreference() {
    // First check localStorage (fast path)
    const localLang = localStorage.getItem(I18N_STORAGE_KEY);
    
    if (localLang) {
      return localLang;
    }
    
    // If not in localStorage, fetch from API
    let language = DEFAULT_LANG;
    try {
      const response = await fetch('/api/language');
      if (response.ok) {
        const data = await response.json();
        language = data.language;
        // Store in localStorage for next time
        localStorage.setItem(I18N_STORAGE_KEY, language);
      }
    } catch (error) {
      console.error('Error fetching language from API:', error);
    }
    return language;
  }

  async loadTranslations(lang) {
    this.locale = lang;
    document.documentElement.lang = lang;
    const cache = '4';

    try {
      const response = await fetch(`locales/${lang}.json?v=${cache}`);
      if (!response.ok) {
        throw new Error(`Could not load translations for ${lang}`);
      }
      this.translations = await response.json();
    } catch (error) {
      console.error('Error loading translations:', error);
      if (lang !== DEFAULT_LANG) {
        await this.loadTranslations(DEFAULT_LANG);
        return;
      }
      this.translations = {};
    }

    // English is the source of truth. A locale that has not caught up with a
    // new key falls back to English instead of printing the raw key.
    try {
      if (lang === DEFAULT_LANG) {
        this.fallbackTranslations = this.translations;
      } else {
        const fallbackResponse = await fetch(`locales/${DEFAULT_LANG}.json?v=${cache}`);
        this.fallbackTranslations = fallbackResponse.ok ? await fallbackResponse.json() : {};
      }
    } catch (error) {
      console.error('Error loading English fallback:', error);
      this.fallbackTranslations = {};
    }
  }

  async setLanguage(lang) {
    // Save user's explicit language choice to localStorage
    localStorage.setItem(I18N_STORAGE_KEY, lang);
    
    // Save to backend
    try {
      const response = await fetch(`/api/language/${lang}`, {
        method: 'PUT',
        credentials: 'include',
      });
      
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
      
      if (!response.ok) {
        console.error('Failed to save language to backend');
      }
    } catch (error) {
      console.error('Error saving language:', error);
    }
    
    await this.loadTranslations(lang);
    this.updatePage();
    this.onLanguageChangeCallbacks.forEach(callback => callback());
  }

  onLanguageChange(callback) {
    this.onLanguageChangeCallbacks.push(callback);
  }

  t(key) {
    const read = (source) => key.split('.').reduce((obj, k) => obj?.[k], source);
    const value = read(this.translations) ?? read(this.fallbackTranslations);
    if (typeof value === 'string') return value;

    // Never print a raw dotted key. If neither locale has it (for example a
    // new label that has not reached the English file yet), show the last
    // segment as plain words until the translation lands.
    const label = String(key).split('.').pop()?.replace(/_/g, ' ') || '';
    return label ? label.charAt(0).toUpperCase() + label.slice(1) : String(key);
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
