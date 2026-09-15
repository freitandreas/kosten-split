// Hauptlogik & UI Controller
document.addEventListener('DOMContentLoaded', () => {
  let currentGroup = null;
  let currentData = { transactions: [], persons: [] };

  // DOM Elemente
  const screenDashboard = document.getElementById('screen-dashboard');
  const screenGroup = document.getElementById('screen-group');
  const btnBack = document.getElementById('btn-back');
  const modalTx = document.getElementById('modal-tx');
  const modalPersons = document.getElementById('modal-persons');

  // Initialisierung: URL Parameter prüfen
  init();

  async function init() {
    // GAS URL beim ersten Mal abfragen falls nicht im LocalStorage
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

  function renderDashboard() {
    screenGroup.classList.add('hidden');
    screenDashboard.classList.add('active');
    btnBack.classList.add('hidden');
    document.getElementById('nav-title').textContent = "KostenSplit";

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

  async function openGroup(fileId, tabName) {
    currentGroup = { fileId, tabName };
    window.history.pushState({}, '', `?file=${fileId}&tab=${tabName}`);

    screenDashboard.classList.remove('active');
    screenGroup.classList.add('active');
    btnBack.classList.remove('hidden');
    document.getElementById('nav-title').textContent = tabName;

    // Fast-Load ausführen
    await loadGroupData();
  }

  async function loadGroupData() {
    try {
      const res = await API.request('getData', { fileId: currentGroup.fileId, tabName: currentGroup.tabName });
      currentData = res;
      renderGroupView();
    } catch (err) {
      alert("Fehler beim Laden: " + err.message);
    }
  }

  function renderGroupView() {
    // Bilanzen rendern
    const activePersons = currentData.persons.filter(p => !p.archived);
    const balances = Balances.calculate(currentData.transactions, activePersons);
    
    document.getElementById('balances-list').innerHTML = Object.entries(balances).map(([name, val]) => `
      <div class="balance-row">
        <span>${name}</span>
        <span class="${val >= 0 ? 'balance-positive' : 'balance-negative'}">${val.toFixed(2)} €</span>
      </div>
    `).join('');

    // Transaktionen rendern
    document.getElementById('transactions-list').innerHTML = currentData.transactions.map(tx => `
      <div class="card tx-item" onclick="editTransaction('${tx.id}')">
        <div>
          <strong>${tx.description || (tx.compensation ? 'Ausgleichszahlung' : 'Ausgabe')}</strong>
          <div class="payer-info">Bezahlt von ${tx.payer}</div>
        </div>
        <div class="amount">${Number(tx.amount).toFixed(2)} €</div>
      </div>
    `).join('');
  }

  // Honeypot & Transaktionsformular Handler
  document.getElementById('form-tx').addEventListener('submit', async (e) => {
    e.preventDefault();

    // Honeypot Prüfung: Falls gefüllt, handelt es sich um einen Bot
    if (document.getElementById('b_honeypot').value !== '') {
      console.warn("Bot erkannt.");
      return;
    }

    const tx = {
      id: document.getElementById('tx-id').value || 'tx_' + Date.now(),
      description: document.getElementById('tx-desc').value,
      amount: parseFloat(document.getElementById('tx-amount').value),
      payer: document.getElementById('tx-payer').value,
      compensation: document.getElementById('tx-compensation').checked,
      splits: getFormSplits()
    };

    // Optimistic UI: Sofort lokal hinzufügen & rendern
    const existingIndex = currentData.transactions.findIndex(t => t.id === tx.id);
    if (existingIndex >= 0) currentData.transactions[existingIndex] = tx;
    else currentData.transactions.unshift(tx);

    modalTx.classList.add('hidden');
    renderGroupView();

    // In Google Sheets speichern (im Hintergrund)
    try {
      await API.request('saveTransaction', { fileId: currentGroup.fileId, tabName: currentGroup.tabName }, { transaction: tx });
    } catch (err) {
      alert("Fehler beim Speichern in Google Sheets: " + err.message);
      loadGroupData(); // Rollback
    }
  });

  function getFormSplits() {
    const splits = {};
    document.querySelectorAll('.split-input').forEach(input => {
      splits[input.dataset.person] = parseFloat(input.value) || 0;
    });
    return splits;
  }

  // Navigation
  btnBack.addEventListener('click', () => {
    window.history.pushState({}, '', window.location.pathname);
    renderDashboard();
  });

  document.getElementById('btn-add-tx').addEventListener('click', () => {
    document.getElementById('form-tx').reset();
    document.getElementById('tx-id').value = '';
    
    // Zahler-Dropdown befüllen
    const activePersons = currentData.persons.filter(p => !p.archived);
    const payerSelect = document.getElementById('tx-payer');
    payerSelect.innerHTML = activePersons.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

    // Aufteilung-Container befüllen
    renderSplitsInputs(activePersons);
    modalTx.classList.remove('hidden');
  });

  function renderSplitsInputs(persons) {
    const container = document.getElementById('tx-splits-container');
    container.innerHTML = persons.map(p => `
      <div class="split-row">
        <span>${p.name}</span>
        <input type="number" step="0.01" class="split-input" data-person="${p.name}" value="0">
      </div>
    `).join('');
  }

  document.getElementById('btn-tx-cancel').addEventListener('click', () => modalTx.classList.add('hidden'));
});