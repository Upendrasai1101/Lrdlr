// firebase.js (mobile)
//
// The same Firebase project as the website (lrdlr-demo), so the phone and
// the web dashboard share one live database and one set of security rules.
//
// Copy the 6 values from public/firebase-init.js. They are not secret: the
// web apiKey only names the project; firestore.rules control access.
// (The service-account key and the Groq key are different. They never go here.)

import { getApps, initializeApp } from "firebase/app";
import { getFirestore, initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCTF682d9aYOYJIFLkwieFU53Mk8YoKpP0",
  authDomain: "lrdlr-demo.firebaseapp.com",
  projectId: "lrdlr-demo",
  storageBucket: "lrdlr-demo.firebasestorage.app",
  messagingSenderId: "839218789035",
  appId: "1:839218789035:web:a0923b71ecb506903bd5ee",
};

// Fast Refresh re-runs this file while you edit, so only create the app once.
const firstLoad = getApps().length === 0;
const app = firstLoad ? initializeApp(firebaseConfig) : getApps()[0];

// React Native has no browser streaming, so Firestore must use long polling
// or live updates can hang on some phones.
export const db = firstLoad
  ? initializeFirestore(app, { experimentalForceLongPolling: true })
  : getFirestore(app);

export const LEADS_COLLECTION = "leads";
export const DEALERS_COLLECTION = "dealers";