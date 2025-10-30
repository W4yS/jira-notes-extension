# 📸 Детальная инструкция по настройке Firebase (с визуальными подсказками)

## 🎯 Цель: Получить конфигурацию и вставить в firebase-config.js

---

## ЭТАП 1: Создание проекта (2 минуты)

### Шаг 1.1 - Откройте Firebase Console
```
🌐 Откройте в браузере: https://console.firebase.google.com
```

### Шаг 1.2 - Создайте проект
```
┌─────────────────────────────────────────┐
│   Firebase Console                      │
│                                         │
│   [+ Add project]  ← НАЖМИТЕ СЮДА       │
│                                         │
└─────────────────────────────────────────┘
```

### Шаг 1.3 - Введите название
```
┌─────────────────────────────────────────┐
│  Create a project                       │
│                                         │
│  Project name:                          │
│  ┌───────────────────────────────────┐  │
│  │ jira-notes-sync                   │  │ ← ВВЕДИТЕ СЮДА
│  └───────────────────────────────────┘  │
│                                         │
│              [Continue]  ← НАЖМИТЕ      │
└─────────────────────────────────────────┘
```

### Шаг 1.4 - Google Analytics (опционально)
```
┌─────────────────────────────────────────┐
│  Enable Google Analytics                │
│                                         │
│  ○ Enable Google Analytics              │
│  ● Disable Google Analytics ← ВЫБЕРИТЕ  │
│                                         │
│              [Create project]           │
└─────────────────────────────────────────┘
```

### Шаг 1.5 - Ждите создания
```
⏳ Creating project...
   This may take a few seconds
```

Когда готово, нажмите **[Continue]**

---

## ЭТАП 2: Настройка Realtime Database (3 минуты)

### Шаг 2.1 - Откройте меню
```
Левое меню:
┌─────────────────────┐
│ 🏠 Project Overview │
│ 🎯 Analytics        │
│ ⚡ Firestore        │
│ 🔥 Realtime Database│ ← НАЖМИТЕ СЮДА
│ 📦 Storage          │
│ ...                 │
└─────────────────────┘
```

### Шаг 2.2 - Создайте базу данных
```
┌─────────────────────────────────────────┐
│   Realtime Database                     │
│                                         │
│   Store and sync data in real time     │
│                                         │
│        [Create Database] ← НАЖМИТЕ      │
└─────────────────────────────────────────┘
```

### Шаг 2.3 - Выберите регион
```
┌─────────────────────────────────────────┐
│  Realtime Database location             │
│                                         │
│  ┌───────────────────────────────────┐  │
│  │ ● europe-west1 (Belgium)          │  │ ← РЕКОМЕНДУЕТСЯ
│  │ ○ us-central1 (Iowa)              │  │   для Европы
│  │ ○ asia-southeast1 (Singapore)     │  │
│  └───────────────────────────────────┘  │
│                                         │
│              [Next]                     │
└─────────────────────────────────────────┘
```

⚠️ **ВАЖНО**: Запомните регион! Он будет в URL!

### Шаг 2.4 - Выберите правила безопасности
```
┌─────────────────────────────────────────┐
│  Set up security rules                  │
│                                         │
│  ○ Start in locked mode                 │
│  ● Start in test mode ← ВЫБЕРИТЕ ЭТО   │
│                                         │
│  ⚠️ Your database will be open to       │
│     anyone for 30 days                  │
│                                         │
│              [Enable]                   │
└─────────────────────────────────────────┘
```

### Шаг 2.5 - База данных создана!
```
┌─────────────────────────────────────────┐
│ https://jira-notes-sync-abc123-         │ ← ЗАПОМНИТЕ ЭТОТ URL!
│ default-rtdb.europe-west1.              │
│ firebasedatabase.app/                   │
│                                         │
│ {                                       │
│   (пусто)                               │
│ }                                       │
└─────────────────────────────────────────┘
```

---

