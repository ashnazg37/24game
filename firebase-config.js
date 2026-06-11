import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getDatabase }   from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyDq7eL3Xknl9ZfVj9ms33NE9485x8ELgLc",
  authDomain: "game-f1fc4.firebaseapp.com",
  databaseURL: "https://game-f1fc4-default-rtdb.firebaseio.com",
  projectId: "game-f1fc4",
  storageBucket: "game-f1fc4.firebasestorage.app",
  messagingSenderId: "5791534605",
  appId: "1:5791534605:web:8d0e6b5662b2afde308f44",
  measurementId: "G-M6QPKXYXNJ"
};
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getDatabase(app);