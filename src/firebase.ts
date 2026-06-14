import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
const firebaseConfig = {
  projectId: "gen-lang-client-0801170503",
  appId: "1:299460033823:web:78f858ed18d5b6e80ac42a",
  apiKey: "AIzaSyCJn_0jh-P_3CoZ7Bbv_wKfiBXnI83bIe8",
  authDomain: "gen-lang-client-0801170503.firebaseapp.com",
  firestoreDatabaseId: "ai-studio-2de2209c-d434-4d49-a5b5-b8e22169dc59",
  storageBucket: "gen-lang-client-0801170503.firebasestorage.app",
  messagingSenderId: "299460033823",
  measurementId: ""
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
