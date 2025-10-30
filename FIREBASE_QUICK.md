# 🚀 Быстрая памятка по настройке Firebase

## 📋 КРАТКО: 3 простых шага

### ШАГ 1: Создать проект Firebase (2 минуты)
```
1. https://console.firebase.google.com
2. [+ Add project] → "jira-notes-sync"
3. Disable Analytics → [Create]
```

### ШАГ 2: Создать Realtime Database (2 минуты)
```
1. Меню слева: "Realtime Database"
2. [Create Database]
3. Регион: "europe-west1"
4. Режим: "Start in test mode"
5. [Enable]
```

### ШАГ 3: Скопировать конфигурацию (3 минуты)
```
1. ⚙️ → Project settings
2. Прокрутить вниз → "Your apps"
3. Нажать [</>] (Web)
4. Имя: "Jira Notes Extension"
5. [Register app]
6. СКОПИРОВАТЬ блок firebaseConfig
7. ВСТАВИТЬ в firebase-config.js
```

---

## 📝 ЧТО КОПИРОВАТЬ из Firebase Console

### На экране вы увидите:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXX",           // ← КОПИРУЙ ЭТУ СТРОКУ
  authDomain: "project.firebaseapp.com",     // ← И ЭТУ
  databaseURL: "https://project...app",      // ← И ЭТУ (ВАЖНО!)
  projectId: "project-123",                  // ← И ЭТУ
  storageBucket: "project.appspot.com",      // ← И ЭТУ
  messagingSenderId: "123456",               // ← И ЭТУ
  appId: "1:123456:web:abc"                  // ← И ЭТУ
};
```

### НЕ копируйте:
- ❌ `<script>` теги
- ❌ `const firebaseConfig = {`
- ❌ `firebase.initializeApp()`

### Копируйте ТОЛЬКО:
- ✅ 7 строк от `apiKey:` до `appId:`

---

## 🔧 КУДА ВСТАВЛЯТЬ

### Файл: `c:\vscode\jira-notes-extension\firebase-config.js`

### БЫЛО:
```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",  ← ЗАМЕНИТЬ
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

### СТАЛО (пример):
```javascript
export const firebaseConfig = {
  apiKey: "AIzaSyBqJ7K8L9M0N1O2P3Q4R5S6T7U8",  ← ВСТАВИТЬ СВОЁ
  authDomain: "jira-notes-sync-abc123.firebaseapp.com",
  databaseURL: "https://jira-notes-sync-abc123-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jira-notes-sync-abc123",
  storageBucket: "jira-notes-sync-abc123.appspot.com",
  messagingSenderId: "987654321098",
  appId: "1:987654321098:web:1a2b3c4d5e6f7g8h"
};
```

**Не забудь**: Ctrl+S (сохранить)

---

## ✅ ПРОВЕРКА

### 1. Проверь файл:
- ✅ Нет "YOUR_API_KEY"
- ✅ `databaseURL` содержит регион (europe-west1)
- ✅ Все в кавычках
- ✅ Файл сохранён

### 2. Перезагрузи расширение:
```
chrome://extensions/ → кнопка 🔄
```

### 3. Открой настройки:
```
Иконка расширения → ⚙️
```

### 4. Выбери "Командный" режим:
```
👥 Командный
```

### 5. Заполни:
```
Team ID: test-team-01
Email: your.name@company.com
Имя: Иван Петров
Цвет: любой
```

### 6. Нажми:
```
[🧪 Тест соединения]
```

### 7. Должно появиться:
```
🟢 ✅ Подключено к команде
```

---

## ❌ Если ошибка

### Консоль (F12) показывает:
```
❌ Firebase init error
```

### Причины:
1. Неправильный `firebase-config.js`
2. Нет региона в `databaseURL`
3. Нет интернета

### Решение:
1. Проверь `firebase-config.js` ещё раз
2. Убедись что `databaseURL` выглядит так:
   ```
   https://project-name-default-rtdb.REGION.firebasedatabase.app
                                      ^^^^^^^
                                      ДОЛЖЕН БЫТЬ!
   ```
3. Перезагрузи расширение

---

## 📚 Подробные инструкции

Если нужны детали с картинками:
- **FIREBASE_VISUAL_GUIDE.md** ← ОЧЕНЬ ПОДРОБНО с визуальными блоками
- **FIREBASE_SETUP.md** ← Полная текстовая инструкция
- **NEXT_STEPS.md** ← Что делать после настройки

---

## 🎯 Быстрые ссылки

- **Firebase Console**: https://console.firebase.google.com
- **Chrome Extensions**: chrome://extensions/
- **GitHub Repo**: https://github.com/W4yS/jira-notes-extension

---

## 💡 Подсказки

### Для коллег:
Дайте им:
1. Те же данные из `firebase-config.js`
2. Тот же **Team ID** (например, `test-team-01`)
3. Эту инструкцию

### Для отладки:
```javascript
// В консоли браузера должно быть:
✅ Firebase sync initialized
👤 User registered: Иван Петров
📥 Loaded X team notes
```

### В Firebase Console:
```
Realtime Database должна показывать:
teams/
└── test-team-01/
    ├── members/
    └── notes/
```

---

**🎉 Готово! Синхронизация должна работать!**
