const STORAGE_KEY = 'kostensplit_groups';
const ALL_PERSONS_KEY = 'kostensplit_all_persons';
const CACHE_PREFIX = 'kostensplit_cache_';
const PENDING_PREFIX = 'kostensplit_pending_';
const PENDING_MS = 3 * 60 * 1000; // so lange gilt eine eigene Änderung, bis die CSV sie sicher zeigt
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzlDke4foZxaBcN5FWZYoH6uHhdc80L53OsHld93Q6ArDW5ptaY5ehqyRb2FOMlKPYe/exec';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Speicher voll oder privater Modus: App funktioniert weiter, nur ohne Zwischenspeicher
  }
}

const groupKey = (fileId, tabName) => `${fileId}::${tabName}`;

const Storage = {
  getGasUrl() {
    return GAS_URL;
  },

  getGroups() {
    return readJson(STORAGE_KEY, []);
  },

  saveGroup(fileId, fileName, tabName) {
    const groups = this.getGroups();
    const existing = groups.find(g => g.fileId === fileId && g.tabName === tabName);
    if (!existing) {
      groups.push({ fileId, fileName: fileName || '', tabName });
    } else if (fileName && existing.fileName !== fileName) {
      existing.fileName = fileName; // z. B. echter Dateiname nach einem Scan
    } else {
      return;
    }
    writeJson(STORAGE_KEY, groups);
  },

  /** Jede verknüpfte Datei einmal, mit dem besten bekannten Namen. */
  getUniqueFiles() {
    const files = new Map();
    this.getGroups().forEach(g => {
      // Ältere Versionen haben beim Öffnen per Link den Tab-Namen als Dateinamen gespeichert
      const echterName = g.fileName && g.fileName !== g.tabName ? g.fileName : '';
      const bekannt = files.get(g.fileId);
      if (!bekannt) {
        files.set(g.fileId, { fileId: g.fileId, fileName: echterName || g.fileName || g.fileId, echt: Boolean(echterName) });
      } else if (echterName && !bekannt.echt) {
        bekannt.fileName = echterName;
        bekannt.echt = true;
      }
    });
    return [...files.values()].map(({ fileId, fileName }) => ({ fileId, fileName }));
  },

  // Globale Personen verwalten
  getGlobalPersons() {
    return readJson(ALL_PERSONS_KEY, []);
  },

  addGlobalPerson(name) {
    if (!name || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const persons = this.getGlobalPersons();
    if (!persons.some(p => p.toLowerCase() === trimmed.toLowerCase())) {
      persons.push(trimmed);
      writeJson(ALL_PERSONS_KEY, persons);
    }
  },

  /* ---------- Zwischenspeicher: Gruppe sofort anzeigen, dann im Hintergrund aktualisieren ---------- */

  getCachedGroup(fileId, tabName) {
    return readJson(CACHE_PREFIX + groupKey(fileId, tabName), null);
  },

  cacheGroup(fileId, tabName, data) {
    writeJson(CACHE_PREFIX + groupKey(fileId, tabName), {
      transactions: data.transactions,
      persons: data.persons,
      savedAt: Date.now(),
    });
  },

  /* ---------- Eigene Änderungen, bis die (leicht verzögerte) CSV sie ebenfalls liefert ---------- */

  getPending(fileId, tabName) {
    const pending = readJson(PENDING_PREFIX + groupKey(fileId, tabName), { tx: {}, deleted: {}, persons: null });
    const now = Date.now();
    Object.keys(pending.tx).forEach(id => { if (pending.tx[id].until < now) delete pending.tx[id]; });
    Object.keys(pending.deleted).forEach(id => { if (pending.deleted[id] < now) delete pending.deleted[id]; });
    if (pending.persons && pending.persons.until < now) pending.persons = null;
    return pending;
  },

  markPending(fileId, tabName, change) {
    const pending = this.getPending(fileId, tabName);
    const until = Date.now() + PENDING_MS;
    if (change.tx) {
      pending.tx[change.tx.id] = { tx: change.tx, until };
      delete pending.deleted[change.tx.id];
    }
    if (change.deletedId) {
      pending.deleted[change.deletedId] = until;
      delete pending.tx[change.deletedId];
    }
    if (change.persons) pending.persons = { list: change.persons, until };
    writeJson(PENDING_PREFIX + groupKey(fileId, tabName), pending);
  },

  unmarkPending(fileId, tabName, change) {
    const pending = this.getPending(fileId, tabName);
    if (change.txId) delete pending.tx[change.txId];
    if (change.deletedId) delete pending.deleted[change.deletedId];
    if (change.persons) pending.persons = null;
    writeJson(PENDING_PREFIX + groupKey(fileId, tabName), pending);
  },

  /** Eigene, noch nicht in der CSV sichtbare Änderungen über die geladenen Daten legen. */
  applyPending(fileId, tabName, data) {
    const pending = this.getPending(fileId, tabName);
    let transactions = data.transactions.filter(tx => !pending.deleted[tx.id]);
    Object.values(pending.tx).forEach(({ tx }) => {
      const i = transactions.findIndex(t => t.id === tx.id);
      if (i >= 0) transactions[i] = tx;
      else transactions = [...transactions, tx];
    });
    return {
      transactions,
      persons: pending.persons ? pending.persons.list : data.persons,
    };
  },
};
