/* Promille-Uhr – Konto & Synchronisierung (Firebase) */
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
const PUSH_DELAY_MS = 800;
const MAX_DRINKS = 200;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const ERRORS = {
  'auth/invalid-email': 'Diese E-Mail-Adresse ist ungültig.',
  'auth/missing-email': 'Bitte E-Mail-Adresse eingeben.',
  'auth/missing-password': 'Bitte Passwort eingeben.',
  'auth/weak-password': 'Das Passwort braucht mindestens 6 Zeichen.',
  'auth/email-already-in-use': 'Mit dieser E-Mail gibt es schon ein Konto. Melde dich an.',
  'auth/invalid-credential': 'E-Mail oder Passwort stimmt nicht.',
  'auth/invalid-login-credentials': 'E-Mail oder Passwort stimmt nicht.',
  'auth/wrong-password': 'E-Mail oder Passwort stimmt nicht.',
  'auth/user-not-found': 'E-Mail oder Passwort stimmt nicht.',
  'auth/user-disabled': 'Dieses Konto ist gesperrt.',
  'auth/too-many-requests': 'Zu viele Versuche. Bitte warte kurz und versuche es nochmals.',
  'auth/network-request-failed': 'Keine Verbindung. Bist du online?',
  'auth/popup-closed-by-user': 'Anmeldung abgebrochen.',
  'auth/cancelled-popup-request': 'Anmeldung abgebrochen.',
  'auth/unauthorized-domain': 'Diese Adresse ist in Firebase nicht freigegeben (Authentication → Einstellungen → Autorisierte Domains).',
  'auth/operation-not-allowed': 'Diese Anmeldeart ist in Firebase noch nicht aktiviert.',
  'auth/requires-recent-login': 'Aus Sicherheitsgründen bitte ab- und wieder anmelden und es dann nochmals versuchen.',
};

function errorText(err) {
  return (err && ERRORS[err.code]) || 'Etwas hat nicht geklappt. Bitte nochmals versuchen.';
}

