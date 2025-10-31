# 🚀 Инструкция по установке расширения Jira Personal Notes

## 📦 Что получил коллега

После клонирования репозитория у вас будут все файлы расширения **КРОМЕ** `firebase-config.js` (он в `.gitignore` по соображениям безопасности).

---

## ⚙️ Быстрая установка (2 варианта)

### Вариант 1: Работа БЕЗ синхронизации (самый простой) ✅

**Если вам НЕ нужна синхронизация между пользователями:**

1. Создайте файл `firebase-config.js` с пустой конфигурацией:

```javascript
// Firebase Configuration (пустая - расширение работает в локальном режиме)
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
};
```

2. Откройте Chrome: `chrome://extensions/`
3. Включите "Режим разработчика" (Developer mode)
4. Нажмите "Загрузить распакованное расширение" (Load unpacked)
5. Выберите папку `jira-notes-extension`

**Готово!** Расширение работает в локальном режиме - заметки сохраняются только у вас.

---

### Вариант 2: Работа С синхронизацией (нужна настройка Firebase) 🔥

**Если нужна синхронизация заметок между вами и коллегами:**

#### Шаг 1: Получите конфигурацию Firebase

**Попросите коллегу, который настраивал Firebase, прислать вам файл `firebase-config.js` целиком.**

Или создайте свой проект:

1. Перейдите: https://console.firebase.google.com
2. Создайте новый проект (или используйте существующий)
3. Добавьте Web App
4. Скопируйте конфигурацию

#### Шаг 2: Создайте файл конфигурации

Создайте файл `firebase-config.js` в корне расширения:

```javascript
// Firebase Configuration
export const firebaseConfig = {
  apiKey: "AIzaSy...",  // ваш ключ
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project.firebaseio.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

#### Шаг 3: Загрузите расширение

1. `chrome://extensions/`
2. Включите "Режим разработчика"
3. "Загрузить распакованное расширение"
4. Выберите папку

#### Шаг 4: Настройте синхронизацию

1. Кликните на иконку расширения
2. "⚙️ Настройки и статусы"
3. Выберите "Командный режим"
4. Введите:
   - Team ID: `ваша-команда` (одинаковый у всех)
   - Email: ваш email
   - Имя: ваше имя
5. Нажмите "Подключиться"

---

## 📂 Структура файлов

```
jira-notes-extension/
├── manifest.json              ✅ в git
├── content.js                 ✅ в git
├── popup.html/js              ✅ в git
├── settings.html/js           ✅ в git
├── styles.css                 ✅ в git
├── firebase-app-compat.js     ✅ в git (библиотека)
├── firebase-database-compat.js ✅ в git (библиотека)
├── firebase-config.example.js ✅ в git (шаблон)
├── firebase-config.js         ❌ НЕТ в git (создать локально!)
└── sync-service.js            ✅ в git
```

---

## 🔒 Безопасность

**Файлы в `.gitignore`:**
- `firebase-config.js` - содержит API ключи (НЕ коммитить!)
- `*.pem` - приватные ключи расширения
- `storage_backup.json` - локальные данные

**Что можно коммитить:**
- Весь код расширения
- Firebase библиотеки (они публичные)
- `firebase-config.example.js` (шаблон без ключей)

---

## ✅ Проверка установки

После установки откройте консоль (F12) на странице настроек:

**Локальный режим:**
```
✅ Settings page loaded
✅ Firebase sync initialized
⚠️ Firebase permissions not configured. Using local storage only.
```

**Режим синхронизации:**
```
✅ Settings page loaded
✅ Firebase sync initialized
✅ User registered: Ваше Имя (#667eea)
```

---

## 🆘 Проблемы?

**Расширение не загружается:**
- Проверьте что файл `firebase-config.js` существует
- Убедитесь что в нём есть `export const firebaseConfig = {...}`

**Синхронизация не работает:**
- Проверьте что Team ID одинаковый у всех коллег
- Убедитесь что Firebase Realtime Database создана
- Настройте правила доступа в Firebase Console

**Ошибки в консоли:**
- Откройте issue в репозитории с скриншотом
- Или напишите коллеге, который настраивал

---

## 📝 Дополнительно

Подробные гайды:
- `FIREBASE_SETUP.md` - полная настройка Firebase
- `FIREBASE_VISUAL_GUIDE.md` - с картинками
- `README.md` - общее описание расширения

---

**Удачи!** 🚀 Если что-то не работает - пишите!