## ЭТАП 3: Получение конфигурации (5 минут) ⚡ САМОЕ ВАЖНОЕ

### Шаг 3.1 - Откройте настройки проекта
```
Левый верхний угол:
┌─────────────────────┐
│ ⚙️ Project Overview │ ← НАЖМИТЕ НА ШЕСТЕРЁНКУ
└─────────────────────┘

В меню выберите:
┌─────────────────────┐
│ ⚙️ Project settings │ ← НАЖМИТЕ СЮДА
│   Usage and billing │
│   Users and access  │
└─────────────────────┘
```

### Шаг 3.2 - Найдите раздел "Your apps"
```
Прокрутите страницу вниз до:

┌─────────────────────────────────────────┐
│  Your apps                              │
│                                         │
│  There are no apps in your project      │
│                                         │
│  [📱] [🌐] [🤖] [🍎]                  │
│   iOS   Web Android Apple               │
└─────────────────────────────────────────┘
```

### Шаг 3.3 - Создайте Web приложение
```
Нажмите на значок [🌐] (Web):

┌─────────────────────────────────────────┐
│  Add Firebase to your web app           │
│                                         │
│  App nickname:                          │
│  ┌───────────────────────────────────┐  │
│  │ Jira Notes Extension              │  │ ← ВВЕДИТЕ ЭТО
│  └───────────────────────────────────┘  │
│                                         │
│  ☐ Also set up Firebase Hosting        │ ← НЕ СТАВЬТЕ ГАЛОЧКУ!
│                                         │
│              [Register app]             │
└─────────────────────────────────────────┘
```

### Шаг 3.4 - КОПИРУЕМ КОНФИГУРАЦИЮ! 📋

После нажатия [Register app] появится код. Вы увидите примерно это:

```html
<!-- The core Firebase JS SDK -->
<script src="https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js"></script>

<script>
  // Your web app's Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyBqJ7K8L9M0N1O2P3Q4R5S6T7U8V9W0X1Y",
    authDomain: "jira-notes-sync-abc123.firebaseapp.com",
    databaseURL: "https://jira-notes-sync-abc123-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "jira-notes-sync-abc123",
    storageBucket: "jira-notes-sync-abc123.appspot.com",
    messagingSenderId: "987654321098",
    appId: "1:987654321098:web:1a2b3c4d5e6f7g8h9i0j"
  };
  // Initialize Firebase
  firebase.initializeApp(firebaseConfig);
</script>
```

### ✂️ ЧТО ИМЕННО КОПИРОВАТЬ?

**КОПИРУЙТЕ ТОЛЬКО ЭТО:**

```
┌────────────────────────────────────────────────────┐
│ apiKey: "AIzaSyBqJ7K8L9M0N1O2P3Q4R5S6T7U8V9W0X1Y", │ ← ВСЮ ЭТУ СТРОКУ
│ authDomain: "jira-notes-sync-abc123.firebaseapp.com", │
│ databaseURL: "https://jira-notes-sync-abc123-default-rtdb.europe-west1.firebasedatabase.app", │
│ projectId: "jira-notes-sync-abc123", │
│ storageBucket: "jira-notes-sync-abc123.appspot.com", │
│ messagingSenderId: "987654321098", │
│ appId: "1:987654321098:web:1a2b3c4d5e6f7g8h9i0j" │
└────────────────────────────────────────────────────┘
```

### 📝 Способ 1: Копировать вручную

Выделите мышкой и скопируйте (Ctrl+C) эти 7 строк:
- От `apiKey:` до последней запятой после `appId:`

### 📝 Способ 2: Использовать кнопку копирования

Иногда есть кнопка "Copy" справа от кода - нажмите её.

---

## ЭТАП 4: Вставка в firebase-config.js (2 минуты)

