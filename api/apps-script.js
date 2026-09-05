const DEFAULT_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyp0F3HN3KNIeQG0i_oDAepZXvw95eZX_ROXTGXVDJ1Bab-QfXiBe1or3zM5ToVRabtDQ/exec';

export default async function handler(req, res) {
  const appsScriptUrl = process.env.APPS_SCRIPT_URL || DEFAULT_APPS_SCRIPT_URL;
  try {
    if (req.method === 'GET') {
      const target = new URL(appsScriptUrl);
      Object.entries(req.query || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) value.forEach(v => target.searchParams.append(key, v));
        else if (value !== undefined && value !== null) target.searchParams.set(key, String(value));
      });
      const upstream = await fetch(target, { method: 'GET', redirect: 'follow', headers: { Accept: 'application/json' } });
      const text = await upstream.text();
      res.setHeader('Cache-Control', 'no-store');
      try { return res.status(upstream.ok ? 200 : upstream.status).json(JSON.parse(text)); }
      catch { return res.status(502).json({ success:false, error:'استجابة غير متوقعة من Apps Script.' }); }
    }

    if (req.method === 'POST') {
      const upstream = await fetch(appsScriptUrl, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type':'application/json', Accept:'application/json' },
        body: JSON.stringify(req.body || {})
      });
      const text = await upstream.text();
      res.setHeader('Cache-Control', 'no-store');
      try { return res.status(upstream.ok ? 200 : upstream.status).json(JSON.parse(text)); }
      catch { return res.status(502).json({ success:false, error:'استجابة غير متوقعة من Apps Script.' }); }
    }

    res.setHeader('Allow','GET, POST');
    return res.status(405).json({ success:false, error:'طريقة الطلب غير مدعومة.' });
  } catch (error) {
    return res.status(500).json({ success:false, error:error?.message || 'حدث خطأ غير متوقع في الخادم.' });
  }
}
