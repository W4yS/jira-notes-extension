# Настройка синхронизации через Supabase

## Обзор решения

Supabase — это open-source альтернатива Firebase, построенная на PostgreSQL. Для вашего расширения это означает:

- ✅ **Real-time синхронизация** заметок между 3-4 пользователями
- ✅ **Автоматическая аутентификация** (email/password, OAuth, magic links)
- ✅ **Row Level Security (RLS)** — пользователи видят только свои данные или данные команды
- ✅ **Бесплатный tier**: 500 МБ БД, 1 ГБ файлов, 2 ГБ bandwidth
- ✅ **Встроенный Storage** для экспорта/импорта
- ✅ **REST API и WebSocket** из коробки

## Безопасность Supabase

### 🔒 Основные механизмы защиты

#### 1. Row Level Security (RLS)
PostgreSQL RLS — это встроенная система безопасности на уровне строк базы данных:

```sql
-- Пользователь видит только свои заметки
CREATE POLICY "Users can view own notes"
ON notes FOR SELECT
USING (auth.uid() = user_id);

-- Или заметки своей команды
CREATE POLICY "Team members can view team notes"
ON notes FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members 
    WHERE user_id = auth.uid()
  )
);
```

**Почему это безопасно:**
- Политики выполняются на уровне БД, не обойти через API
- Даже если кто-то украдет токен, он увидит только разрешенные данные
- SQL Injection защищен на уровне PostgreSQL

#### 2. JWT токены для аутентификации
```javascript
// Токены автоматически обновляются
const { data: { session } } = await supabase.auth.getSession();
// Access token (короткоживущий) + Refresh token
```

**Безопасность:**
- Access token живет 1 час, автоматически обновляется
- Refresh token хранится в `chrome.storage.local` (изолирован от веб-страниц)
- Токены подписаны JWT secret'ом проекта

#### 3. HTTPS + Certificate Pinning
- Все запросы через HTTPS (TLS 1.3)
- Supabase использует Let's Encrypt сертификаты
- Данные шифруются при передаче

#### 4. API Keys
Supabase использует два типа ключей:
- **anon (public) key** — безопасен для клиента, работает через RLS
- **service_role key** — НЕ использовать в расширении! Только для backend

### ⚠️ Критические моменты безопасности

#### 1. НЕ храните service_role ключ в расширении
```javascript
// ❌ НИКОГДА ТАК НЕ ДЕЛАЙТЕ
const supabase = createClient(url, SERVICE_ROLE_KEY);

// ✅ Используйте только anon key
const supabase = createClient(url, ANON_KEY);
```

#### 2. Всегда включайте RLS на таблицах
```sql
-- После создания таблицы обязательно:
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
```

#### 3. Валидация на клиенте + на сервере (RLS)
```javascript
// Клиент может отправить что угодно, но RLS не пропустит
await supabase.from('notes').insert({
  issue_key: 'HACK-123',
  user_id: 'чужой-id' // RLS заблокирует
});
```

#### 4. Защита от конкурентных обновлений
```sql
-- Используйте version column для optimistic locking
UPDATE notes 
SET text = 'новый текст', version = version + 1
WHERE id = 'uuid' AND version = 5;
```

### 🛡️ Дополнительные меры

#### 1. Rate Limiting
Supabase автоматически ограничивает:
- 100 req/s на IP (бесплатный tier)
- 200 req/s на authenticated user

#### 2. CORS защита
```javascript
// Supabase автоматически проверяет origin
// Для расширения Chrome нужно добавить в настройках:
// chrome-extension://<your-extension-id>
```

#### 3. Audit Logging
```sql
-- Включите логирование изменений
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  table_name TEXT,
  action TEXT,
  old_data JSONB,
  new_data JSONB,
  user_id UUID,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger для автоматического логирования
CREATE TRIGGER audit_notes_changes
  AFTER INSERT OR UPDATE OR DELETE ON notes
  FOR EACH ROW EXECUTE FUNCTION log_changes();
```

### 🔐 Сравнение с другими решениями

