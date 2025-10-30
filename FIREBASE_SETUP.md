# 🔥 Настройка Firebase для синхронизации

## Шаг 1: Создание проекта Firebase

1. Перейдите на https://console.firebase.google.com
2. Нажмите **"Добавить проект"** (Add project)
3. Введите название проекта, например: `jira-notes-sync`
4. Отключите Google Analytics (не обязательно для этого проекта)
5. Нажмите **"Создать проект"**

## Шаг 2: Настройка Realtime Database

### 2.1 Создание базы данных

1. В левом меню выберите **"Build" → "Realtime Database"**
2. Нажмите **"Создать базу данных"** (Create Database)
3. Выберите регион:
   - Рекомендуется: **europe-west1** (Бельгия) - если в Европе
   - Или: **us-central1** (США)
   - ⚠️ Запомните регион - он будет в URL!
4. Выберите режим **"Начать в тестовом режиме"** (Start in test mode)
   - Это позволит читать и писать без аутентификации
5. Нажмите **"Включить"** (Enable)

### 2.2 Проверка URL базы данных

После создания вы увидите пустую базу данных. Обратите внимание на URL вверху:

```
https://ваш-проект-default-rtdb.europe-west1.firebasedatabase.app/
```

Этот URL вам понадобится в конфигурации!

## Шаг 3: Настройка правил безопасности

⚠️ **Важно!** Тестовый режим открывает доступ всем. Для продакшена настройте правила:

1. В Realtime Database откройте вкладку **"Правила"** (Rules)
2. Замените правила на:

```json
{
  "rules": {
    "teams": {
      "$teamId": {
        ".read": true,
        ".write": true,
        "notes": {
          "$issueKey": {
            ".validate": "newData.hasChildren(['lastModified', 'lastModifiedBy'])"
          }
        }
      }
    }
  }
}
```

3. Нажмите **"Опубликовать"** (Publish)

### Улучшенные правила (для продакшена с аутентификацией)

```json
{
  "rules": {
    "teams": {
      "$teamId": {
        ".read": "auth != null && data.child('members').child(auth.token.email).exists()",
        ".write": "auth != null && data.child('members').child(auth.token.email).exists()",
        "members": {
          "$email": {
            ".validate": "newData.hasChildren(['name', 'color'])"
          }
        },
        "notes": {
          "$issueKey": {
            ".validate": "newData.hasChildren(['text', 'lastModified', 'lastModifiedBy'])"
          }
        }
      }
    }
  }
}
```

## Шаг 4: Получение конфигурации (ВАЖНО!)

### 4.1 Регистрация Web приложения

1. **В левом верхнем углу** нажмите на иконку **⚙️** (шестерёнка)
2. Выберите **"Project settings"** (Настройки проекта)
3. Прокрутите страницу вниз до раздела **"Your apps"** (Ваши приложения)
4. Вы увидите текст: "There are no apps in your project"
5. Нажмите на иконку **</>** (код с тегами) - это Web приложение

### 4.2 Настройка Web приложения

1. **App nickname**: введите `Jira Notes Extension`
2. **Firebase Hosting**: оставьте **ВЫКЛЮЧЕННЫМ** (галочку НЕ ставить)
3. Нажмите **"Register app"** (Зарегистрировать приложение)

### 4.3 Копирование конфигурации

После регистрации появится экран с кодом. Вы увидите:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "jira-notes-sync.firebaseapp.com",
  databaseURL: "https://jira-notes-sync-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "jira-notes-sync",
  storageBucket: "jira-notes-sync.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890"
};
```

## Шаг 5: Обновление firebase-config.js

### 5.1 Откройте файл

1. Откройте **VS Code**
2. Откройте файл `c:\vscode\jira-notes-extension\firebase-config.js`
3. Вы увидите:

```javascript
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "your-project.firebaseapp.com",
  databaseURL: "https://your-project-default-rtdb.firebaseio.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

### 5.2 Замените значения

**ПОСТРОЧНО** замените каждое значение:

#### ✏️ **apiKey**
Из Firebase: `AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`  
Вставьте: `apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",`

#### ✏️ **authDomain**
Из Firebase: `jira-notes-sync-12345.firebaseapp.com`  
Вставьте: `authDomain: "jira-notes-sync-12345.firebaseapp.com",`

#### ✏️ **databaseURL** ⚠️ САМОЕ ВАЖНОЕ!
Из Firebase: `https://jira-notes-sync-12345-default-rtdb.europe-west1.firebasedatabase.app`  
Вставьте: `databaseURL: "https://jira-notes-sync-12345-default-rtdb.europe-west1.firebasedatabase.app",`

🔴 **ВНИМАНИЕ**: Должен содержать регион (`europe-west1` или `us-central1`)!

#### ✏️ **projectId**
Из Firebase: `jira-notes-sync-12345`  
Вставьте: `projectId: "jira-notes-sync-12345",`

#### ✏️ **storageBucket**
Из Firebase: `jira-notes-sync-12345.appspot.com`  
Вставьте: `storageBucket: "jira-notes-sync-12345.appspot.com",`

