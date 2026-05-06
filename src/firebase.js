import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyALfZepj5phtA4DUrZylsyGrX69tD-7Ejo",
  authDomain: "expense-tracker-starter-20.firebaseapp.com",
  projectId: "expense-tracker-starter-20",
  storageBucket: "expense-tracker-starter-20.firebasestorage.app",
  messagingSenderId: "1012694020162",
  appId: "1:1012694020162:web:3717d03ca044b4dbce3ddb",
  //measurementId: "G-13SNR5TTEY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);