| Аспект | Supabase | Firebase | Собственный API |
|--------|----------|----------|-----------------|
| RLS | ✅ Встроенный | ❌ Через Rules | 🔶 Нужно писать |
| Open Source | ✅ Да | ❌ Нет | ✅ Да |
| Self-hosting | ✅ Да | ❌ Нет | ✅ Да |
| Цена (до 500 МБ) | 🆓 Free | 🆓 Free | 💰 VPS ~$5/мес |
| Vendor Lock-in | 🔶 Средний | ❌ Высокий | ✅ Нет |
| Backup | ✅ Авто | ✅ Авто | 🔶 Свой |
| GDPR | ✅ EU region | ✅ EU region | 🔶 Ваша ответственность |

## Пошаговая настройка

### Шаг 1: Создание проекта Supabase

1. Зайдите на https://supabase.com
2. Создайте аккаунт (бесплатно)
3. Создайте новый проект:
   - **Name**: jira-notes-sync
   - **Database Password**: сохраните в надежном месте
   - **Region**: выберите ближайший (eu-central-1 для Европы)

4. Дождитесь создания проекта (~2 минуты)

### Шаг 2: Создание таблиц в базе данных

Откройте **SQL Editor** в Supabase и выполните:

```sql
-- Таблица для заметок
-- Храним только: ID задачи, текст заметки, кто/когда создал/изменил
CREATE TABLE notes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_key TEXT NOT NULL, -- JIRA-123
  team_id UUID, -- для командной работы
  
  -- Содержимое заметки
  text TEXT,
  
  -- Кто создал/изменил
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- Когда создал/изменил
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Для разрешения конфликтов
  version INTEGER DEFAULT 1,
  
  -- Одна заметка на задачу на команду
  UNIQUE(team_id, issue_key)
);

-- Таблица для статусов
-- Храним только: ID задачи, ID статуса, кто/когда установил
CREATE TABLE issue_statuses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_key TEXT NOT NULL, -- JIRA-123
  team_id UUID,
  
  -- ID статуса (из настроек расширения)
  status_id TEXT,
  
  -- Кто установил статус
  set_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  set_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Для разрешения конфликтов
  version INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(team_id, issue_key)
);

-- Таблица команд
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Таблица участников команд
CREATE TABLE team_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member', -- 'admin' or 'member'
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(team_id, user_id)
);

-- Таблица истории изменений (опционально, для аудита)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  issue_key TEXT NOT NULL,
  team_id UUID,
  action_type TEXT NOT NULL, -- 'note_created', 'note_updated', 'status_changed'
  user_id UUID REFERENCES auth.users(id),
  user_email TEXT, -- для удобства
  old_value TEXT,
  new_value TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы для быстрого поиска
CREATE INDEX idx_notes_team_issue ON notes(team_id, issue_key);
CREATE INDEX idx_notes_updated ON notes(updated_at DESC);
CREATE INDEX idx_statuses_team_issue ON issue_statuses(team_id, issue_key);
CREATE INDEX idx_audit_issue ON audit_log(issue_key, timestamp DESC);
CREATE INDEX idx_audit_team ON audit_log(team_id, timestamp DESC);

-- Функция для автоматического обновления updated_at и версии
CREATE OR REPLACE FUNCTION update_metadata()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.version = OLD.version + 1;
  NEW.updated_by = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггер для заметок
CREATE TRIGGER update_notes_metadata
  BEFORE UPDATE ON notes
  FOR EACH ROW
  EXECUTE FUNCTION update_metadata();

-- Триггер для статусов
CREATE TRIGGER update_statuses_metadata
  BEFORE UPDATE ON issue_statuses
  FOR EACH ROW
  EXECUTE FUNCTION update_metadata();
```

### Шаг 3: Настройка Row Level Security (RLS)

