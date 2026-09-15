const STORAGE_KEY = 'kostensplit_groups';
const ALL_PERSONS_KEY = 'kostensplit_all_persons';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzlDke4foZxaBcN5FWZYoH6uHhdc80L53OsHld93Q6ArDW5ptaY5ehqyRb2FOMlKPYe/exec';

const Storage = {
  getGasUrl() {
    return GAS_URL;
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
  },
  // Globale Personen verwalten
  getGlobalPersons() {
    return JSON.parse(localStorage.getItem(ALL_PERSONS_KEY) || '[]');
  },
  addGlobalPerson(name) {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const persons = this.getGlobalPersons();
    if (!persons.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      persons.push(trimmed);
      localStorage.setItem(ALL_PERSONS_KEY, JSON.stringify(persons));
    }
  }
};