### Шаг 4.1 - Откройте файл в VS Code
```
📁 Путь: c:\vscode\jira-notes-extension\firebase-config.js

┌─────────────────────────────────────────┐
│ EXPLORER                                │
│ jira-notes-extension/                   │
│   ├─ content.js                         │
│   ├─ firebase-config.js ← ОТКРОЙТЕ ЭТОТ │
│   ├─ manifest.json                      │
│   └─ ...                                │
└─────────────────────────────────────────┘
```

### Шаг 4.2 - Увидите СТАРЫЙ код
```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",  ← НУЖНО ЗАМЕНИТЬ
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

### Шаг 4.3 - ЗАМЕНИТЕ построчно

#### 1️⃣ Замените apiKey:
```javascript
// БЫЛО:
apiKey: "YOUR_API_KEY",

// СТАЛО:
apiKey: "AIzaSyBqJ7K8L9M0N1O2P3Q4R5S6T7U8V9W0X1Y",
```

#### 2️⃣ Замените authDomain:
```javascript
// БЫЛО:
authDomain: "your-project.firebaseapp.com",

// СТАЛО:
authDomain: "jira-notes-sync-abc123.firebaseapp.com",
```

#### 3️⃣ Замените databaseURL: ⚠️ ВАЖНО!
```javascript
// БЫЛО:
databaseURL: "https://your-project-default-rtdb.firebaseio.com",

// СТАЛО:
databaseURL: "https://jira-notes-sync-abc123-default-rtdb.europe-west1.firebasedatabase.app",
                                                      ^^^^^^^^^^^^^
                                                      ДОЛЖЕН БЫТЬ РЕГИОН!
```

#### 4️⃣ Замените projectId:
```javascript
// БЫЛО:
projectId: "your-project-id",

// СТАЛО:
projectId: "jira-notes-sync-abc123",
```

#### 5️⃣ Замените storageBucket:
```javascript
// БЫЛО:
storageBucket: "your-project.appspot.com",

// СТАЛО:
storageBucket: "jira-notes-sync-abc123.appspot.com",
```

#### 6️⃣ Замените messagingSenderId:
```javascript
// БЫЛО:
messagingSenderId: "123456789",

// СТАЛО:
messagingSenderId: "987654321098",
```

#### 7️⃣ Замените appId:
```javascript
// БЫЛО:
appId: "1:123456789:web:abcdef"

// СТАЛО:
appId: "1:987654321098:web:1a2b3c4d5e6f7g8h9i0j"
```

### Шаг 4.4 - ГОТОВЫЙ файл должен выглядеть так:
```javascript
// Firebase Configuration
// Замените значения на ваши из Firebase Console

export const firebaseConfig = {
  apiKey: "AIzaSyBqJ7K8L9M0N1O2P3Q4R5S6T7U8V9W0X1Y",
  authDomain: "jira-notes-sync-abc123.firebaseapp.com",
  databaseURL: "https://jira-notes-sync-abc123-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jira-notes-sync-abc123",
  storageBucket: "jira-notes-sync-abc123.appspot.com",
  messagingSenderId: "987654321098",
  appId: "1:987654321098:web:1a2b3c4d5e6f7g8h9i0j"
};
```

### Шаг 4.5 - СОХРАНИТЕ!
```
Нажмите: Ctrl + S

Или:
┌─────────────────────┐
│ File → Save         │
└─────────────────────┘
```

---

## ЭТАП 5: Проверка (1 минута) ✅

### Чеклист:
```
✅ Нет больше "YOUR_API_KEY"
✅ Нет больше "your-project"
✅ databaseURL содержит "europe-west1" или другой регион
✅ Все строки в кавычках "..."
✅ Все строки кроме последней заканчиваются запятой ,
✅ Файл сохранён (нет точки • перед именем файла в VS Code)
```

---

## ЭТАП 6: Тестирование (2 минуты) 🧪

### Шаг 6.1 - Перезагрузите расширение
```
1. Откройте: chrome://extensions/

2. Найдите "Jira Personal Notes"

