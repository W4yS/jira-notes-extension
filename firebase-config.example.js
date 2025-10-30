// Конфигурация Firebase для синхронизации между пользователями
// 
// ИНСТРУКЦИЯ:
// 1. Скопируйте этот файл и назовите его firebase-config.js
// 2. Замените ВСЕ значения YOUR_* на реальные данные из Firebase Console
// 3. Следуйте инструкциям в файле FIREBASE_VISUAL_GUIDE.md

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT_ID-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// НЕ ИЗМЕНЯЙТЕ КОД НИЖЕ
export { firebaseConfig };
