// js/app.js - Hauptlogik & UI Controller

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

  // --- SCREEN SWITCHER (Verhindert leere Seiten) ---
  function switchScreen(targetScreen) {
    screenDashboard.classList.remove('active');
    screenDashboard.classList.add('hidden');
    screenGroup.classList.remove('active');
    screenGroup.classList.add('hidden');

    targetScreen.classList.remove('hidden');
    targetScreen.classList.add('active');
  }

  // --- INITIALISIERUNG ---
  init();

  async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const fileId = urlParams.get('file');
    const tabName = urlParams.get('tab');

    if (fileId && tabName) {
      Storage.saveGroup(fileId, tabName, tabName);
      openGroup(fileId, tabName);
    } else {
      renderDashboard();
    }
  }

  async function openGroup(fileId, tabName) {
    currentGroup = { fileId, tabName };
    window.history.pushState({}, '', `?file=${fileId}&tab=${tabName}`);

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
      ? '<p class="text-muted">Noch keine Gruppen verknüpft.</p>'
      : groups.map(g => `
          <div class="card group-item" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px;" onclick="openGroup('${g.fileId}', '${g.tabName}')">
            <div>
              <strong>${g.tabName}</strong>
              <div style="font-size:0.8rem; color:#64748b;">${g.fileName}</div>
            </div>
            <span>→</span>
          </div>
        `).join('');
  }

  async function loadGroupData() {
    try {
      const res = await API.request('getData', { fileId: currentGroup.fileId, tabName: currentGroup.tabName });
      currentData = {
        transactions: res.transactions || [],
        persons: res.persons || []
      };

      // Geladene Personen direkt im globalen Storage registrieren
      currentData.persons.forEach(p => Storage.addGlobalPerson(p.name));

      renderGroupView();
    } catch (err) {
      alert("Fehler beim Laden: " + err.message);
    }
  }

  // --- GRUPPEN-ANSICHT ---
  function renderGroupView() {
    const activePersons = currentData.persons.filter(p => !p.archived);
    const balances = Balances.calculate(currentData.transactions, activePersons);
    
    document.getElementById('balances-list').innerHTML = Object.entries(balances).length === 0
      ? '<p class="text-muted" style="font-size:0.85rem;">Keine aktiven Personen angelegt.</p>'
      : Object.entries(balances).map(([name, val]) => `
        <div class="balance-row" style="display:flex; justify-content:space-between; padding:4px 0;">
          <span>${name}</span>
          <span class="${val >= 0 ? 'balance-positive' : 'balance-negative'}" style="font-weight:bold; color: ${val >= 0 ? '#10b981' : '#ef4444'}">${val.toFixed(2)} €</span>
        </div>
      `).join('');

    document.getElementById('transactions-list').innerHTML = currentData.transactions.length === 0
      ? '<p class="text-muted">Noch keine Ausgaben eingetragen.</p>'
      : currentData.transactions.map(tx => `
        <div class="card tx-item" style="cursor:pointer; display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px;" onclick="editTransaction('${tx.id}')">
          <div>
            <strong>${tx.description || (tx.compensation ? 'Ausgleichszahlung' : 'Ausgabe')}</strong>
            <div class="payer-info" style="font-size:0.8rem; color:#64748b;">Bezahlt von ${tx.payer}</div>
          </div>
          <div class="amount" style="font-weight:bold;">${Number(tx.amount).toFixed(2)} €</div>
        </div>
      `).join('');
  }

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
    container.innerHTML = persons.map(p => {
      const val = existingSplits ? (existingSplits[p.name] || 0) : 0;
      return `
        <div class="split-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <span>${p.name}</span>
          <input type="number" step="0.01" class="split-input" data-person="${p.name}" value="${val}" style="width:90px;">
        </div>
      `;
    }).join('');

    if (txAutoSplitCheckbox.checked && !existingSplits) {
      calculateAutoSplit();
    }
  }

  document.getElementById('btn-add-tx').addEventListener('click', () => {
    const activePersons = currentData.persons.filter(p => !p.archived);
    if (activePersons.length === 0) {
      alert('Bitte füge zuerst mindestens eine Person hinzu.');
      return;
    }

    formTx.reset();
    document.getElementById('tx-id').value = '';
    document.getElementById('modal-tx-title').textContent = 'Neue Ausgabe';
    txAutoSplitCheckbox.checked = true;
    btnTxDelete.classList.add('hidden'); // Beim Erstellen ausblenden

    const payerSelect = document.getElementById('tx-payer');
    payerSelect.innerHTML = activePersons.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

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
    document.getElementById('tx-compensation').checked = !!tx.compensation;
    document.getElementById('modal-tx-title').textContent = 'Ausgabe bearbeiten';
    txAutoSplitCheckbox.checked = false;
    btnTxDelete.classList.remove('hidden'); // Beim Bearbeiten anzeigen

    const payerSelect = document.getElementById('tx-payer');
    payerSelect.innerHTML = activePersons.map(p => 
      `<option value="${p.name}" ${p.name === tx.payer ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    renderSplitsInputs(activePersons, tx.splits);
    modalTx.classList.remove('hidden');
  };

  btnTxDelete.addEventListener('click', async () => {
    const txId = document.getElementById('tx-id').value;
    if (!txId) return;

    if (!confirm('Möchtest du diese Ausgabe wirklich löschen?')) return;

    // Optimistic UI Update
    currentData.transactions = currentData.transactions.filter(t => t.id !== txId);
    modalTx.classList.add('hidden');
    renderGroupView();

    try {
      await API.request('deleteTransaction', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, id: txId });
    } catch (err) {
      alert("Fehler beim Löschen: " + err.message);
      loadGroupData();
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

    const tx = {
      id: document.getElementById('tx-id').value || 'tx_' + Date.now(),
      timestamp: new Date().toISOString(),
      description: document.getElementById('tx-desc').value,
      amount: parseFloat(document.getElementById('tx-amount').value),
      payer: document.getElementById('tx-payer').value,
      compensation: document.getElementById('tx-compensation').checked,
      splits: getFormSplits()
    };

    const existingIndex = currentData.transactions.findIndex(t => t.id === tx.id);
    if (existingIndex >= 0) currentData.transactions[existingIndex] = tx;
    else currentData.transactions.unshift(tx);

    modalTx.classList.add('hidden');
    renderGroupView();

    try {
      await API.request('saveTransaction', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, transaction: tx });
    } catch (err) {
      alert("Fehler beim Speichern: " + err.message);
      loadGroupData();
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
    // 1. Liste der Personen im aktuellen Projekt
    const container = document.getElementById('persons-list');
    container.innerHTML = currentData.persons.length === 0
      ? '<p class="text-muted" style="margin-top:10px;">Noch keine Personen angelegt.</p>'
      : currentData.persons.map((p, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
          <span style="${p.archived ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${p.name}</span>
          <button class="btn btn-sm btn-secondary" onclick="toggleArchivePerson(${idx})">
            ${p.archived ? 'Wiederherstellen' : 'Archivieren'}
          </button>
        </div>
      `).join('');

    // 2. Vorschläge aus anderen Projekten rendern
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
        <button class="btn btn-sm btn-secondary" style="background:#e2e8f0; border:none; font-size:0.8rem;" onclick="addPersonByName('${name}')">
          + ${name}
        </button>
      `).join('');
    }
  }

  async function addPersonByName(name) {
    if (!name) return;
    if (currentData.persons.some(p => p.name.toLowerCase() === name.toLowerCase())) return;

    currentData.persons.push({ name, archived: false });
    Storage.addGlobalPerson(name); // Auch im Storage registrieren

    renderPersonsList();

    try {
      await API.request('savePersons', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, persons: currentData.persons });
    } catch (err) {
      alert("Fehler beim Speichern der Person: " + err.message);
    }
  }

  window.addPersonByName = addPersonByName;

  document.getElementById('btn-add-person').addEventListener('click', () => {
    const input = document.getElementById('new-person-name');
    const name = input.value.trim();
    if (!name) return;

    addPersonByName(name);
    input.value = '';
  });

  window.toggleArchivePerson = async function(index) {
    currentData.persons[index].archived = !currentData.persons[index].archived;
    renderPersonsList();

    try {
      await API.request('savePersons', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, persons: currentData.persons });
    } catch (err) {
      alert("Fehler beim Aktualisieren: " + err.message);
    }
  };

  // --- SHEET / GRUPPE VERKNÜPFEN MODAL ---
  btnAddFile.addEventListener('click', () => {
    document.getElementById('sheet-url-id').value = '';
    scanResults.classList.add('hidden');
    modalAddGroup.classList.remove('hidden');
  });

  document.getElementById('btn-add-group-cancel').addEventListener('click', () => {
    modalAddGroup.classList.add('hidden');
  });

  btnScanSheet.addEventListener('click', async () => {
    const rawInput = document.getElementById('sheet-url-id').value;
    if (!rawInput) return alert('Bitte gib eine URL oder File ID ein.');

    currentScannedFileId = extractFileId(rawInput);
    document.getElementById('sheet-url-id').value = currentScannedFileId;
    
    try {
      btnScanSheet.textContent = 'Scanne...';
      const res = await API.request('scan', { fileId: currentScannedFileId });
      currentScannedFileName = res.fileName;

      const tabsContainer = document.getElementById('existing-tabs-list');
      if (res.validTabs.length === 0) {
        tabsContainer.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">Keine gültigen Gruppen-Tabs gefunden.</p>';
      } else {
        tabsContainer.innerHTML = res.validTabs.map(tab => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid var(--border); margin-bottom:6px;">
            <span>${tab}</span>
            <button class="btn btn-sm btn-primary" onclick="importGroup('${currentScannedFileId}', '${currentScannedFileName}', '${tab}')">Hinzufügen</button>
          </div>
        `).join('');
      }

      scanResults.classList.remove('hidden');
    } catch (err) {
      alert('Fehler beim Scannen: ' + err.message);
    } finally {
      btnScanSheet.textContent = 'Sheet scannen';
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

  // --- NAVIGATION ---
  btnBack.addEventListener('click', () => {
    window.history.pushState({}, '', window.location.pathname);
    renderDashboard();
  });
});