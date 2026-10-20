# سيرفر الإشعارات (Vercel + Firebase FCM)

سيرفر صغير على Vercel (مجاني) يبعث إشعار push لكل مستخدمين التطبيق لما مقال جديد ينزل.

## نظرة عامة

```
┌──────────────┐   POST /api/notify    ┌──────────────┐    FCM topic 'all'   ┌──────────────┐
│ Admin Panel  │ ───────────────────▶  │   Vercel     │ ──────────────────▶ │  كل المستخدمين │
│  (Firebase   │   x-admin-token      │  serverless  │    (FCM push)       │  (Flutter app) │
│   Hosting)   │                       │  function    │                     │                │
└──────────────┘                       └──────────────┘                     └──────────────┘
                                               │
                                               ▼
                                       Firebase Admin SDK
                                       (service account)
```

- **السيرفر**: `api/notify.js` — serverless function على Vercel، يستخدم Firebase Admin SDK عشان يبعت FCM للـ topic `all` (التطبيق مشترك فيه فعلاً).
- **النشر يبعت الإشعار من نقطتين**:
  1. `lib/screens/article_editor_screen.dart` (محرر المقالات في Flutter)
  2. `admin_panel/app.js` (لوحة الويب)
  - الإشعار بيتـبعت **للمقالات الجديدة بس**، مش التعديلات.
  - fire-and-forget: لو فشل الإشعار، المقال يفضل متسيف.

---

## الخطوة 1: حمّل service account من Firebase

1. روح لـ [Firebase Console](https://console.firebase.google.com/) → مشروعك (`ismaliaxmusic-d2ab4`).
2. ⚙️ Project Settings → **Service accounts**.
3. اضغط **Generate new private key** → هيحمل ملف JSON (مثلاً `serviceAccount.json`).
   - ⚠️ الملف ده حساس. ما ترفعهوش على Git. لسه `.gitignore` محتاج يغطيه (شوف الخطوة 4).

## الخطوة 2: حوّل الـ JSON لـ base64

Vercel env vars بتـقبل نص، فلازم نحوّل الـ JSON لـ base64.

**PowerShell (Windows):**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\serviceAccount.json"))
```
نسخ الـ output (سطر طويل).

**أو Node:**
```bash
node -e "console.log(require('fs').readFileSync('serviceAccount.json').toString('base64'))"
```

## الخطوة 3: اعمل مشروع على Vercel واضبط الـ env vars

1. روح لـ [vercel.com](https://vercel.com) واعمل حساب (لو معندكش).
2. **Add New → Project** → import الـ repo (أو ارفع الملفات يدوي).
3. Vercel هيكتشف `package.json` و `api/` folder لوحده. ما يلزمش إعدادات build.
4. قبل الـ deploy (أو من Settings → Environment Variables)، ضيف:

| الـ variable | القيمة |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | الـ base64 من الخطوة 2 |
| `ADMIN_TOKEN` | secret قوي عشوائي (شوف تحت) |

**توليد ADMIN_TOKEN قوي** (PowerShell):
```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 40 | % {[char]$_})
```

أو Node:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

5. اعمل **Redeploy** عشان الـ env vars تُقرا.

## الخطوة 4: ضبط نفس الـ ADMIN_TOKEN في الـ 3 أماكن

عشان الإشعار يشتغل، لازم نفس القيمة تكون في:

1. **Vercel** env var `ADMIN_TOKEN` (الخطوة 3).
2. **`admin_panel/app.js`** → غيّر `ADMIN_PASSWORD`:
   ```js
   const ADMIN_PASSWORD = 'ضع_نفس_الـ_TOKEN_هنا';
   ```
   بعد كده ارفع الـ admin panel على Firebase Hosting: `firebase deploy --only hosting`.
3. **`lib/config/server_config.dart`** → غيّر `adminToken`:
   ```dart
   static const String adminToken = 'ضع_نفس_الـ_TOKEN_هنا';
   ```
   وبعدها اعمل build جديد للتطبيق.

> 💡 **تلميح:** الـ admin panel بيستخدم الـ password كـ token للإشعار تلقائياً (لما الـ admin يعمل login بيـتسيف في `sessionStorage` باسم `admin_token`). فالـ admin ما يحتاجش يدخل حاجة زيادة.

## الخطوة 5: حدّث رابط الـ Vercel في الـ clients

بعد ما الـ Vercel project ينزل، هيكون فيه رابط زي:
`https://<project-name>.vercel.app/api/notify`

حدّث الرابط ده في مكانين:

1. **`admin_panel/app.js`** → `NOTIFY_URL`
2. **`lib/config/server_config.dart`** → `notifyUrl`

## الخطوة 6: تأكد من `.gitignore`

ضيف السطر ده عشان ملف الـ service account ما يترفعش على Git:
```
serviceAccount*.json
```

---

## اختبار

1. تأكد إن الـ Vercel function شغالة: افتح الرابط في المتصفح:
   `https://<project-name>.vercel.app/api/notify`
   لازم يرجع `{"error":"Method Not Allowed"}` (لأنه POST فقط). ده معناه إنها اشتغلت.

2. اختبر الإشعار من الـ admin panel: انشر مقال جديد، ولازم يوصلك إشعار على التطبيق (لو التطبيق مشترك في topic `all` وفاتح الإشعارات).

3. لو ما وصلش إشعار، شوف logs الـ function من Vercel Dashboard → Functions → notify → Logs.

## ملاحظات الـ free tier (Vercel Hobby)

- المدة القصوى للـ function: 10 ثواني (كافية لإرسال FCM).
- Cold starts: أول call ممكن ياخد ثانية زيادة (تهيئة الـ Admin SDK).
- المعروف أنه محتاج retry من الـ client لو فشل (الكود الحالي fire-and-forget، فمش بيـretry). لو عايز retry ممكن نضيفه بعدين.
- Vercel free tier بـيكفي لمشروع بالحجم ده (الإشعارات محدودة بعدد المقالات الجديدة).

## الملفات اللي اتعدلت/اتضافت

- `api/notify.js` — الـ serverless function (جديد)
- `package.json` — dependencies للسيرفر (جديد)
- `vercel.json` — إعدادات الـ functions (جديد)
- `lib/config/server_config.dart` — رابط + token (جديد)
- `lib/screens/article_editor_screen.dart` — إرسال الإشعار بعد الحفظ (تعديل)
- `admin_panel/app.js` — إرسال الإشعار + تخزين الـ token (تعديل)
- `pubspec.yaml` — إضافة `http` package (تعديل)
