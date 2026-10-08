// js/sheet-csv.js - Schnelles Lesen direkt aus dem Google Sheet (gviz-CSV)
//
// Voraussetzung: Das Sheet ist für "Jeder mit dem Link" als Betrachter freigegeben.
// Ist es das nicht, schlägt der Abruf fehl und app.js liest wie bisher über das Apps Script.

const PERSONS_TAB = '_persons';
const TX_HEADERS = ['id', 'timestamp', 'payer', 'amount', 'category', 'description', 'compensation', 'splits'];
const PERSON_HEADERS = ['tab', 'name', 'archived'];

const SheetCSV = {
  parseCsv(text) {
    const rows = [];
    let row = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (char === '"') {
        if (inQuotes && next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        row.push(current);
        current = '';
      } else if ((char === '\n' || char === '\r') && !inQuotes) {
        if (current !== '' || row.length) {
          row.push(current);
          rows.push(row);
          row = [];
          current = '';
        }
        if (char === '\r' && next === '\n') {
          i += 1;
        }
      } else {
        current += char;
      }
    }
    if (current !== '' || row.length) {
      row.push(current);
      rows.push(row);
    }
    return rows;
  },

  /** Liest einen Tab als { headers, rows } mit kleingeschriebenen Spaltennamen. */
  async loadTab(fileId, tabName) {
    const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(fileId)}`
      + `/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(tabName)}&_=${Date.now()}`;
    let response;
    try {
      response = await fetch(url);
    } catch (e) {
      // Nicht freigegebene Sheets leiten auf die Google-Anmeldung um, das blockiert der Browser (CORS)
      throw new Error('Sheet ist nicht öffentlich lesbar');
    }
    if (!response.ok) throw new Error(`Sheet antwortet mit ${response.status}`);
    const text = await response.text();
    if (/^\s*</.test(text)) throw new Error('Sheet hat HTML statt CSV geliefert');

    const rows = this.parseCsv(text);
    const headers = (rows[0] || []).map(h => h.trim().toLowerCase());
    const body = rows.slice(1)
      .filter(r => r.some(cell => cell.trim() !== ''))
      .map(r => Object.fromEntries(headers.map((h, i) => [h, (r[i] || '').trim()])));
    return { headers, rows: body };
  },

  hasHeaders(table, required) {
    return required.every(h => table.headers.includes(h));
  },

  /**
   * Lädt Ausgaben und Personen einer Gruppe.
   * persons ist null, wenn das Sheet noch keinen Tab "_persons" hat (dann liefert das Apps Script sie).
   */
  async loadGroup(fileId, tabName) {
    const [txTable, personTable] = await Promise.all([
      this.loadTab(fileId, tabName),
      this.loadTab(fileId, PERSONS_TAB).catch(() => null),
    ]);

    // Achtung: Für einen unbekannten Tab-Namen liefert gviz stillschweigend den ERSTEN Tab.
    // Darum werden die Spalten geprüft, bevor den Daten vertraut wird.
    if (!this.hasHeaders(txTable, TX_HEADERS)) throw new Error('Tab hat nicht die erwarteten Spalten');

    const transactions = txTable.rows
      .filter(r => r.id)
      .map(r => ({
        id: r.id,
        timestamp: this.toIsoDate(r.timestamp),
        payer: r.payer,
        amount: this.toNumber(r.amount) ?? 0,
        category: r.category,
        description: r.description,
        compensation: this.toBool(r.compensation),
        splits: this.toSplits(r.splits),
      }));

    let persons = null;
    if (personTable && this.hasHeaders(personTable, PERSON_HEADERS)) {
      persons = personTable.rows
        .filter(r => r.tab === tabName && r.name)
        .map(r => ({ name: r.name, archived: this.toBool(r.archived) }));
    }

    return { transactions, persons };
  },

  /* ---------- Werte aus der CSV deuten (gviz liefert die formatierte Anzeige) ---------- */

  /** "12.5", "12,50", "1.234,56", "1,234.56", "€ 12,50" → Zahl */
  toNumber(value) {
    let s = String(value || '').replace(/[^\d.,-]/g, '');
    if (!s || s === '-') return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastDot > -1 && lastComma > -1) {
      const decimal = lastDot > lastComma ? '.' : ',';
      s = s.split(decimal === '.' ? ',' : '.').join('').replace(decimal, '.');
    } else if (lastComma > -1) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (lastDot > -1) {
      s = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  },

  toBool(value) {
    return /^(true|wahr|ja|yes|1|x)$/i.test(String(value || '').trim());
  },

  toSplits(value) {
    if (!value) return {};
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  },

  /** ISO-Text, "15.09.2026 02:00:00" oder "9/15/2026 2:00:00" → ISO-String */
  toIsoDate(value) {
    const s = String(value || '').trim();
    if (!s) return '';
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return this.buildDate(m[3], m[2], m[1], m[4], m[5], m[6]);
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m) return this.buildDate(m[3], m[1], m[2], m[4], m[5], m[6]);
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toISOString();
  },

  buildDate(year, month, day, h, min, sec) {
    const y = Number(year) < 100 ? 2000 + Number(year) : Number(year);
    // Nur ein Datum: als UTC-Mitternacht, wie die App selbst Datumswerte speichert.
    // Mit Uhrzeit: als lokale Zeit (Zeitzone des Sheets ≈ Zeitzone des Browsers).
    const d = h === undefined
      ? new Date(Date.UTC(y, Number(month) - 1, Number(day)))
      : new Date(y, Number(month) - 1, Number(day), Number(h), Number(min) || 0, Number(sec) || 0);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString();
  },
};
