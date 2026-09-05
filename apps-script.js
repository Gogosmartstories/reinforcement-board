const DEFAULT_APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbyp0F3HN3KNIeQG0i_oDAepZXvw95eZX_ROXTGXVDJ1Bab-QfXiBe1or3zM5ToVRabtDQ/exec';

const UPSTREAM_TIMEOUT_MS = 50000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'manual'
    });
  } finally {
    clearTimeout(timer);
  }
}

async function followGoogleRedirects(url, options = {}) {
  let currentUrl = url;
  let method = options.method || 'GET';
  let body = options.body;
  let headers = options.headers || {};

  for (let i = 0; i < 5; i++) {
    const response = await fetchWithTimeout(currentUrl, {
      method,
      headers,
      body
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Google أعاد تحويلًا بدون رابط.');

      currentUrl = new URL(location, currentUrl).toString();

      // Apps Script commonly returns 302/303 to googleusercontent
      // after the script execution. Continue that redirect as GET.
      if (response.status === 302 || response.status === 303) {
        method = 'GET';
        body = undefined;
        headers = { Accept: 'application/json' };
      }

      continue;
    }

    return response;
  }

  throw new Error('عدد تحويلات Google أكبر من المتوقع.');
}

async function parseUpstream(upstream, res) {
  const text = await upstream.text();

  try {
    const data = JSON.parse(text);
    return res.status(upstream.ok ? 200 : upstream.status).json(data);
  } catch {
    return res.status(502).json({
      success: false,
      error: 'Apps Script أعاد استجابة غير JSON.',
      upstreamStatus: upstream.status,
      preview: text.slice(0, 160)
    });
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const appsScriptUrl =
    process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;

  try {
    if (req.method === 'GET') {
      const target = new URL(appsScriptUrl);

      Object.entries(req.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          value.forEach(v => target.searchParams.append(key, String(v)));
        } else if (value !== undefined && value !== null) {
          target.searchParams.set(key, String(value));
        }
      });

      const upstream = await followGoogleRedirects(target.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });

      return parseUpstream(upstream, res);
    }

    if (req.method === 'POST') {
      const upstream = await followGoogleRedirects(appsScriptUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(req.body || {})
      });

      return parseUpstream(upstream, res);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({
      success: false,
      error: 'طريقة الطلب غير مدعومة.'
    });
  } catch (error) {
    const message =
      error?.name === 'AbortError'
        ? 'انتهت مهلة الاتصال بـ Google Apps Script.'
        : (error?.message || 'حدث خطأ غير متوقع في الخادم.');

    return res.status(502).json({
      success: false,
      error: message
    });
  }
}
