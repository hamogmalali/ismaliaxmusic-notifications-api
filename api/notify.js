// api/notify.js — Vercel serverless function
// يبعث إشعار FCM لكل المستخدمين (topic 'all') عند نزول مقال جديد
// يشتغل على Vercel free tier (Hobby)

const adminRaw = require('firebase-admin');
const admin = adminRaw.default || adminRaw;

// ─── تهيئة Admin SDK مرة واحدة بس ──────────────────────────
// (نحافظ على الـ singleton عشان ما نعيدش التهيئة في كل cold/warm call)
let _messaging = null;

function getMessaging() {
  if (_messaging) return _messaging;

  // نقرأ service account من env var (base64 of the JSON key)
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!b64) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT env var غير مضبوط');
  }

  let serviceAccount;
  try {
    const json = Buffer.from(b64, 'base64').toString('utf8');
    serviceAccount = JSON.parse(json);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT مش base64 صالح: ' + e.message);
  }

  // نتأكد إن ما فيش app متهيأ قبل كده
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // databaseURL اختياري — مش محتاجين Realtime DB هنا
    });
  }

  _messaging = admin.messaging();
  return _messaging;
}

// ─── مقارنة constant-time لتجنب timing attacks ────────────
function safeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return false;
  let diff = 0;
  for (let i = 0; i < sa.length; i++) {
    diff |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return diff === 0;
}

// ─── الـ handler ────────────────────────────────────────────
module.exports = async (req, res) => {
  // CORS headers (admin panel على Firebase Hosting — domain مختلف)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // التحقق من الـ admin token
  const token = req.headers['x-admin-token'];
  const expected = process.env.ADMIN_TOKEN;
  if (!expected || !token || !safeEqual(token, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // قراءة الـ body (Vercel بـparse JSON تلقائياً لو الـ header صح)
  const body = typeof req.body === 'string' ? safeParse(req.body) : req.body || {};
  const title = body.title;
  const articleBody = body.body;
  const articleId = body.articleId;

  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  // نبني رسالة الـ FCM لـ topic 'all'
  const message = {
    topic: 'all',
    notification: {
      title: String(title),
      body: articleBody ? truncate(String(articleBody), 120) : 'مقال جديد!',
    },
    data: {
      articleId: articleId ? String(articleId) : '',
      type: 'new_article',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'new_articles',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
        },
      },
    },
  };

  try {
    const messaging = getMessaging();
    const messageId = await messaging.send(message);
    return res.status(200).json({ ok: true, messageId });
  } catch (err) {
    console.error('notify error:', err && err.message);
    console.error('notify stack:', err && err.stack);
    return res.status(500).json({
      error: 'Failed to send notification',
      detail: err && err.message ? err.message : String(err),
      stack: err && err.stack ? String(err.stack) : 'no-stack',
      adminDebug: { typeofAdmin: typeof admin, hasDefault: !!adminRaw.default, keys: admin ? Object.keys(admin).slice(0,15) : null, appsType: admin ? typeof admin.apps : null, appsLength: admin && admin.apps ? admin.apps.length : 'undef' },
    });
  }
};

// ─── Helpers ───────────────────────────────────────────────
function safeParse(str) {
  try {
    return JSON.parse(str);
  } catch (_) {
    return {};
  }
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + '…';
}