async function main() {
  const App = window.PromilleApp;
  const accountBtn = $('#account-btn');
  if (!App || !accountBtn || !firebaseConfig || !firebaseConfig.apiKey) return; // Konto nicht eingerichtet

  let fb;
  try {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(SDK + 'firebase-app.js'),
      import(SDK + 'firebase-auth.js'),
      import(SDK + 'firebase-firestore.js'),
    ]);
    fb = { ...appMod, ...authMod, ...fsMod };
  } catch (e) {
    // Offline beim ersten Laden: App läuft lokal weiter
    return;
  }

  const app = fb.initializeApp(firebaseConfig);
  const auth = fb.getAuth(app);
  auth.languageCode = 'de';
  const db = fb.getFirestore(app);
  const userDoc = (uid) => fb.doc(db, 'users', uid);

  const dialog = $('#account-dialog');
  const form = $('#auth-form');
  const emailEl = $('#auth-email');
  const passEl = $('#auth-password');
  const consentEl = $('#auth-consent');
  const msgEl = $('#auth-msg');
  const submitBtn = $('#auth-submit');

  let mode = 'signin';
  let unsubscribe = null;
  let pushTimer = null;
  let ready = false; // erst nach dem ersten Abgleich hochladen

  accountBtn.hidden = false;

  /* ---------- Dialog ---------- */

  function openDialog() {
    showMsg(msgEl, '');
    showMsg($('#profile-msg'), '');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  accountBtn.addEventListener('click', openDialog);
  $('#account-close').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) closeDialog(); // Klick auf den Hintergrund
  });

  function showMsg(el, text, kind) {
    el.textContent = text;
    el.hidden = !text;
    el.dataset.kind = kind || 'error';
  }

  function setMode(next) {
    mode = next;
    $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
    $('#consent-row').hidden = mode !== 'signup';
    $('#google-hint').hidden = mode === 'signup';
    $('#auth-forgot').hidden = mode === 'signup';
    submitBtn.textContent = mode === 'signup' ? 'Konto erstellen' : 'Anmelden';
    passEl.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    showMsg(msgEl, '');
  }
  $$('.tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  setMode('signin');

  function busy(on) {
    submitBtn.disabled = on;
    $('#auth-google').disabled = on;
  }

  /* ---------- Anmelden / Registrieren ---------- */

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    const password = passEl.value;
    if (mode === 'signup' && !consentEl.checked) {
      showMsg(msgEl, 'Bitte der Datenschutzerklärung zustimmen.');
      return;
    }
    busy(true);
    try {
      if (mode === 'signup') {
        await fb.createUserWithEmailAndPassword(auth, email, password);
      } else {
        await fb.signInWithEmailAndPassword(auth, email, password);
      }
      passEl.value = '';
      closeDialog();
    } catch (err) {
      showMsg(msgEl, errorText(err));
    } finally {
      busy(false);
    }
  });

  $('#auth-forgot').addEventListener('click', async () => {
    const email = emailEl.value.trim();
    if (!email) {
      showMsg(msgEl, 'Gib zuerst deine E-Mail-Adresse ein.');
      emailEl.focus();
      return;
    }
    try {
      await fb.sendPasswordResetEmail(auth, email);
      showMsg(msgEl, 'Falls es ein Konto mit dieser E-Mail gibt, haben wir dir einen Link zum Zurücksetzen geschickt.', 'info');
    } catch (err) {
      showMsg(msgEl, errorText(err));
    }
  });

  /** Neue Google-Konten ohne Einwilligung sofort wieder entfernen. */
  async function checkGoogleConsent(result, hadConsent) {
    const info = fb.getAdditionalUserInfo(result);
    if (info && info.isNewUser && !hadConsent) {
      try { await fb.deleteUser(result.user); } catch (e) { await fb.signOut(auth); }
      setMode('signup');
      openDialog();
      showMsg(msgEl, 'Bitte zuerst der Datenschutzerklärung zustimmen und dann nochmals «Mit Google fortfahren» tippen.');
      return false;
    }
    return true;
  }

  $('#auth-google').addEventListener('click', async () => {
    const hadConsent = mode === 'signup' && consentEl.checked;
    if (mode === 'signup' && !hadConsent) {
      showMsg(msgEl, 'Bitte der Datenschutzerklärung zustimmen.');
      return;
    }
    const provider = new fb.GoogleAuthProvider();
    busy(true);
    try {
      const result = await fb.signInWithPopup(auth, provider);
      if (await checkGoogleConsent(result, hadConsent)) closeDialog();
    } catch (err) {
      if (err && err.code === 'auth/popup-blocked') {
        try {
          sessionStorage.setItem('pu-google-consent', hadConsent ? '1' : '0');
        } catch (e) { /* egal */ }
        await fb.signInWithRedirect(auth, provider);
        return;
      }
      showMsg(msgEl, errorText(err));
    } finally {
      busy(false);
    }
  });

  // Rückkehr von einer Google-Anmeldung per Weiterleitung
  fb.getRedirectResult(auth).then(async (result) => {
    if (!result) return;
    let hadConsent = false;
    try {
      hadConsent = sessionStorage.getItem('pu-google-consent') === '1';
      sessionStorage.removeItem('pu-google-consent');
    } catch (e) { /* egal */ }
    await checkGoogleConsent(result, hadConsent);
  }).catch((err) => {
    openDialog();
    showMsg(msgEl, errorText(err));
  });

  /* ---------- Abmelden / Konto löschen ---------- */

  $('#account-logout').addEventListener('click', async () => {
    await flushPush();
    ready = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    await fb.signOut(auth);
    App.clearLocal();
    closeDialog();
    App.showToast('Abgemeldet');
  });

  $('#account-delete').addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) return;
    const ok = window.confirm('Konto und alle gespeicherten Daten endgültig löschen? Das kann nicht rückgängig gemacht werden.');
    if (!ok) return;
    const msg = $('#profile-msg');
    ready = false;
    clearTimeout(pushTimer);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    try {
      await fb.deleteDoc(userDoc(user.uid));
    } catch (err) {
      showMsg(msg, errorText(err));
      ready = true;
      return;
    }
    App.clearLocal();
    try {
      await fb.deleteUser(user);
      closeDialog();
      App.showToast('Konto gelöscht');
    } catch (err) {
      // Daten sind weg, nur die Anmeldung braucht eine frische Anmeldung
      await fb.signOut(auth);
      setMode('signin');
      showMsg(msgEl, 'Deine Daten sind gelöscht. Um auch die Anmeldung zu entfernen, melde dich nochmals an und tippe erneut auf «Konto löschen».', 'info');
    }
  });

  /* ---------- Synchronisierung ---------- */

  function setStatus(text, state) {
    const el = $('#sync-status');
    el.textContent = text;
    el.dataset.state = state || 'ok';
    accountBtn.dataset.sync = state || 'ok';
  }

  function toCloud(s) {
    return {
      person: s.person,
      drinks: (s.drinks || []).slice(-MAX_DRINKS),
      favorites: (s.favorites || []).slice(0, 30),
      updatedAt: Math.round(s.updatedAt || Date.now()),
    };
  }

  /** Beim Anmelden: lokale Getränke und Konto-Daten zusammenführen. */
  function merge(local, remote) {
    if (!local.updatedAt) return { ...remote };
    const ids = new Set((remote.drinks || []).map((d) => d.id));
    const drinks = (remote.drinks || []).concat((local.drinks || []).filter((d) => !ids.has(d.id)));
    drinks.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
    const person = (local.updatedAt || 0) >= (remote.updatedAt || 0) ? local.person : remote.person;
    const favIds = new Set((remote.favorites || []).map((f) => f.id));
    const favorites = (remote.favorites || []).concat((local.favorites || []).filter((f) => !favIds.has(f.id)));
    return { person, drinks, favorites };
  }

  async function push() {
    const user = auth.currentUser;
    if (!user || !ready) return;
    pushTimer = null;
    setStatus('Speichert …', 'busy');
    try {
      await fb.setDoc(userDoc(user.uid), toCloud(App.getState()));
      setStatus('Gespeichert ✓', 'ok');
    } catch (err) {
      setStatus('Nicht gespeichert – bist du offline?', 'error');
    }
  }

  async function flushPush() {
    if (pushTimer) {
      clearTimeout(pushTimer);
      await push();
    }
  }

  App.onChange(() => {
    if (!auth.currentUser || !ready) return;
    clearTimeout(pushTimer);
    setStatus('Speichert …', 'busy');
    pushTimer = setTimeout(push, PUSH_DELAY_MS);
  });

  function renderUser(user) {
    $('[data-view="auth"]').hidden = !!user;
    $('[data-view="profile"]').hidden = !user;
    const avatar = $('#account-avatar');
    if (user) {
      const name = user.email || user.displayName || 'Konto';
      $('#account-email').textContent = 'Angemeldet als ' + name;
      avatar.textContent = name.charAt(0).toUpperCase();
      avatar.hidden = false;
      $('#account-label').textContent = 'Konto';
      accountBtn.setAttribute('aria-label', 'Konto: ' + name);
    } else {
      avatar.hidden = true;
      $('#account-label').textContent = 'Anmelden';
      accountBtn.removeAttribute('aria-label');
      delete accountBtn.dataset.sync;
    }
  }

  fb.onAuthStateChanged(auth, async (user) => {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    ready = false;
    renderUser(user);
    if (!user) return;

    setStatus('Wird abgeglichen …', 'busy');
    try {
      const snap = await fb.getDoc(userDoc(user.uid));
      const local = App.getState();
      const merged = snap.exists() ? merge(local, snap.data()) : local;
      merged.updatedAt = Date.now();
      App.replaceState(merged);
      await fb.setDoc(userDoc(user.uid), toCloud(App.getState()));
      ready = true;
      setStatus('Synchronisiert ✓', 'ok');

      // Änderungen von anderen Geräten übernehmen
      unsubscribe = fb.onSnapshot(userDoc(user.uid), (s) => {
        if (!s.exists() || s.metadata.hasPendingWrites) return;
        const remote = s.data();
        const current = App.getState();
        if ((remote.updatedAt || 0) > (current.updatedAt || 0) && !pushTimer) {
          App.replaceState(remote);
          setStatus('Synchronisiert ✓', 'ok');
        }
      }, () => setStatus('Verbindung unterbrochen', 'error'));
    } catch (err) {
      setStatus('Abgleich fehlgeschlagen – bist du offline?', 'error');
      // Später nochmals versuchen
      window.addEventListener('online', () => {
        if (auth.currentUser && !ready) location.reload();
      }, { once: true });
    }
  });
}

main();