```sql
-- Включаем RLS на всех таблицах
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE issue_statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- === Политики для таблицы notes ===

-- Просмотр: только заметки своей команды
CREATE POLICY "Users can view team notes"
ON notes FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);

-- Вставка: только в свою команду
CREATE POLICY "Users can insert team notes"
ON notes FOR INSERT
WITH CHECK (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
  AND created_by = auth.uid()
);

-- Обновление: только участники команды
CREATE POLICY "Users can update team notes"
ON notes FOR UPDATE
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);

-- Удаление: только админы команды
CREATE POLICY "Admins can delete team notes"
ON notes FOR DELETE
USING (
  team_id IN (
    SELECT team_id FROM team_members 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- === Политики для issue_statuses ===

CREATE POLICY "Users can view team statuses"
ON issue_statuses FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert team statuses"
ON issue_statuses FOR INSERT
WITH CHECK (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
  AND set_by = auth.uid()
);

CREATE POLICY "Users can update team statuses"
ON issue_statuses FOR UPDATE
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);

-- === Политики для teams ===

CREATE POLICY "Users can view teams they are members of"
ON teams FOR SELECT
USING (
  id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
);

CREATE POLICY "Users can create teams"
ON teams FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- === Политики для team_members ===

CREATE POLICY "Users can view members of their teams"
ON team_members FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Team admins can add members"
ON team_members FOR INSERT
WITH CHECK (
  team_id IN (
    SELECT team_id FROM team_members 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- === Политики для audit_log ===

CREATE POLICY "Users can view team audit log"
ON audit_log FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);

CREATE POLICY "Users can insert audit log"
ON audit_log FOR INSERT
WITH CHECK (user_id = auth.uid());
```

### Шаг 4: Получение API ключей

1. В Supabase Dashboard откройте **Settings → API**
2. Скопируйте:
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon public key**: `eyJhbGc...` (это безопасно для клиента)

⚠️ **НЕ используйте service_role ключ в расширении!**

### Шаг 5: Установка Supabase SDK

Скачайте Supabase JS клиент:

```bash
# В терминале
curl -o supabase-js.bundle.js https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js
```

Или используйте npm (если есть build процесс):

```bash
npm install @supabase/supabase-js
```

### Шаг 6: Добавление Supabase в расширение

Я создам новый файл `sync.js` для работы с синхронизацией.

## Архитектура синхронизации

```
┌─────────────────┐
│   Chrome        │
│   Extension     │
└────────┬────────┘
         │
         ├──► chrome.storage.local (локальный кеш)
         │
         ├──► IndexedDB (большие данные)
         │
         └──► Supabase (синхронизация)
                  │
                  ├──► PostgreSQL (персистентное хранилище)
                  │
                  └──► Realtime (WebSocket для live updates)
```

### Стратегия синхронизации

1. **Offline First**: 
   - Сначала сохраняем локально (IndexedDB)
   - Потом синхронизируем с Supabase
   - Работает без интернета

2. **Conflict Resolution**:
   - Last Write Wins (LWW) с version field
   - Или Manual Merge (пользователь выбирает)

3. **Real-time Updates**:
   - WebSocket подписка на изменения
   - Автоматическое обновление UI

4. **Sync Queue**:
   - Очередь несинхронизированных изменений
   - Автоматическая синхронизация при восстановлении связи

## Возможные уязвимости и защита

### 1. XSS в заметках
```javascript
// ❌ Опасно
element.innerHTML = noteText;

// ✅ Безопасно
element.textContent = noteText;
// Или используйте DOMPurify
```

### 2. SQL Injection
Supabase автоматически защищает через параметризованные запросы:
```javascript
// ✅ Безопасно - Supabase использует prepared statements
await supabase.from('notes').select().eq('issue_key', userInput);
```

### 3. CSRF
Chrome extensions защищены от CSRF, так как не используют cookies для CORS.

### 4. Credential Theft
```javascript
// ✅ Храним токены в chrome.storage.local
// Изолировано от веб-страниц
await chrome.storage.local.set({ 
  supabase_session: session 
});
```

### 5. Man-in-the-Middle
Supabase использует HTTPS, но можно добавить certificate pinning:
```javascript
// Проверка, что подключаемся к правильному серверу
const SUPABASE_CERT_FINGERPRINT = 'sha256/...';
```

## Соответствие GDPR

Если вы в ЕС или работаете с EU пользователями:

