// Serverová časť (Firebase): prihlásenie cez Google / Apple, schvaľovanie používateľov,
// spoločné naučené údaje. Načítava sa po firebase-*-compat.js, firebase-config.js a parser.js.
"use strict";

const Cloud = (() => {
  const cfg = window.FIREBASE_CONFIG || {};
  const appOpts = window.APP_OPTIONS || {};
  const configured = !!cfg.apiKey && !/VLOZTE/i.test(cfg.apiKey);
  const sdkMissing = configured && typeof firebase === "undefined";   // nastavené, ale knižnice sa nenačítali
  const enabled = configured;
  let auth = null, db = null;
  if (enabled && !sdkMissing) {
    firebase.initializeApp(cfg);
    auth = firebase.auth();
    db = firebase.firestore();
  }
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  const learnedRef = () => db.collection("learned").doc("shared");
  const api = { enabled, session: null };

  // ------------------------------------------------------------ chyby po slovensky
  function errText(e) {
    const c = (e && e.code) || "";
    if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return "Prihlásenie bolo zrušené.";
    if (c === "auth/popup-blocked") return "Prehliadač zablokoval prihlasovacie okno. Povoľte vyskakovacie okná pre túto stránku.";
    if (c === "auth/account-exists-with-different-credential") return "Tento e-mail je už zaregistrovaný iným spôsobom prihlásenia (Google/Apple). Prihláste sa ním.";
    if (c === "auth/unauthorized-domain") return "Táto adresa nie je povolená vo Firebase (Authentication → Settings → Authorized domains).";
    if (c === "auth/operation-not-allowed") return "Tento spôsob prihlásenia nie je vo Firebase zapnutý.";
    if (c === "auth/network-request-failed" || c === "unavailable") return "Chýba pripojenie k internetu.";
    if (c === "permission-denied") return "Nemáte oprávnenie na túto operáciu.";
    return (e && e.message) || String(e);
  }
  api.errText = errText;

  // ------------------------------------------------------------ prihlasovacia obrazovka
  const STYLE = `
    #loginOv[hidden] { display:none; }
    #loginOv { position:fixed; inset:0; background:#f5f5f7; z-index:1000; display:flex; align-items:center; justify-content:center; font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif; color:#1d1d1f; }
    #loginOv .box { background:#fff; border:1px solid #d8d8de; border-radius:10px; padding:24px; width:360px; display:flex; flex-direction:column; gap:10px; }
    #loginOv h2 { margin:0 0 4px; font-size:18px; }
    #loginOv button { font:inherit; padding:9px 14px; border:1px solid #d8d8de; border-radius:6px; background:#fff; cursor:pointer; }
    #loginOv button:hover:not(:disabled) { background:#f0f0f4; }
    #loginOv button.apple { background:#000; color:#fff; border-color:#000; }
    #loginOv button.apple:hover:not(:disabled) { background:#222; }
    #loginOv button:disabled { opacity:.5; cursor:default; }
    #loginOv .msg { min-height:18px; color:#c0211f; font-size:13px; }
    #loginOv .hint { color:#6b6b76; font-size:13px; }
    #loginOv a { color:#0a64d6; font-size:13px; }
  `;

  function overlay() {
    let ov = document.getElementById("loginOv");
    if (!ov) {
      const st = document.createElement("style"); st.textContent = STYLE; document.head.appendChild(st);
      ov = document.createElement("div"); ov.id = "loginOv"; document.body.appendChild(ov);
    }
    return ov;
  }

  function providerFor(kind) {
    if (kind === "apple") {
      const p = new firebase.auth.OAuthProvider("apple.com");
      p.addScope("email"); p.addScope("name");
      return p;
    }
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: "select_account" });
    return p;
  }

  async function signIn(kind) {
    const provider = providerFor(kind);
    try { await auth.signInWithPopup(provider); }
    catch (e) {
      if (e && e.code === "auth/popup-blocked") await auth.signInWithRedirect(provider);   // záloha
      else throw e;
    }
  }

  function showLogin(ov) {
    ov.hidden = false;
    ov.innerHTML = `<div class="box">
      <h2>Premenovanie faktúr</h2>
      <div class="hint">Prihláste sa svojím účtom. Pri prvom prihlásení sa vytvorí žiadosť o prístup, ktorú musí schváliť správca.</div>
      <button id="lgGoogle">Pokračovať cez Google</button>
      ${appOpts.appleSignIn ? '<button id="lgApple" class="apple">Pokračovať cez Apple</button>' : ""}
      <div class="msg" id="lgMsg"></div>
    </div>`;
    const msg = t => { ov.querySelector("#lgMsg").textContent = t; };
    const wire = (id, kind) => {
      const b = ov.querySelector(id); if (!b) return;
      b.onclick = async () => {
        b.disabled = true; msg("");
        try { await signIn(kind); } catch (e) { msg(errText(e)); b.disabled = false; }
      };
    };
    wire("#lgGoogle", "google"); wire("#lgApple", "apple");
  }

  function showStatus(ov, title, text, opts) {
    ov.hidden = false;
    ov.innerHTML = `<div class="box"><h2></h2><div class="txt"></div>
      ${opts && opts.back ? '<a href="index.html">← Späť do aplikácie</a>' : ""}
      <button id="lgOut">Odhlásiť sa</button></div>`;
    ov.querySelector("h2").textContent = title;
    ov.querySelector(".txt").textContent = text;
    ov.querySelector("#lgOut").onclick = () => auth.signOut();
  }

  /** Pri prvom prihlásení vytvorí záznam "čaká na schválenie". */
  async function ensureProfile(user) {
    const ref = db.collection("users").doc(user.uid);
    const snap = await ref.get();
    if (snap.exists) return;
    const pd = (user.providerData && user.providerData[0]) || {};
    await ref.set({
      email: (user.email || pd.email || "").toLowerCase(),
      name: user.displayName || pd.displayName || "",
      provider: pd.providerId || "",
      role: "user",
      status: "pending",
      createdAt: ts(),
    });
  }

  /**
   * Zobrazí prihlásenie, kým sa používateľ neprihlási a nemá schválený účet.
   * Čakajúci používateľ vidí informáciu a po schválení sa pustí dnu automaticky.
   * { admin: true } – vyžaduje rolu správcu. Vráti { user, profile, isAdmin }.
   * V lokálnom režime (Firebase nenastavený) vráti hneď null.
   */
  api.requireLogin = function (opts) {
    if (!enabled) return Promise.resolve(null);
    const ov = overlay();
    if (sdkMissing) {   // bez knižníc Firebase sa nedá prihlásiť – radšej nič nepustiť
      showStatus0(ov);
      return new Promise(() => {});
    }
    const needAdmin = !!(opts && opts.admin);
    return new Promise(resolve => {
      let done = false, unsub = null;

      const evaluate = (user, profile) => {
        if (!profile) { showStatus(ov, "Chyba", "Záznam účtu sa nenašiel. Obnovte stránku."); return; }
        if (profile.status === "active") {
          if (needAdmin && profile.role !== "admin") { showStatus(ov, "Prístup zamietnutý", "Táto stránka je len pre správcov.", { back: true }); return; }
          done = true; if (unsub) unsub();
          api.session = { user, profile, isAdmin: profile.role === "admin" };
          ov.hidden = true;
          resolve(api.session);
        } else if (profile.status === "pending") {
          showStatus(ov, "Čaká na schválenie", "Vaša žiadosť o prístup bola odoslaná. Správca ju musí schváliť. Táto stránka sa po schválení sama otvorí.");
        } else {
          showStatus(ov, "Prístup zamietnutý", "Tento účet nemá prístup do aplikácie. Obráťte sa na správcu.");
        }
      };

      auth.onAuthStateChanged(async user => {
        if (done) { if (!user) location.reload(); return; }   // odhlásenie po prihlásení
        if (unsub) { unsub(); unsub = null; }
        if (!user) { showLogin(ov); return; }
        ov.hidden = false; ov.innerHTML = '<div class="box">Overujem prístup…</div>';
        try { await ensureProfile(user); }
        catch (e) { showStatus(ov, "Chyba", "Nepodarilo sa overiť účet: " + errText(e)); return; }
        unsub = db.collection("users").doc(user.uid).onSnapshot(
          snap => { if (!done) evaluate(user, snap.data()); },
          e => showStatus(ov, "Chyba", "Nepodarilo sa overiť účet: " + errText(e)));
      });
    });
  };

  function showStatus0(ov) {
    ov.hidden = false;
    ov.innerHTML = '<div class="box"><h2>Chyba</h2>Nepodarilo sa načítať knižnice Firebase. Skontrolujte internetové pripojenie a obnovte stránku.</div>';
  }

  api.logout = () => auth.signOut();

  // ------------------------------------------------------------ spoločné naučené údaje
  api.loadLearned = async function () {
    const snap = await learnedRef().get();
    if (!snap.exists) return normalizeLearned(null);
    try { return normalizeLearned(JSON.parse(snap.data().data)); } catch { return normalizeLearned(null); }
  };

  /**
   * Bezpečná zmena spoločných údajov: načíta aktuálny stav, zavolá mutate(learned)
   * (mení objekt priamo) a uloží. Beží v transakcii, takže súčasné zápisy viacerých
   * používateľov sa nepreplácajú. Vráti { learned, result }.
   */
  api.updateLearned = function (mutate) {
    return db.runTransaction(async tx => {
      const snap = await tx.get(learnedRef());
      let obj = null;
      if (snap.exists) { try { obj = JSON.parse(snap.data().data); } catch {} }
      const l = normalizeLearned(obj);
      const result = mutate(l);
      tx.set(learnedRef(), { data: JSON.stringify(l), updatedAt: ts(), updatedBy: auth.currentUser.email || "" });
      return { learned: l, result };
    });
  };

  // ------------------------------------------------------------ správa používateľov (admin)
  api.listUsers = async function () {
    const snap = await db.collection("users").get();
    return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  };
  api.countPending = async function () {
    const snap = await db.collection("users").where("status", "==", "pending").get();
    return snap.size;
  };
  api.setStatus = (uid, status) => db.collection("users").doc(uid).update({ status });
  api.setRole = (uid, role) => db.collection("users").doc(uid).update({ role });
  api.deleteUserRecord = uid => db.collection("users").doc(uid).delete();

  return api;
})();
