// js/app.js - Hauptlogik & UI Controller

// Hilfsfunktion: Extrahiert die ID aus einer Google Sheet URL oder nimmt direkte ID
function extractFileId(urlOrId) {
  if (!urlOrId) return '';
  const match = urlOrId.match(/[-\w]{25,}/);
  return match ? match[0] : urlOrId.trim();
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

  // --- INITIALISIERUNG ---
  init();

  async function init() {
    if (!Storage.getGasUrl()) {
      const url = prompt("Bitte gib deine Google Apps Script Web-App URL ein:");
      if (url) Storage.setGasUrl(url.trim());
    }

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

  // --- DASHBOARD ---
  function renderDashboard() {
    screenGroup.classList.add('hidden');
    screenDashboard.classList.add('active');
    btnBack.classList.add('hidden');
    navTitle.textContent = "KostenSplit";

    const groups = Storage.getGroups();
    const container = document.getElementById('groups-list');
    container.innerHTML = groups.length === 0 
      ? '<p class="text-muted">Noch keine Gruppen verknüpft.</p>'
      : groups.map(g => `
          <div class="card group-item" onclick="openGroup('${g.fileId}', '${g.tabName}')">
            <div>
              <strong>${g.tabName}</strong>
              <div style="font-size:0.8rem; color:#64748b;">${g.fileName}</div>
            </div>
            <span>→</span>
          </div>
        `).join('');
  }

  window.openGroup = async function(fileId, tabName) {
    currentGroup = { fileId, tabName };
    window.history.pushState({}, '', `?file=${fileId}&tab=${tabName}`);

    screenDashboard.classList.remove('active');
    screenGroup.classList.add('active');
    btnBack.classList.remove('hidden');
    navTitle.textContent = tabName;

    await loadGroupData();
  };

  async function loadGroupData() {
    try {
      const res = await API.request('getData', { fileId: currentGroup.fileId, tabName: currentGroup.tabName });
      currentData = {
        transactions: res.transactions || [],
        persons: res.persons || []
      };
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
        <div class="balance-row">
          <span>${name}</span>
          <span class="${val >= 0 ? 'balance-positive' : 'balance-negative'}">${val.toFixed(2)} €</span>
        </div>
      `).join('');

    document.getElementById('transactions-list').innerHTML = currentData.transactions.length === 0
      ? '<p class="text-muted">Noch keine Ausgaben eingetragen.</p>'
      : currentData.transactions.map(tx => `
        <div class="card tx-item" onclick="editTransaction('${tx.id}')">
          <div>
            <strong>${tx.description || (tx.compensation ? 'Ausgleichszahlung' : 'Ausgabe')}</strong>
            <div class="payer-info">Bezahlt von ${tx.payer}</div>
          </div>
          <div class="amount">${Number(tx.amount).toFixed(2)} €</div>
        </div>
      `).join('');
  }

  // --- TRANSAKTION ERSTELLEN / BEARBEITEN & AUTOMATISCHER SPLIT ---
  const formTx = document.getElementById('form-tx');
  const txAmountInput = document.getElementById('tx-amount');
  const txAutoSplitCheckbox = document.getElementById('tx-auto-split');

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
        <div class="split-row">
          <span>${p.name}</span>
          <input type="number" step="0.01" class="split-input" data-person="${p.name}" value="${val}">
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

    const payerSelect = document.getElementById('tx-payer');
    payerSelect.innerHTML = activePersons.map(p => 
      `<option value="${p.name}" ${p.name === tx.payer ? 'selected' : ''}>${p.name}</option>`
    ).join('');

    renderSplitsInputs(activePersons, tx.splits);
    modalTx.classList.remove('hidden');
  };

  function getFormSplits() {
    const splits = {};
    document.querySelectorAll('.split-input').forEach(input => {
      splits[input.dataset.person] = parseFloat(input.value) || 0;
    });
    return splits;
  }

  formTx.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Honeypot Prüfung
    if (document.getElementById('b_honeypot').value !== '') {
      console.warn("Bot erkannt.");
      return;
    }

    const tx = {
      id: document.getElementById('tx-id').value || 'tx_' + Date.now(),
      timestamp: new Date().toISOString(),
      description: document.getElementById('tx-desc').value,
      amount: parseFloat(document.getElementById('tx-amount').value),
      payer: document.getElementById('tx-payer').value,
      compensation: document.getElementById('tx-compensation').checked,
      splits: getFormSplits()
    };

    // Optimistic UI
    const existingIndex = currentData.transactions.findIndex(t => t.id === tx.id);
    if (existingIndex >= 0) currentData.transactions[existingIndex] = tx;
    else currentData.transactions.unshift(tx);

    modalTx.classList.add('hidden');
    renderGroupView();

    try {
      await API.request('saveTransaction', { fileId: currentGroup.fileId, tabName: currentGroup.tabName }, { transaction: tx });
    } catch (err) {
      alert("Fehler beim Speichern: " + err.message);
      loadGroupData();
    }
  });

  document.getElementById('btn-tx-cancel').addEventListener('click', () => modalTx.classList.add('hidden'));

  // --- PERSONEN VERWALTEN & ARCHIVIEREN ---
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
      ? '<p class="text-muted" style="margin-top:10px;">Noch keine Personen angelegt.</p>'
      : currentData.persons.map((p, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border);">
          <span style="${p.archived ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${p.name}</span>
          <button class="btn btn-sm btn-secondary" onclick="toggleArchivePerson(${idx})">
            ${p.archived ? 'Wiederherstellen' : 'Archivieren'}
          </button>
        </div>
      `).join('');
  }

  document.getElementById('btn-add-person').addEventListener('click', async () => {
    const input = document.getElementById('new-person-name');
    const name = input.value.trim();
    if (!name) return;

    if (currentData.persons.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      alert('Eine Person mit diesem Namen existiert bereits.');
      return;
    }

    currentData.persons.push({ name, archived: false });
    input.value = '';
    renderPersonsList();

    try {
      await API.request('savePersons', {}, { fileId: currentGroup.fileId, tabName: currentGroup.tabName, persons: currentData.persons });
    } catch (err) {
      alert("Fehler beim Speichern der Person: " + err.message);
    }
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
    const input = document.getElementById('sheet-url-id').value;
    if (!input) return alert('Bitte gib eine URL oder File ID ein.');

    currentScannedFileId = extractFileId(input);
    
    try {
      btnScanSheet.textContent = 'Scanne...';
      const res = await API.request('scan', { fileId: currentScannedFileId });
      currentScannedFileName = res.fileName;

      const tabsContainer = document.getElementById('existing-tabs-list');
      if (res.validTabs.length === 0) {
        tabsContainer.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">Keine gültigen Gruppen-Tabs gefunden.</p>';
      } else {
        tabsContainer.innerHTML = res.validTabs.map(tab => `
          <div style="display:flex; justify-content:space-between; align-items:center; background:#f8fafc; padding:8px 12px; border-radius:6px; border:1px solid var(--border);">
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