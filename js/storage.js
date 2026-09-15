// Storage Manager für LocalStorage
const STORAGE_KEY = 'kostensplit_groups';
const GAS_URL_KEY = 'https://script.google.com/macros/s/AKfycbzlDke4foZxaBcN5FWZYoH6uHhdc80L53OsHld93Q6ArDW5ptaY5ehqyRb2FOMlKPYe/exec';

const Storage = {
  getGasUrl() {
    return localStorage.getItem(GAS_URL_KEY) || '';
  },
  setGasUrl(url) {
    localStorage.setItem(GAS_URL_KEY, url);
  },
  getGroups() {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
  },
  saveGroup(fileId, fileName, tabName) {
    const groups = this.getGroups();
    const exists = groups.some(g => g.fileId === fileId && g.tabName === tabName);
    if (!exists) {
      groups.push({ fileId, fileName, tabName });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(groups));
    }
  }
};