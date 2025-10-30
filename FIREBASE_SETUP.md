# 🔥 Настройка Firebase для синхронизации

## Шаг 1: Создание проекта Firebase

1. Перейдите на https://console.firebase.google.com
2. Нажмите **"Добавить проект"** (Add project)
3. Введите название проекта, например: `jira-notes-sync`
4. Отключите Google Analytics (не обязательно для этого проекта)
5. Нажмите **"Создать проект"**

## Шаг 2: Настройка Realtime Database

1. В левом меню выберите **"Build" → "Realtime Database"**
2. Нажмите **"Создать базу данных"** (Create Database)
3. Выберите регион (например, `europe-west1`)
4. Выберите режим **"Тестовый режим"** (Test mode) - для начала
5. Нажмите **"Включить"** (Enable)

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

## Шаг 4: Получение конфигурации

1. В левом верхнем углу нажмите на иконку ⚙️ → **"Настройки проекта"**
2. Прокрутите вниз до раздела **"Ваши приложения"** (Your apps)
3. Нажмите на иконку **</>** (Web)
4. Введите название приложения: `Jira Notes Extension`
5. **НЕ** включайте Firebase Hosting
6. Нажмите **"Зарегистрировать приложение"**

Вы получите конфигурацию вида:

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

1. Откройте файл `firebase-config.js` в папке расширения
2. Замените значения YOUR_API_KEY и другие на полученные из Firebase
3. Сохраните файл

```javascript
export const firebaseConfig = {
  apiKey: "ВАШИ_ДАННЫЕ_СЮДА",
  authDomain: "ВАШИ_ДАННЫЕ_СЮДА",
  databaseURL: "ВАШИ_ДАННЫЕ_СЮДА", // ← Это самое важное!
  projectId: "ВАШИ_ДАННЫЕ_СЮДА",
  storageBucket: "ВАШИ_ДАННЫЕ_СЮДА",
  messagingSenderId: "ВАШИ_ДАННЫЕ_СЮДА",
  appId: "ВАШИ_ДАННЫЕ_СЮДА"
};
```

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
