// Yelkovan Grup: Firebase adapter. Exposes the same small API the site uses (window.claude.use("db"|"user"|"assets"))
// on top of Firebase Auth + Firestore, plus window.__fb for sign-in, leads and backups.
const CFG = window.YK_FIREBASE;
const V = "10.12.2";
const done = () => { if (window.__fbResolve) window.__fbResolve(); };
if (!CFG || !CFG.apiKey) { done(); } else {
  try {
    const [{ initializeApp }, A, F] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
      import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
    ]);
    const app = initializeApp(CFG);
    const auth = A.getAuth(app);
    const fs = F.getFirestore(app);
    const user = await new Promise(r => { const u = A.onAuthStateChanged(auth, x => { u(); r(x); }); });
    let isAdmin = false;
    if (user) { try { isAdmin = (await F.getDoc(F.doc(fs, "admins", user.uid))).exists(); } catch (e) { isAdmin = false; } }
    const PUB_FILTER = new Set(["news", "faq", "beforeafter", "testimonials"]);
    const conv = v => {
      if (v && typeof v.toDate === "function") return v.toDate().toISOString();
      if (Array.isArray(v)) return v.map(conv);
      if (v && typeof v === "object") { const o = {}; for (const k in v) o[k] = conv(v[k]); return o; }
      return v;
    };
    const code = e => { const c = (e && e.code) || ""; return { code: c === "permission-denied" ? "invalid_argument" : c === "resource-exhausted" ? "resource_exhausted" : c === "unavailable" ? "unavailable" : c === "not-found" ? "invalid_argument" : "unavailable", message: String(e && e.message || e) }; };
    const snapDoc = d => ({ id: d.id, exists: d.exists(), data: () => d.exists() ? conv(d.data()) : undefined, metadata: { fromCache: d.metadata.fromCache, hasPendingWrites: d.metadata.hasPendingWrites } });
    const segs = p => p.split("/").filter(Boolean);
    const docRef = p => {
      const r = F.doc(fs, ...segs(p));
      return {
        id: r.id, path: p,
        get: async () => { try { return snapDoc(await F.getDoc(r)); } catch (e) { throw code(e); } },
        set: async d => { try { await F.setDoc(r, d); } catch (e) { throw code(e); } },
        update: async d => { try { await F.updateDoc(r, d); } catch (e) { throw code(e); } },
        delete: async () => { try { await F.deleteDoc(r); } catch (e) { throw code(e); } },
        onSnapshot: (next, err) => F.onSnapshot(r, s => next(snapDoc(s)), e => err && err(code(e))),
        collection: c => colRef(p + "/" + c),
      };
    };
    const colRef = p => {
      const base = F.collection(fs, ...segs(p));
      const name = segs(p)[0];
      const q = (!isAdmin && PUB_FILTER.has(name) && segs(p).length === 1) ? F.query(base, F.where("published", "==", true)) : base;
      return {
        path: p,
        doc: id => docRef(p + "/" + (id || F.doc(base).id)),
        add: async d => { try { const r = await F.addDoc(base, d); return docRef(p + "/" + r.id); } catch (e) { throw code(e); } },
        get: async () => { try { const s = await F.getDocs(q); return { docs: s.docs.map(snapDoc), size: s.size, empty: s.empty }; } catch (e) { throw code(e); } },
        onSnapshot: (next, err) => F.onSnapshot(q, s => next({ docs: s.docs.map(snapDoc), size: s.size, empty: s.empty, docChanges: () => [], metadata: { fromCache: s.metadata.fromCache, hasPendingWrites: s.metadata.hasPendingWrites } }), e => err && err(code(e))),
      };
    };
    const db = { collection: colRef, doc: docRef };
    const initials = (user && (user.displayName || user.email || "Y")).trim()[0].toUpperCase();
    const avatar = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1a6fa0"/><text x="32" y="41" font-family="Arial" font-size="28" font-weight="700" fill="#fff" text-anchor="middle">${initials}</text></svg>`);
    const me = { id: user ? user.uid : null, name: user ? (user.displayName || user.email || "") : "", email: user ? user.email : null, avatarUrl: avatar, color: "#1a6fa0", isOwner: isAdmin, canEdit: isAdmin };
    const userNs = { canEdit: async () => isAdmin, isOwner: async () => isAdmin, can: async () => isAdmin, id: async () => me.id, me: async () => me, profiles: async () => ({}) };
    // images: resized in the browser and stored in Firestore ("media" collection), referenced as fsimg:<id>
    const toDataURL = (file, max, q) => new Promise((res, rej) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { const s = Math.min(1, max / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/webp", q)); };
      img.onerror = rej; img.src = url;
    });
    const assets = {
      upload: async file => {
        let d = await toDataURL(file, 1600, .82);
        if (d.length > 900000) d = await toDataURL(file, 1280, .7);
        if (d.length > 900000) d = await toDataURL(file, 1000, .6);
        const r = await F.addDoc(F.collection(fs, "media"), { data: d, createdAt: F.serverTimestamp() });
        return { id: r.id, url: "fsimg:" + r.id, sizeBytes: d.length, contentType: "image/webp" };
      },
    };
    window.claude = { use: async n => n === "db" ? db : n === "user" ? userNs : n === "assets" ? (isAdmin ? assets : null) : null };
    window.__fb = {
      user: me, isAdmin,
      signIn: (e, p) => A.signInWithEmailAndPassword(auth, e, p),
      signOut: () => A.signOut(auth),
      reset: e => A.sendPasswordResetEmail(auth, e),
      addLead: d => F.addDoc(F.collection(fs, "leads"), { ...d, status: "new", createdAt: F.serverTimestamp() }),
      getMedia: async id => { const s = await F.getDoc(F.doc(fs, "media", id)); return s.exists() ? s.data().data : ""; },
      backup: async cols => { const out = {}; for (const c of cols) { const s = await F.getDocs(F.collection(fs, ...segs(c))); s.docs.forEach(d => { out[c + "/" + d.id] = conv(d.data()); }); } return out; },
      restore: async (data, onProgress) => {
        const keys = Object.keys(data); let n = 0;
        for (let i = 0; i < keys.length; i += 400) {
          const b = F.writeBatch(fs);
          keys.slice(i, i + 400).forEach(k => b.set(F.doc(fs, ...segs(k)), data[k]));
          await b.commit(); n = Math.min(keys.length, i + 400); onProgress && onProgress(n, keys.length);
        }
        return n;
      },
    };
  } catch (e) { console.error("Firebase could not start", e); }
  done();
}
