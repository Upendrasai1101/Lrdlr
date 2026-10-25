// firebase-init.js
//
// The ONE place Firebase gets set up. Every other page imports { db }
// from here instead of initializing Firebase again.
//
// Fill in firebaseConfig from: Firebase console -> Project settings ->
// General -> Your apps -> (web app) -> SDK setup and configuration -> Config.
//
// Nothing in this file is secret. A web app's "apiKey" only tells the SDK
// which Firebase project to talk to; access is controlled by firestore.rules.
// So this file is safe to commit. The service-account-key.json used by the
// import script is DIFFERENT: it must never be committed (see .gitignore).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCTF682d9aYOYJIFLkwieFU53Mk8YoKpP0",
  authDomain: "lrdlr-demo.firebaseapp.com",
  projectId: "lrdlr-demo",
  storageBucket: "lrdlr-demo.firebasestorage.app",
  messagingSenderId: "839218789035",
  appId: "1:839218789035:web:a0923b71ecb506903bd5ee",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Collection names, kept in one place so a typo can't silently create a
// new collection.
export const LEADS_COLLECTION = "leads";
export const DEALERS_COLLECTION = "dealers";
