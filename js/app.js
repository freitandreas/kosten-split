// js/app.js - Hauptlogik & UI Controller

// Text sicher in HTML einsetzen (Namen mit ' oder < brechen sonst die Darstellung)
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
function euro(value) {
  return euroFormat.format(Number(value) || 0);
}

const ICON_WEITER = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function extractFileId(input) {
  if (!input) return '';
  const match = input.trim().match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match && match[1] ? match[1] : input.trim();
}

document.addEventListener('DOMContentLoaded', () => {
  let currentGroup = null;
  let currentData = { transactions: [], persons: [] };

  // DOM Elemente - Navigation & Screens
  const screenDashboard = document.getElementById('screen-dashboard');
  const screenGroup = document.getElementById('screen-group');
  const btnBack = document.getElementById('btn-back');
  const navTitle = document.getElementById('nav-title');

  // DOM Elemente - Modals
  const modalTx = document.getElementById('modal-tx');
  const modalPersons = document.getElementById('modal-persons');
  const modalAddGroup = document.getElementById('modal-add-group');

  // DOM Elemente - Add Group Modal
  const btnAddFile = document.getElementById('btn-add-file');
  const btnScanSheet = document.getElementById('btn-scan-sheet');
  const scanResults = document.getElementById('scan-results');
  let currentScannedFileId = '';
  let currentScannedFileName = '';

  // --- SCREEN SWITCHER ---
  function switchScreen(targetScreen) {
    screenDashboard.classList.remove('active');
    screenDashboard.classList.add('hidden');
    screenGroup.classList.remove('active');
    screenGroup.classList.add('hidden');

    targetScreen.classList.remove('hidden');
    targetScreen.classList.add('active');
  }

  // --- INITIALISIERUNG ---
  // init() wird erst am Ende aufgerufen, wenn alle Variablen und Event-Listener stehen.

  async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('file');
    const tabName = urlParams.get('tab');

    if (fileId && tabName) {
      Storage.saveGroup(fileId, '', tabName);
      openGroup(fileId, tabName);
    } else {
      renderDashboard();
    }
  }

  async function openGroup(fileId, tabName) {
    currentGroup = { fileId, tabName };
    window.history.pushState({}, '', `?file=${encodeURIComponent(fileId)}&tab=${encodeURIComponent(tabName)}`);

    switchScreen(screenGroup);
    btnBack.classList.remove('hidden');
    navTitle.textContent = tabName;

    await loadGroupData();
  }

  window.openGroup = openGroup;

  // --- DASHBOARD ---
  function renderDashboard() {
    switchScreen(screenDashboard);
    btnBack.classList.add('hidden');
    navTitle.textContent = "KostenSplit";

    const groups = Storage.getGroups();
    const container = document.getElementById('groups-list');
    container.innerHTML = groups.length === 0
      ? `<div class="leer">
           <strong>Noch keine Gruppe</strong>
           Verknüpfe ein Google Sheet, um Ausgaben zu sammeln und aufzuteilen.
           <div><button class="btn btn-primary" type="button" data-aktion="gruppe-hinzufuegen">Gruppe hinzufügen</button></div>
         </div>`
      : groups.map(g => `
          <button class="gruppe" type="button" data-file="${esc(g.fileId)}" data-tab="${esc(g.tabName)}">
            <span>
              <span class="gruppe-name">${esc(g.tabName)}</span>
              <span class="gruppe-datei">${esc(g.fileName || 'Google Sheet')}</span>
            </span>
            ${ICON_WEITER}
          </button>
        `).join('');
  }

  document.getElementById('groups-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-aktion="gruppe-hinzufuegen"]')) { btnAddFile.click(); return; }
    const item = e.target.closest('.gruppe');
    if (item) openGroup(item.dataset.file, item.dataset.tab);
  });

  // --- DATEN LADEN ---
  // 1. Zwischengespeicherten Stand sofort anzeigen
  // 2. Direkt aus dem Google Sheet lesen (gviz-CSV, schnell, braucht Freigabe "Jeder mit dem Link")
  // 3. Wenn das nicht geht: wie bisher über das Apps Script
  const syncStatus = document.getElementById('sync-status');
  let loadTicket = 0;

  function setSyncStatus(text) {
    syncStatus.textContent = text;
    syncStatus.classList.toggle('hidden', !text);
  }

  function applyData(data) {
    currentData = { transactions: data.transactions || [], persons: data.persons || [] };
    currentData.persons.forEach(p => Storage.addGlobalPerson(p.name));
    renderGroupView();
  }

  async function fetchGroupData(fileId, tabName) {
    try {
      const csv = await SheetCSV.loadGroup(fileId, tabName);
      // Ohne Personen im Tab "_persons" (ältere Gruppen) liefert das Apps Script sie
      // und trägt sie dabei ins Sheet ein. Ab dann klappt das direkte Lesen vollständig.
      if (csv.persons && csv.persons.length) return { data: csv, source: 'csv' };
    } catch (err) {
      console.info('Direktes Lesen aus dem Sheet nicht möglich, nutze Apps Script:', err.message);
    }
    const res = await API.request('getData', { fileId, tabName });
    return { data: { transactions: res.transactions || [], persons: res.persons || [] }, source: 'gas' };
  }

  async function loadGroupData() {
    const { fileId, tabName } = currentGroup;
    const ticket = ++loadTicket;
    const cached = Storage.getCachedGroup(fileId, tabName);

    if (cached) {
      applyData(Storage.applyPending(fileId, tabName, cached));
      setSyncStatus('Aktualisiere …');
    } else {
      currentData = { transactions: [], persons: [] };
      renderGroupView();
      setSyncStatus('Lädt …');
    }

    try {
      const { data, source } = await fetchGroupData(fileId, tabName);
      if (ticket !== loadTicket) return; // inzwischen wurde eine andere Gruppe geöffnet
      // Die CSV kann ein paar Sekunden hinterherhinken: eigene Änderungen darüberlegen
      const fresh = source === 'csv' ? Storage.applyPending(fileId, tabName, data) : data;
      Storage.cacheGroup(fileId, tabName, fresh);
      applyData(fresh);
      setSyncStatus('');
    } catch (err) {
      if (ticket !== loadTicket) return;
      if (cached) {
        const when = new Date(cached.savedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
        setSyncStatus(`Gespeicherter Stand vom ${when}. Aktualisieren fehlgeschlagen: ${err.message}`);
      } else {
        setSyncStatus('');
        alert("Fehler beim Laden: " + err.message);
      }
    }
  }

  /** Lokale Änderung merken: im Zwischenspeicher und als "ausstehend", bis die CSV sie zeigt. */
  function rememberChange(change) {
    Storage.markPending(currentGroup.fileId, currentGroup.tabName, change);
    Storage.cacheGroup(currentGroup.fileId, currentGroup.tabName, currentData);
  }

  /** Nach einem fehlgeschlagenen Speichern: ausstehende Änderung verwerfen und neu laden. */
  function revertChange(change) {
    Storage.unmarkPending(currentGroup.fileId, currentGroup.tabName, change);
    loadGroupData();
  }

  // --- GRUPPEN-ANSICHT ---
  function renderGroupView() {
    const activePersons = currentData.persons.filter(p => !p.archived);
    const balances = Balances.calculate(currentData.transactions, activePersons);
    const ausgaben = currentData.transactions.filter(tx => !tx.compensation);
    const gesamt = ausgaben.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);

    // Summe mit Textmarker
    document.getElementById('group-summary').innerHTML = `
      <p class="summe-label">Ausgaben gesamt</p>
      <p class="summe-betrag">${euro(gesamt)}</p>
      <p class="summe-info">${activePersons.length} ${activePersons.length === 1 ? 'Person' : 'Personen'}, ${ausgaben.length} ${ausgaben.length === 1 ? 'Ausgabe' : 'Ausgaben'}</p>`;

    // Salden als Balken um die Nulllinie
    const eintraege = Object.entries(balances);
    const maxBetrag = Math.max(0.01, ...eintraege.map(([, v]) => Math.abs(v)));
    document.getElementById('balances-list').innerHTML = eintraege.length === 0
      ? '<p class="hinweis-text">Noch keine Personen. Lege fest, wer mitzahlt.</p>'
      : eintraege.map(([name, val]) => {
          const rund = Math.round(val * 100) / 100;
          const art = rund > 0 ? 'plus' : rund < 0 ? 'minus' : 'null';
          const text = rund > 0 ? `bekommt <b>${euro(rund)}</b>` : rund < 0 ? `schuldet <b>${euro(-rund)}</b>` : 'ausgeglichen';
          const breite = Math.min(50, (Math.abs(rund) / maxBetrag) * 50);
          return `
            <div class="saldo ${art}">
              <div class="saldo-kopf">
                <span class="saldo-name">${esc(name)}</span>
                <span class="saldo-wert">${text}</span>
              </div>
              <div class="saldo-balken" aria-hidden="true"><span style="width:${breite.toFixed(2)}%"></span></div>
            </div>`;
        }).join('');

    // Ausgaben als Kassenbon, neueste zuerst, nach Tagen gruppiert
    const anzahl = currentData.transactions.length;
    document.getElementById('tx-count').textContent = anzahl ? `${anzahl} ${anzahl === 1 ? 'Eintrag' : 'Einträge'}` : '';
    const liste = document.getElementById('transactions-list');
    if (currentData.transactions.length === 0) {
      liste.innerHTML = `
        <div class="bon-leer">
          <strong>Noch keine Ausgaben</strong>
          Tippe auf „Ausgabe“, um die erste einzutragen.
        </div>`;
      return;
    }

    const mitDatum = currentData.transactions.map((tx, index) => {
      const d = tx.timestamp ? new Date(tx.timestamp) : null;
      return { tx, index, datum: d && !Number.isNaN(d.getTime()) ? d : null };
    });
    mitDatum.sort((a, b) => (b.datum ? b.datum.getTime() : -Infinity) - (a.datum ? a.datum.getTime() : -Infinity) || b.index - a.index);

    const diesesJahr = new Date().getFullYear();
    let letzterTag = null;
    let html = '';
    mitDatum.forEach(({ tx, datum }) => {
      const tag = datum ? datum.toISOString().slice(0, 10) : 'ohne';
      if (tag !== letzterTag) {
        letzterTag = tag;
        const label = datum
          ? datum.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', ...(datum.getFullYear() !== diesesJahr ? { year: 'numeric' } : {}) })
          : 'Ohne Datum';
        html += `<p class="bon-tag">${esc(label)}</p>`;
      }
      const empfaenger = Object.keys(tx.splits || {}).filter(n => Number(tx.splits[n]) > 0);
      const info = tx.compensation
        ? `${esc(tx.payer)} an ${esc(empfaenger.join(', ') || '…')}`
        : `${esc(tx.payer)} hat bezahlt`;
      html += `
        <button class="posten${tx.compensation ? ' ausgleich' : ''}" type="button" data-id="${esc(tx.id)}">
          <span class="posten-zeile">
            <span class="posten-titel">${esc(tx.description || (tx.compensation ? 'Ausgleichszahlung' : 'Ausgabe'))}</span>
            <span class="posten-fuell" aria-hidden="true"></span>
            <span class="posten-betrag">${euro(tx.amount)}</span>
          </span>
          <span class="posten-info">${info}${tx.compensation ? ', Rückzahlung' : tx.category ? `, ${esc(tx.category)}` : ''}</span>
        </button>`;
    });
    html += `<div class="bon-fuss"><span>Summe</span><span>${euro(gesamt)}</span></div>`;
    liste.innerHTML = html;
  }

  document.getElementById('transactions-list').addEventListener('click', (e) => {
    const posten = e.target.closest('.posten');
    if (posten) window.editTransaction(posten.dataset.id);
  });

  // --- TRANSAKTION ERSTELLEN / BEARBEITEN / LÖSCHEN ---
  const formTx = document.getElementById('form-tx');
  const txAmountInput = document.getElementById('tx-amount');
  const txAutoSplitCheckbox = document.getElementById('tx-auto-split');
  const btnTxDelete = document.getElementById('btn-tx-delete');

  function calculateAutoSplit() {
    if (!txAutoSplitCheckbox.checked) return;
    const totalAmount = parseFloat(txAmountInput.value) || 0;
    const inputs = document.querySelectorAll('.split-input');
    if (inputs.length === 0) return;

    const share = (totalAmount / inputs.length).toFixed(2);
    inputs.forEach(input => {
      input.value = share;
      input.readOnly = true;
    });
  }

  txAutoSplitCheckbox.addEventListener('change', () => {
    const inputs = document.querySelectorAll('.split-input');
    if (txAutoSplitCheckbox.checked) {
      calculateAutoSplit();
    } else {
      inputs.forEach(input => input.readOnly = false);
    }
  });

  txAmountInput.addEventListener('input', () => {
    if (txAutoSplitCheckbox.checked) {
      calculateAutoSplit();
    }
  });

  function renderSplitsInputs(persons, existingSplits = null) {
    const container = document.getElementById('tx-splits-container');
    container.innerHTML = persons.map((p, i) => {
      const val = existingSplits ? (existingSplits[p.name] || 0) : 0;
      return `
        <div class="split-row">
          <label for="split-${i}">${esc(p.name)}</label>
          <input type="number" step="0.01" inputmode="decimal" class="split-input" id="split-${i}" data-person="${esc(p.name)}" value="${val}">
        </div>
      `;
    }).join('');

    if (txAutoSplitCheckbox.checked && !existingSplits) {
      calculateAutoSplit();
    }
    updateSplitSum();
  }

  // Zeigt, ob die Anteile zusammen den Betrag ergeben
  const splitSumme = document.getElementById('tx-splits-summe');
  function updateSplitSum() {
    const betrag = parseFloat(txAmountInput.value) || 0;
    const summe = [...document.querySelectorAll('.split-input')].reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
    const differenz = Math.round((betrag - summe) * 100) / 100;
    const abweichung = betrag > 0 && Math.abs(differenz) >= 0.05;
    splitSumme.classList.toggle('abweichung', abweichung);
    if (!betrag) splitSumme.textContent = '';
    else if (!abweichung) splitSumme.textContent = `Anteile ergeben ${euro(summe)}`;
    else if (differenz > 0) splitSumme.textContent = `Anteile ergeben ${euro(summe)}, es fehlen ${euro(differenz)}`;
    else splitSumme.textContent = `Anteile ergeben ${euro(summe)}, das sind ${euro(-differenz)} zu viel`;
  }
  document.getElementById('tx-splits-container').addEventListener('input', updateSplitSum);
  txAmountInput.addEventListener('input', updateSplitSum);
  txAutoSplitCheckbox.addEventListener('change', updateSplitSum);

  document.getElementById('btn-add-tx').addEventListener('click', () => {
    const activePersons = currentData.persons.filter(p => !p.archived);
    if (activePersons.length === 0) {
      alert('Bitte füge zuerst mindestens eine Person hinzu.');
      return;
    }

    formTx.reset();
    document.getElementById('tx-id').value = '';
    document.getElementById('tx-date').value = new Date().toISOString().split('T')[0]; // Standard: Heute
    document.getElementById('tx-category').value = '';
    document.getElementById('modal-tx-title').textContent = 'Neue Ausgabe';
    txAutoSplitCheckbox.checked = true;
    btnTxDelete.classList.add('hidden');

    const payerSelect = document.getElementById('tx-payer');
    payerSelect.innerHTML = activePersons.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');

    renderSplitsInputs(activePersons);
    modalTx.classList.remove('hidden');
  });

  window.editTransaction = function(txId) {
    const tx = currentData.transactions.find(t => t.id === txId);
    if (!tx) return;

    const activePersons = currentData.persons.filter(p => !p.archived);
    
    document.getElementById('tx-id').value = tx.id;
    document.getElementById('tx-desc').value = tx.description || '';
    document.getElementById('tx-amount').value = tx.amount;
    
    // Datum setzen
    if (tx.timestamp) {
      const d = new Date(tx.timestamp);
      document.getElementById('tx-date').value = !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
    } else {
      document.getElementById('tx-date').value = new Date().toISOString().split('T')[0];
    }

    document.getElementById('tx-category').value = tx.category || '';
    document.getElementById('tx-compensation').checked = !!tx.compensation;
    document.getElementById('modal-tx-title').textContent = 'Ausgabe bearbeiten';
    txAutoSplitCheckbox.checked = false;
    btnTxDelete.classList.remove('hidden');

    const payerSelect = document.getElementById('tx-payer');
    payerSelect.innerHTML = activePersons.map(p =>
      `<option value="${esc(p.name)}" ${p.name === tx.payer ? 'selected' : ''}>${esc(p.name)}</option>`
    ).join('');

    renderSplitsInputs(activePersons, tx.splits);
    modalTx.classList.remove('hidden');
  };

  btnTxDelete.addEventListener('click', async () => {
    const txId = document.getElementById('tx-id').value;
    if (!txId) return;

    if (!confirm('Möchtest du diese Ausgabe wirklich löschen?')) return;

    currentData.transactions = currentData.transactions.filter(t => t.id !== txId);
    modalTx.classList.add('hidden');
    renderGroupView();
    rememberChange({ deletedId: txId });

    try {
      await API.request('deleteTransaction', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, id: txId });
    } catch (err) {
      alert("Fehler beim Löschen: " + err.message);
      revertChange({ deletedId: txId });
    }
  });

  function getFormSplits() {
    const splits = {};
    document.querySelectorAll('.split-input').forEach(input => {
      splits[input.dataset.person] = parseFloat(input.value) || 0;
    });
    return splits;
  }

  formTx.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (document.getElementById('b_honeypot').value !== '') return;

    const dateVal = document.getElementById('tx-date').value;
    const isoTimestamp = dateVal ? new Date(dateVal).toISOString() : new Date().toISOString();

    const tx = {
      id: document.getElementById('tx-id').value || 'tx_' + Date.now(),
      timestamp: isoTimestamp,
      description: document.getElementById('tx-desc').value,
      amount: parseFloat(document.getElementById('tx-amount').value),
      category: document.getElementById('tx-category').value.trim(),
      payer: document.getElementById('tx-payer').value,
      compensation: document.getElementById('tx-compensation').checked,
      splits: getFormSplits()
    };

    const existingIndex = currentData.transactions.findIndex(t => t.id === tx.id);
    if (existingIndex >= 0) currentData.transactions[existingIndex] = tx;
    else currentData.transactions.unshift(tx);

    modalTx.classList.add('hidden');
    renderGroupView();
    rememberChange({ tx });

    try {
      await API.request('saveTransaction', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, transaction: tx });
    } catch (err) {
      alert("Fehler beim Speichern: " + err.message);
      revertChange({ txId: tx.id });
    }
  });

  document.getElementById('btn-tx-cancel').addEventListener('click', () => modalTx.classList.add('hidden'));

  // --- PERSONEN VERWALTEN & PROJEKTÜBERGREIFENDE VORSCHLÄGE ---
  document.getElementById('btn-manage-persons').addEventListener('click', () => {
    renderPersonsList();
    modalPersons.classList.remove('hidden');
  });

  document.getElementById('btn-persons-close').addEventListener('click', () => {
    modalPersons.classList.add('hidden');
    renderGroupView();
  });

  function renderPersonsList() {
    const container = document.getElementById('persons-list');
    container.innerHTML = currentData.persons.length === 0
      ? '<p class="hinweis-text">Noch niemand in dieser Gruppe.</p>'
      : currentData.persons.map((p, idx) => `
        <div class="person${p.archived ? ' archiviert' : ''}">
          <span class="person-name">${esc(p.name)}</span>
          <button class="btn btn-secondary" type="button" data-index="${idx}">
            ${p.archived ? 'Wiederherstellen' : 'Archivieren'}
          </button>
        </div>
      `).join('');

    const globalPersons = Storage.getGlobalPersons();
    const currentPersonNames = currentData.persons.map(p => p.name.toLowerCase());
    const suggestions = globalPersons.filter(name => !currentPersonNames.includes(name.toLowerCase()));

    const suggestionsBox = document.getElementById('person-suggestions-box');
    const suggestionsContainer = document.getElementById('person-suggestions');

    if (suggestions.length === 0) {
      suggestionsBox.classList.add('hidden');
    } else {
      suggestionsBox.classList.remove('hidden');
      suggestionsContainer.innerHTML = suggestions.map(name => `
        <button class="chip" type="button" data-name="${esc(name)}">+ ${esc(name)}</button>
      `).join('');
    }
  }

  document.getElementById('persons-list').addEventListener('click', (e) => {
    const knopf = e.target.closest('[data-index]');
    if (knopf) window.toggleArchivePerson(Number(knopf.dataset.index));
  });
  document.getElementById('person-suggestions').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-name]');
    if (chip) addPersonByName(chip.dataset.name);
  });

  async function addPersonByName(name) {
    if (!name) return;
    if (currentData.persons.some(p => p.name.toLowerCase() === name.toLowerCase())) return;

    currentData.persons.push({ name, archived: false });
    Storage.addGlobalPerson(name);

    renderPersonsList();
    rememberChange({ persons: currentData.persons });

    try {
      await API.request('savePersons', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, persons: currentData.persons });
    } catch (err) {
      alert("Fehler beim Speichern der Person: " + err.message);
      revertChange({ persons: true });
    }
  }

  window.addPersonByName = addPersonByName;

  document.getElementById('btn-add-person').addEventListener('click', () => {
    const input = document.getElementById('new-person-name');
    const name = input.value.trim();
    if (!name) return;

    addPersonByName(name);
    input.value = '';
    input.focus();
  });
  document.getElementById('new-person-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-person').click(); }
  });

  window.toggleArchivePerson = async function(index) {
    currentData.persons[index].archived = !currentData.persons[index].archived;
    renderPersonsList();
    rememberChange({ persons: currentData.persons });

    try {
      await API.request('savePersons', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, persons: currentData.persons });
    } catch (err) {
      alert("Fehler beim Aktualisieren: " + err.message);
      revertChange({ persons: true });
    }
  };

  // --- SHEET / GRUPPE VERKNÜPFEN MODAL ---
  btnAddFile.addEventListener('click', () => {
    document.getElementById('sheet-url-id').value = '';
    scanResults.classList.add('hidden');

    // Bekannte Dateien anzeigen
    const uniqueFiles = Storage.getUniqueFiles();
    const knownFilesBox = document.getElementById('known-files-box');
    const knownFilesList = document.getElementById('known-files-list');

    if (uniqueFiles.length > 0) {
      knownFilesBox.classList.remove('hidden');
      knownFilesList.innerHTML = uniqueFiles.map(f => `
        <div class="auswahl">
          <span class="auswahl-text">
            <strong>${esc(f.fileName)}</strong>
            <small>${esc(f.fileId)}</small>
          </span>
          <button class="btn btn-secondary" type="button" data-file-id="${esc(f.fileId)}">Auswählen</button>
        </div>
      `).join('');
    } else {
      knownFilesBox.classList.add('hidden');
    }

    modalAddGroup.classList.remove('hidden');
  });

  document.getElementById('known-files-list').addEventListener('click', (e) => {
    const knopf = e.target.closest('[data-file-id]');
    if (knopf) window.selectKnownFile(knopf.dataset.fileId);
  });

  window.selectKnownFile = function(fileId) {
    document.getElementById('sheet-url-id').value = fileId;
    btnScanSheet.click(); // Automatisch den Scan ausführen
  };

  document.getElementById('btn-add-group-cancel').addEventListener('click', () => {
    modalAddGroup.classList.add('hidden');
  });

  btnScanSheet.addEventListener('click', async () => {
    const rawInput = document.getElementById('sheet-url-id').value;
    if (!rawInput) return alert('Bitte gib eine URL oder File ID ein.');

    currentScannedFileId = extractFileId(rawInput);
    document.getElementById('sheet-url-id').value = currentScannedFileId;
    
    try {
      btnScanSheet.textContent = 'Scanne …';
      btnScanSheet.disabled = true;
      const res = await API.request('scan', { fileId: currentScannedFileId });
      currentScannedFileName = res.fileName;
      Storage.getGroups()
        .filter(g => g.fileId === currentScannedFileId)
        .forEach(g => Storage.saveGroup(g.fileId, res.fileName, g.tabName));

      const tabsContainer = document.getElementById('existing-tabs-list');
      const verknuepft = new Set(Storage.getGroups().filter(g => g.fileId === currentScannedFileId).map(g => g.tabName));
      if (res.validTabs.length === 0) {
        tabsContainer.innerHTML = '<p class="hinweis-text">In diesem Sheet gibt es noch keine Gruppe.</p>';
      } else {
        tabsContainer.innerHTML = res.validTabs.map(tab => `
          <div class="auswahl">
            <span class="auswahl-text"><strong>${esc(tab)}</strong>${verknuepft.has(tab) ? '<small>Bereits verknüpft</small>' : ''}</span>
            <button class="btn ${verknuepft.has(tab) ? 'btn-secondary' : 'btn-primary'}" type="button" data-tab="${esc(tab)}"${verknuepft.has(tab) ? ' data-oeffnen' : ''}>${verknuepft.has(tab) ? 'Öffnen' : 'Hinzufügen'}</button>
          </div>
        `).join('');
      }

      scanResults.classList.remove('hidden');
    } catch (err) {
      alert('Fehler beim Scannen: ' + err.message);
    } finally {
      btnScanSheet.textContent = 'Sheet scannen';
      btnScanSheet.disabled = false;
    }
  });

  document.getElementById('existing-tabs-list').addEventListener('click', (e) => {
    const knopf = e.target.closest('[data-tab]');
    if (!knopf) return;
    if (knopf.hasAttribute('data-oeffnen')) {
      modalAddGroup.classList.add('hidden');
      openGroup(currentScannedFileId, knopf.dataset.tab);
    } else {
      window.importGroup(currentScannedFileId, currentScannedFileName, knopf.dataset.tab);
    }
  });

  window.importGroup = function(fileId, fileName, tabName) {
    Storage.saveGroup(fileId, fileName, tabName);
    modalAddGroup.classList.add('hidden');
    renderDashboard();
  };

  document.getElementById('btn-create-tab').addEventListener('click', async () => {
    const tabName = document.getElementById('new-tab-name').value.trim();
    if (!tabName) return alert('Bitte gib einen Namen für die Gruppe ein.');

    try {
      await API.request('createTab', {}, { fileId: currentScannedFileId, tabName: tabName, persons: [] });
      Storage.saveGroup(currentScannedFileId, currentScannedFileName || tabName, tabName);
      modalAddGroup.classList.add('hidden');
      renderDashboard();
    } catch (err) {
      alert('Fehler beim Erstellen des Tabs: ' + err.message);
    }
  });

  // --- DIALOGE: Escape schließt ---
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!modalPersons.classList.contains('hidden')) { document.getElementById('btn-persons-close').click(); return; }
    [modalTx, modalAddGroup].forEach(m => m.classList.add('hidden'));
  });

  // --- NAVIGATION ---
  btnBack.addEventListener('click', () => {
    window.history.pushState({}, '', window.location.pathname);
    renderDashboard();
  });

  init();
});