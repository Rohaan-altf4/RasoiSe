// Small fetch helper for the RasoiSe API.
// Always sends the session cookie, parses JSON, and turns errors into ApiError with a
// human message that can be shown directly to the user.

(function () {
  class ApiError extends Error {
    constructor(message, status, code, fields) {
      super(message);
      this.status = status;
      this.code = code;
      this.fields = fields || null;
    }
  }

  async function request(method, url, body) {
    const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new ApiError('You seem to be offline. Check your connection and try again.', 0, 'NETWORK');
    }

    let data = null;
    try { data = await res.json(); } catch (e) { /* empty body */ }

    if (!res.ok) {
      const err = new ApiError((data && data.error) || 'Something went wrong. Please try again.', res.status, data && data.code, data && data.fields);
      // Session expired while on a page that needs login
      if (res.status === 401 && !url.startsWith('/api/auth/')) {
        const next = encodeURIComponent(location.pathname + location.search);
        setTimeout(() => { location.href = `/login.html?next=${next}`; }, 1200);
      }
      throw err;
    }
    return data;
  }

  window.ApiError = ApiError;
  window.API = {
    get: url => request('GET', url),
    post: (url, body = {}) => request('POST', url, body),
    put: (url, body = {}) => request('PUT', url, body),
    del: url => request('DELETE', url),
    upload: (url, formData) => request('POST', url, formData)
  };
})();
