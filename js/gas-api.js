// Kommunikation mit Google Apps Script
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
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'API Fehler');
    return data;
  }
};