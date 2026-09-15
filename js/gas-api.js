// js/gas-api.js - Kommunikation mit Google Apps Script (Fehlertolerant)

const API = {
  async request(action, params = {}, postData = null) {
    const baseUrl = Storage.getGasUrl();
    if (!baseUrl) throw new Error("Keine Apps Script Web-App URL hinterlegt.");

    let url = `${baseUrl}?action=${action}`;
    Object.keys(params).forEach(k => url += `&${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`);

    const options = {};
    if (postData) {
      options.method = 'POST';
      options.body = JSON.stringify({ action, ...params, ...postData });
    }

    const res = await fetch(url, options);
    const rawText = await res.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      console.error("Server-Antwort (kein JSON):", rawText);
      throw new Error("Der Server hat HTML statt JSON zurückgegeben. Überprüfe, ob bei 'Wer hat Zugriff' die Option 'Jeder' gewählt ist und die URL auf /exec endet.");
    }

    if (!data.success) throw new Error(data.error || 'API Fehler');
    return data;
  }
};