3. Нажмите кнопку обновления:
   ┌─────────────────────┐
   │  🔄 Reload          │ ← НАЖМИТЕ
   └─────────────────────┘
```

### Шаг 6.2 - Откройте настройки расширения
```
1. Нажмите на иконку расширения в Chrome

2. Нажмите на ⚙️ (шестерёнку) справа от "Jira Personal Notes"

3. Откроется страница настроек
```

### Шаг 6.3 - Настройте командный режим
```
┌─────────────────────────────────────────┐
│  Выберите режим работы расширения       │
│                                         │
│  ┌─────────┐  ┌─────────┐              │
│  │ 👤      │  │ 👥      │              │
│  │ Личный  │  │ Командный│ ← НАЖМИТЕ   │
│  └─────────┘  └─────────┘              │
└─────────────────────────────────────────┘
```

### Шаг 6.4 - Заполните данные
```
┌─────────────────────────────────────────┐
│  Team ID:                               │
│  ┌───────────────────────────────────┐  │
│  │ test-team-01                      │  │ ← ВВЕДИТЕ
│  └───────────────────────────────────┘  │
│                                         │
│  Ваш Email:                             │
│  ┌───────────────────────────────────┐  │
│  │ your.name@company.com             │  │ ← ВВЕДИТЕ СВОЙ EMAIL
│  └───────────────────────────────────┘  │
│                                         │
│  Ваше имя:                              │
│  ┌───────────────────────────────────┐  │
│  │ Иван Петров                       │  │ ← ВВЕДИТЕ СВОЁ ИМЯ
│  └───────────────────────────────────┘  │
│                                         │
│  Ваш цвет:                              │
│  ⚫ ⚫ ⚫ ⚫ ⚫ ⚫  ← ВЫБЕРИТЕ ЛЮБОЙ        │
└─────────────────────────────────────────┘
```

### Шаг 6.5 - Тест соединения
```
┌─────────────────────────────────────────┐
│  [🔗 Подключиться] [🧪 Тест соединения] │
│                    ↑                    │
│              НАЖМИТЕ ЭТО СНАЧАЛА        │
└─────────────────────────────────────────┘
```

### Шаг 6.6 - Проверьте результат

#### ✅ УСПЕХ - должно появиться:
```
┌─────────────────────────────────────────┐
│  🟢 ✅ Подключено к команде             │
│                                         │
│  Участники команды:                     │
│  ┌───────────────────────────────────┐  │
│  │ 🔵 Иван Петров                    │  │
│  │    your.name@company.com          │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

#### ❌ ОШИБКА - если появилось:
```
┌─────────────────────────────────────────┐
│  🔴 ❌ Ошибка подключения               │
└─────────────────────────────────────────┘
```

**Причины:**
1. Неправильная конфигурация в `firebase-config.js`
2. Неправильный `databaseURL` (нет региона)
3. Нет интернета
4. Правила Firebase слишком строгие

**Решение:**
- Откройте консоль (F12)
- Смотрите красные ошибки
- Проверьте `firebase-config.js` ещё раз

---

## 🎉 ГОТОВО!

Если увидели **🟢 ✅ Подключено к команде** - всё работает!

### Следующие шаги:

1. Нажмите **[🔗 Подключиться]** (не Тест, а Подключиться)
2. Согласитесь на миграцию данных (если есть)
3. Откройте Jira и проверьте что заметки синхронизируются!

---

## 📞 Если не получилось

### Проверьте в Firebase Console:

1. **Realtime Database** → смотрите есть ли данные:
   ```
   teams/
   └── test-team-01/
       └── members/
           └── your.name@company.com/
   ```

2. **Правила** (Rules) должны быть:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```

### Консоль браузера (F12) должна показывать:

```
✅ Firebase sync initialized
👤 User registered: Иван Петров (#667eea)
```

Если видите ошибки - отправьте скриншот консоли!

---

**💡 Совет**: Сохраните эту инструкцию, она может пригодиться коллегам!
