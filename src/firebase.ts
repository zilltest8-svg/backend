import { initializeApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";

/** The same web app the Flutter build registered (flutter_app/lib/firebase_options.dart). */
export const firebaseConfig = {
  apiKey: "AIzaSyD3mzyjpXTIXUr6ZfkdZOJayObb6OrOrmU",
  authDomain: "ziltime-7992c.firebaseapp.com",
  projectId: "ziltime-7992c",
  storageBucket: "ziltime-7992c.firebasestorage.app",
  messagingSenderId: "611155495755",
  appId: "1:611155495755:web:51b052dc5b30801ac6b6ce",
  measurementId: "G-Y3VWQT3JME",
};

let db: Firestore | null | undefined;

/**
 * The database, or null when Firebase could not start — the app then keeps
 * everything in this browser exactly as before. The local cache is on, so
 * the first snapshot comes off disk in milliseconds and the server's answer
 * follows once it arrives.
 */
export function firestore(): Firestore | null {
  if (db !== undefined) return db;
  try {
    const app = initializeApp(firebaseConfig);
    try {
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch {
      // Persistence refused (private mode, or a second init) — plain is fine.
      db = getFirestore(app);
    }
  } catch (e) {
    console.warn("Firebase unavailable", e);
    db = null;
  }
  return db;
}