#### ✏️ **messagingSenderId**
Из Firebase: `123456789012`  
Вставьте: `messagingSenderId: "123456789012",`

#### ✏️ **appId**
Из Firebase: `1:123456789012:web:abcdef1234567890`  
Вставьте: `appId: "1:123456789012:web:abcdef1234567890"`

### 5.3 Пример ГОТОВОГО файла

```javascript
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

### 5.4 Сохраните файл

1. Нажмите **Ctrl+S** (или File → Save)
2. Файл готов!

### 5.5 Проверка

Убедитесь что:
- ✅ Все значения заменены (нет `YOUR_API_KEY`)
- ✅ `databaseURL` содержит регион (`europe-west1` или другой)
- ✅ Все строки заканчиваются запятой (кроме последней)
- ✅ Все значения в кавычках `"..."`
- ✅ Файл сохранён

## Шаг 6: Тестирование

1. Перезагрузите расширение в Chrome (`chrome://extensions/` → кнопка обновления)
2. Откройте расширение и нажмите на иконку настроек (⚙️)
3. Выберите **"Командный режим"**
4. Заполните:
   - **Team ID**: `test-team-01` (согласуйте с коллегами)
   - **Email**: ваш email
   - **Имя**: ваше имя
   - **Цвет**: выберите любой
5. Нажмите **"🧪 Тест соединения"**

Должна появиться надпись: **"✅ Подключено к команде"**

## Шаг 7: Подключение коллег

1. Дайте коллегам:
   - Те же данные из `firebase-config.js`
   - Тот же **Team ID** (например, `test-team-01`)
   - Их личные email и имена
2. Попросите их установить расширение и настроить командный режим
3. Все участники с одинаковым Team ID увидят одни и те же заметки!

## 📊 Структура данных в Firebase

После первого сохранения в Firebase Console → Realtime Database вы увидите:

```
teams/
└── test-team-01/
    ├── members/
    │   ├── user1@company.com/
    │   │   ├── name: "Иван Петров"
    │   │   ├── color: "#667eea"
    │   │   └── lastSeen: 1698675432000
    │   └── user2@company.com/
    │       ├── name: "Мария Сидорова"
    │       ├── color: "#764ba2"
    │       └── lastSeen: 1698675500000
    └── notes/
        ├── SYSADM-38049/
        │   ├── text: "Техника для коворкинга..."
        │   ├── status: "green"
        │   ├── address: "коворкинг Collective"
        │   ├── lastModified: 1698675600000
        │   ├── lastModifiedBy: "user1@company.com"
        │   ├── lastModifiedByName: "Иван Петров"
        │   └── lastModifiedByColor: "#667eea"
        └── SYSADM-37966/
            ├── text: "Доставка в офис"
            ├── status: "yellow"
            ├── address: "Дуров"
            ├── lastModified: 1698675700000
            ├── lastModifiedBy: "user2@company.com"
            ├── lastModifiedByName: "Мария Сидорова"
            └── lastModifiedByColor: "#764ba2"
```

## 🔐 Безопасность

### Для тестирования (текущие правила):
- ✅ Любой может читать и писать
- ⚠️ Не используйте для конфиденциальных данных

### Для продакшена:
1. Включите **Firebase Authentication**
2. Настройте Email/Password auth
3. Обновите правила (см. "Улучшенные правила" выше)
4. Добавьте аутентификацию в `sync-service.js`

## 🧪 Проверка работы

### В консоли браузера (F12) вы должны видеть:

```
🔄 Sync mode: team
🔥 Initializing Firebase sync...
✅ Firebase sync initialized
👤 User registered: Иван Петров (#667eea)
📥 Loaded 5 team notes
🔄 Received sync update: 5 notes
```

### В Firebase Console:
1. Откройте Realtime Database
2. Должны появиться узлы `teams/test-team-01/members` и `teams/test-team-01/notes`
3. При изменении заметки данные обновляются в реальном времени

## ❓ Troubleshooting

### "❌ Firebase init error"
- Проверьте `firebase-config.js` - все ли данные заполнены?
- Проверьте `databaseURL` - должен содержать регион (например, `europe-west1`)
- Откройте консоль разработчика (F12) - есть ли ошибки сети?

### "📴 Offline mode - saving locally"
- Проверьте интернет-соединение
- Проверьте правила Firebase (должны разрешать запись)
- Перезагрузите расширение

### Заметки не синхронизируются
- Убедитесь, что Team ID одинаковый у всех пользователей
- Проверьте, что включен "Командный режим" в настройках
- Проверьте консоль Firebase - должны появляться данные

### "Permission denied"
- Правила Firebase слишком строгие
- Используйте тестовый режим для начала
- Проверьте, что регион в `databaseURL` совпадает с регионом в Firebase Console

## 📝 Лимиты Firebase (бесплатный план)

- **Realtime Database**: 1 GB хранилища
- **Одновременные подключения**: 100
- **Загрузка**: 10 GB/месяц

Для 2-3 пользователей и текстовых заметок это более чем достаточно!

## 🎉 Готово!

Теперь ваши заметки синхронизируются между всеми участниками команды в реальном времени!

---

**Нужна помощь?** Создайте Issue в репозитории GitHub.