1. **Выбирайте EU регион** при создании проекта
2. **Добавьте Privacy Policy** в расширение
3. **Право на удаление**: 
```sql
-- Функция для удаления всех данных пользователя (GDPR)
CREATE OR REPLACE FUNCTION delete_user_data(target_user_id UUID)
RETURNS void AS $$
BEGIN
  -- Удаляем участие в командах
  DELETE FROM team_members WHERE user_id = target_user_id;
  
  -- Анонимизируем заметки (оставляем данные, но убираем ссылку на пользователя)
  UPDATE notes SET created_by = NULL, updated_by = NULL 
  WHERE created_by = target_user_id OR updated_by = target_user_id;
  
  -- Анонимизируем статусы
  UPDATE issue_statuses SET set_by = NULL 
  WHERE set_by = target_user_id;
  
  -- Анонимизируем audit log
  UPDATE audit_log SET user_id = NULL, user_email = 'deleted@user' 
  WHERE user_id = target_user_id;
  
  -- Удаляем команды, где пользователь был создателем
  DELETE FROM teams WHERE created_by = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

4. **Право на экспорт**: используйте существующую функцию экспорта

## Мониторинг и отладка

### В Supabase Dashboard:

1. **Table Editor** — просмотр данных
2. **SQL Editor** — запросы для отладки
3. **Logs** — ошибки и запросы
4. **API Docs** — автогенерированная документация

### В расширении:

```javascript
// Включите подробное логирование
const supabase = createClient(url, key, {
  auth: { debug: true },
  db: { debug: true }
});
```

## Миграция существующих данных

После настройки синхронизации нужно мигрировать данные из `chrome.storage.local`:

```javascript
async function migrateToSupabase() {
  // 1. Получить все локальные данные
  const localData = await chrome.storage.local.get(null);
  
  // 2. Отправить в Supabase
  const notes = [];
  for (const [key, value] of Object.entries(localData)) {
    if (key.startsWith('note_')) {
      const issueKey = key.replace('note_', '');
      notes.push({
        issue_key: issueKey,
        text: value,
        status_id: localData[`status_${issueKey}`]
      });
    }
  }
  
  await supabase.from('notes').upsert(notes);
  
  // 3. Пометить как мигрировано
  await chrome.storage.local.set({ migrated_to_supabase: true });
}
```

## Стоимость и масштабирование

### Бесплатный tier (для 3-4 пользователей — достаточно):
- 500 МБ database
- 1 ГБ file storage
- 2 ГБ bandwidth/месяц
- 50,000 Monthly Active Users

### Расчет для вашего случая:
- 1 команда × 100 задач = 100 заметок
- 100 статусов к задачам
- Средняя заметка ~500 байт (только текст, без данных Jira)
- Средний статус ~100 байт (только ID)
- Итого: ~60 КБ данных
- **Вывод**: бесплатного tier хватит на десятилетия

### Когда нужно платить ($25/мес):
- Больше 500 МБ данных
- Больше 2 ГБ трафика/месяц
- Нужны ежедневные backup'ы
- Нужна Point-in-Time Recovery

## Альтернативы Supabase

### Если нужен полный контроль:
1. **Self-hosted Supabase** (Docker)
2. **Собственный API** (Node.js + PostgreSQL)
3. **PocketBase** (Go, один бинарник)

### Если нужно проще:
1. **Firebase** (дороже, vendor lock-in)
2. **Appwrite** (open-source, похож на Supabase)
3. **AWS Amplify** (если уже используете AWS)

## Заключение

**Supabase для вашего случая — оптимальное решение:**

✅ **Безопасность**: RLS, JWT, HTTPS, audit logs  
✅ **Простота**: готовые SDK, автогенерация API  
✅ **Цена**: бесплатно для 3-4 пользователей  
✅ **Масштабируемость**: PostgreSQL под капотом  
✅ **Open Source**: можно self-host при необходимости  

**Основной риск**: vendor lock-in (но меньше, чем у Firebase, так как можно экспортировать PostgreSQL dump)

**Рекомендация по безопасности**:
1. ✅ Используйте только anon key в расширении
2. ✅ Включите RLS на всех таблицах
3. ✅ Используйте HTTPS (по умолчанию)
4. ✅ Регулярно проверяйте логи в Dashboard
5. ✅ Добавьте Privacy Policy для GDPR

Готов ли я создать файлы для интеграции (`sync.js`, обновленный `content.js`, UI для входа)?
