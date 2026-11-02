// Nastavenie Firebase. Hodnoty nájdete v konzole Firebase:
//   Project settings (ozubené koleso) → General → Your apps → Web app → "SDK setup and configuration" → Config.
// Tieto hodnoty NIE sú tajné (patria do webovej stránky); ochranu zabezpečujú pravidlá v firestore.rules.
//
// Kým tu ostanú zástupné hodnoty, aplikácia beží v LOKÁLNOM režime: bez prihlasovania
// a s naučenými údajmi uloženými len v prehliadači.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCK_MB5vL0VfDORILF5uSGwZcqgD0j5NUY",
  authDomain: "scantool-c5725.firebaseapp.com",
  projectId: "scantool-c5725",
  storageBucket: "scantool-c5725.firebasestorage.app",
  messagingSenderId: "794858613766",
  appId: "1:794858613766:web:727a5373a12f1765ed2787",
};

// Prihlásenie cez Apple zapnite (true) až po nastavení Apple Developer účtu a poskytovateľa
// "Apple" vo Firebase (Authentication → Sign-in method). Kým je false, tlačidlo Apple sa nezobrazí.
window.APP_OPTIONS = {
  appleSignIn: false,
};
