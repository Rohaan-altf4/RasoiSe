// Tiny HTTP client for the API tests. Keeps the session cookie like a browser would.

class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async req(method, path, body, isForm = false) {
    const headers = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      if (isForm) payload = body;
      else {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }
    }
    const res = await fetch(this.base + path, { method, headers, body: payload, redirect: 'manual' });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const pair = setCookie.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    let data = null;
    const type = res.headers.get('content-type') || '';
    if (type.includes('json')) data = await res.json();
    else data = await res.text();
    return { status: res.status, data, headers: res.headers };
  }

  get(p) { return this.req('GET', p); }
  post(p, b = {}) { return this.req('POST', p, b); }
  put(p, b = {}) { return this.req('PUT', p, b); }
  del(p) { return this.req('DELETE', p); }
}

module.exports = Client;
