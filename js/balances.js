// Berechnungen für Salden und Schulden
const Balances = {
  calculate(transactions, persons) {
    const balances = {};
    persons.forEach(p => balances[p.name] = 0);

    transactions.forEach(tx => {
      const amount = Number(tx.amount) || 0;
      const payer = tx.payer;
      const splits = tx.splits || {};

      if (balances[payer] === undefined) balances[payer] = 0;

      if (tx.compensation) {
        // Ausgleichszahlung: Payer gibt dem Payee das Geld zurück
        Object.entries(splits).forEach(([payee, val]) => {
          if (balances[payee] === undefined) balances[payee] = 0;
          balances[payer] += Number(val);
          balances[payee] -= Number(val);
        });
      } else {
        // Normale Ausgabe: Payer schießt vor
        balances[payer] += amount;
        Object.entries(splits).forEach(([payee, val]) => {
          if (balances[payee] === undefined) balances[payee] = 0;
          balances[payee] -= Number(val);
        });
      }
    });

    return balances;
  }
};