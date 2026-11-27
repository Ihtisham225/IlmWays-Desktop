/**
 * The window's own words: the bar, sign-in and the offline page. Everything
 * else is the web app, already in English, Urdu and Arabic.
 */
const en = {
  online: "Online",
  offline: "Offline",
  checking: "Connecting…",
  signOut: "Sign out",
  updateReady: "Update ready — restart",
  updating: "Downloading update {percent}%",
  signInTitle: "Sign in to IlmWays",
  signInHint: "Use the login ID and password you use on the website.",
  loginId: "Email or login ID",
  password: "Password",
  signIn: "Sign in",
  signingIn: "Signing in…",
  needInternet: "Connect to the internet to sign in. Once signed in, this computer keeps working when the internet drops.",
  noticeRevoked: "This computer was signed out from the website. Sign in again to continue.",
  noticeExpired: "This computer hasn't reached IlmWays for 30 days, so it was signed out. Sign in again to continue.",
  noticeSignedOutOnWeb: "You signed out.",
  offlineTitle: "You're offline",
  offlineBody: "IlmWays can't be reached right now. As soon as the internet is back, everything opens again where you left it.",
  offlineSoon: "Attendance, fee collection, registering students and marks entry will keep working offline in coming updates.",
  lastContact: "Last connected: {time}",
  tryAgain: "Try again",
  onlineOnly: "Platform console — online only",
  loading: "Opening IlmWays…",
};

type Key = keyof typeof en;

const ur: Record<Key, string> = {
  online: "آن لائن",
  offline: "آف لائن",
  checking: "رابطہ ہو رہا ہے…",
  signOut: "سائن آؤٹ",
  updateReady: "اپ ڈیٹ تیار ہے — دوبارہ شروع کریں",
  updating: "اپ ڈیٹ ڈاؤن لوڈ ہو رہی ہے {percent}%",
  signInTitle: "IlmWays میں سائن اِن کریں",
  signInHint: "وہی لاگ اِن آئی ڈی اور پاس ورڈ استعمال کریں جو آپ ویب سائٹ پر استعمال کرتے ہیں۔",
  loginId: "ای میل یا لاگ اِن آئی ڈی",
  password: "پاس ورڈ",
  signIn: "سائن اِن",
  signingIn: "سائن اِن ہو رہا ہے…",
  needInternet: "سائن اِن کے لیے انٹرنیٹ سے جڑیں۔ سائن اِن کے بعد یہ کمپیوٹر انٹرنیٹ بند ہونے پر بھی کام کرتا رہے گا۔",
  noticeRevoked: "اس کمپیوٹر کو ویب سائٹ سے سائن آؤٹ کر دیا گیا۔ جاری رکھنے کے لیے دوبارہ سائن اِن کریں۔",
  noticeExpired: "یہ کمپیوٹر 30 دن سے IlmWays سے نہیں جڑا، اس لیے سائن آؤٹ ہو گیا۔ دوبارہ سائن اِن کریں۔",
  noticeSignedOutOnWeb: "آپ سائن آؤٹ ہو گئے۔",
  offlineTitle: "آپ آف لائن ہیں",
  offlineBody: "اس وقت IlmWays سے رابطہ نہیں ہو رہا۔ انٹرنیٹ بحال ہوتے ہی سب کچھ وہیں سے کھل جائے گا۔",
  offlineSoon: "حاضری، فیس وصولی، داخلہ اور نمبر درج کرنا آنے والی اپ ڈیٹس میں آف لائن بھی چلیں گے۔",
  lastContact: "آخری رابطہ: {time}",
  tryAgain: "دوبارہ کوشش کریں",
  onlineOnly: "پلیٹ فارم کنسول — صرف آن لائن",
  loading: "IlmWays کھل رہا ہے…",
};

const ar: Record<Key, string> = {
  online: "متصل",
  offline: "غير متصل",
  checking: "جارٍ الاتصال…",
  signOut: "تسجيل الخروج",
  updateReady: "التحديث جاهز — أعد التشغيل",
  updating: "جارٍ تنزيل التحديث {percent}%",
  signInTitle: "تسجيل الدخول إلى IlmWays",
  signInHint: "استخدم معرّف الدخول وكلمة المرور التي تستخدمها على الموقع.",
  loginId: "البريد الإلكتروني أو معرّف الدخول",
  password: "كلمة المرور",
  signIn: "تسجيل الدخول",
  signingIn: "جارٍ تسجيل الدخول…",
  needInternet: "اتصل بالإنترنت لتسجيل الدخول. بعد ذلك يستمر هذا الحاسوب في العمل عند انقطاع الإنترنت.",
  noticeRevoked: "تم تسجيل خروج هذا الحاسوب من الموقع. سجّل الدخول مجددًا للمتابعة.",
  noticeExpired: "لم يتصل هذا الحاسوب بـ IlmWays منذ 30 يومًا، فتم تسجيل خروجه. سجّل الدخول مجددًا.",
  noticeSignedOutOnWeb: "لقد سجّلت الخروج.",
  offlineTitle: "أنت غير متصل",
  offlineBody: "لا يمكن الوصول إلى IlmWays الآن. عند عودة الإنترنت يُفتح كل شيء من حيث توقفت.",
  offlineSoon: "الحضور وتحصيل الرسوم وتسجيل الطلاب وإدخال الدرجات ستعمل دون اتصال في التحديثات القادمة.",
  lastContact: "آخر اتصال: {time}",
  tryAgain: "حاول مرة أخرى",
  onlineOnly: "لوحة المنصة — متصل فقط",
  loading: "جارٍ فتح IlmWays…",
};

const dictionaries = { en, ur, ar } as const;
export type Locale = keyof typeof dictionaries;

export function pickLocale(language: string): Locale {
  const base = language.toLowerCase().split("-")[0];
  return base === "ur" || base === "ar" ? base : "en";
}

export function translator(locale: Locale) {
  const words = dictionaries[locale];
  return (key: Key, values: Record<string, string | number> = {}) =>
    words[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
}

export const directionOf = (locale: Locale) => (locale === "en" ? "ltr" : "rtl");
