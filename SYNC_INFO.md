# Синхронизация между пользователями

## Текущая реализация
✅ Заметки и статусы хранятся **локально** в браузере каждого пользователя  
✅ Данные **приватные** - видны только вам

## Варианты добавления синхронизации для 2-3 пользователей

### 1. Chrome Sync Storage (САМОЕ ПРОСТОЕ) ⭐
**Сложность:** Очень низкая (15 минут)  
**Стоимость:** Бесплатно  
**Ограничение:** Синхронизация только между устройствами ОДНОГО пользователя

```javascript
// Заменить chrome.storage.local на chrome.storage.sync
chrome.storage.sync.set({ ... });
chrome.storage.sync.get({ ... });
```

### 2. Firebase Realtime Database (РЕКОМЕНДУЕТСЯ) ⭐⭐⭐
**Сложность:** Средняя (2-4 часа)  
**Стоимость:** Бесплатно до 1GB хранилища  
**Плюсы:**
- Реальное время синхронизации
- Просто настраивать
- До 100 одновременных подключений

**Реализация:**
```javascript
// 1. Добавить Firebase SDK в manifest.json
// 2. Создать Firebase проект
// 3. Заменить storage на Firebase

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set, onValue } from 'firebase/database';

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  databaseURL: "https://YOUR-PROJECT.firebaseio.com"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Сохранение
set(ref(db, `notes/${issueKey}`), {
  note: notes,
  status: status,
  timestamp: Date.now()
});

// Чтение
onValue(ref(db, `notes/${issueKey}`), (snapshot) => {
  const data = snapshot.val();
  // обновить UI
});
```

### 3. Supabase (СОВРЕМЕННЫЙ ВАРИАНТ) ⭐⭐⭐⭐
**Сложность:** Средняя (3-5 часов)  
**Стоимость:** Бесплатно до 500MB  
**Плюсы:**
- PostgreSQL база
- Реальное время
- Встроенная авторизация
- REST API

**Реализация:**
```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://YOUR-PROJECT.supabase.co',
  'YOUR_ANON_KEY'
);

// Сохранение
await supabase
  .from('jira_notes')
  .upsert({
    issue_key: issueKey,
    note: notes,
    status: status,
    user_id: userId
  });

// Чтение с подпиской на изменения
supabase
  .from('jira_notes')
  .on('*', payload => {
    // обновить UI
  })
  .subscribe();
```

### 4. Simple Backend (Express + MongoDB)
**Сложность:** Высокая (1-2 дня)  
**Стоимость:** От $5/месяц (хостинг)  
**Плюсы:**
- Полный контроль
- Без ограничений
- Можно добавить любую логику

### 5. Google Sheets API (СТРАННО, НО РАБОТАЕТ) 😄
**Сложность:** Низкая (2-3 часа)  
**Стоимость:** Бесплатно  
**Плюсы:**
- Не нужен сервер
- Данные в таблице - легко читать
- Google API бесплатный

## Рекомендация для 2-3 пользователей

**Выбирайте Firebase Realtime Database:**

### Шаги:
1. Создать проект на https://firebase.google.com
2. Включить Realtime Database
3. Установить правила безопасности:
```json
{
  "rules": {
    "notes": {
      ".read": "auth.uid != null",
      ".write": "auth.uid != null"
    }
  }
}
```
4. Добавить Firebase SDK в расширение
5. Заменить chrome.storage на Firebase calls

### Время разработки: 3-4 часа
### Сложность: 6/10

## Альтернатива: Shared Storage через облако

Можно сделать функцию экспорта/импорта в общий Google Drive или Dropbox файл:
- Пользователи вручную синхронизируют через Export/Import
- Можно автоматизировать через Google Drive API
- Простая реализация, но не реального времени

---

**Нужна помощь с реализацией?** Я могу добавить Firebase синхронизацию в расширение! 🚀
