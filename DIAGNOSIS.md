# 🔍 ДИАГНОСТИКА СИСТЕМЫ ЗАМЕНЫ ID НА КОДИРОВКИ ОФИСОВ

## 📋 ОПИСАНИЕ ПРОБЛЕМЫ

**Симптом:** При открытии новой заявки код офиса появляется на карточке очень долго (несколько секунд), хотя в консоли видно что данные извлечены быстро.

**Из логов пользователя:**
```
content.js:1236 💾 Office code saved: SYSADM-41010 -> Тургенев
```
Данные сохраняются, но на карточке не появляются мгновенно.

---

## 🔄 КАК РАБОТАЕТ СИСТЕМА (ПОЛНЫЙ ПОТОК)

### 1️⃣ ИЗВЛЕЧЕНИЕ ДАННЫХ ПРИ ОТКРЫТИИ ЗАДАЧИ

**Триггер:** Пользователь открывает задачу в Jira

**Цепочка вызовов:**
```
loadNotes() 
  ↓
extractAndSaveAddress()
  → Ищет поле customfield_11120
  → Сохраняет в addressCache[issueKey]
  → Вызывает updateSingleCard(issueKey) ✨
  → Вызывает updateAllCards() (debounced 1000ms)
  ↓
extractAndSaveOfficeCode()
  → Ищет код в адресе
  → Сохраняет в codeCache[issueKey]
  → Вызывает updateSingleCard(issueKey) ✨
  → Вызывает updateAllCards() (debounced 1000ms)
```

### 2️⃣ МГНОВЕННОЕ ОБНОВЛЕНИЕ КАРТОЧКИ

**Метод:** `updateSingleCard(issueKey)`

**Что делает:**
1. Ищет карточку на доске по `issueKey`
2. Находит через selector: `[data-testid="...card-with-icc"]`
3. Извлекает issue key из href ссылки
4. Вызывает `_applyCardModifications()` через RAF

**Проблема №1: КАРТОЧКА МОЖЕТ НЕ СУЩЕСТВОВАТЬ**
- Код вызывается сразу после сохранения
- Но карточка может быть:
  - Не в DOM (если задача открыта из другого места)
  - Еще не отрисована
  - Скрыта в скролле

```javascript
// content.js:1649
updateSingleCard(issueKey) {
  const allCards = document.querySelectorAll('[data-testid="..."]');
  
  for (const card of allCards) {
    // Ищем карточку с нужным issueKey
    const issueMatch = href.match(/([A-Z]+-\d+)/);
    if (issueMatch[1] === issueKey) {
      // ✅ Найдена - обновляем
      this._applyCardModifications(card, link, issueKey);
      break;
    }
  }
  // ⚠️ Если карточка не найдена - ничего не происходит!
}
```

### 3️⃣ ПРИМЕНЕНИЕ МОДИФИКАЦИЙ

**Метод:** `_applyCardModifications(cardContainer, link, issueKey)`

**Что делает:**
1. Проверяет наличие данных в кеше: `this.codeCache[issueKey]`
2. Если есть код:
   - Ищет или создает элемент `.jira-personal-code-inline`
   - Скрывает стандартный текст с issue key
   - Вставляет код офиса
3. Если нет кода, но есть адрес:
   - Создает `.jira-personal-address-inline`

**Проблема №2: ПОРЯДОК ВЫПОЛНЕНИЯ**
```javascript
// content.js:1945
if (this.officeDetectionEnabled && this.codeCache[issueKey]) {
  // Создаем/обновляем код офиса
}
```

**Критическая проблема:** Если `codeCache[issueKey]` еще не заполнен на момент вызова, код не будет добавлен!

---

## 🐛 НАЙДЕННЫЕ ПРОБЛЕМЫ

### ❌ ПРОБЛЕМА #1: АСИНХРОННОСТЬ И КЕШИРОВАНИЕ

**Расположение:** `extractAndSaveOfficeCode()` → `updateSingleCard()`

**Суть:**
1. `extractAndSaveOfficeCode()` **асинхронная** (async/await)
2. Она сохраняет в `codeCache[issueKey] = foundCode`
3. Затем вызывает `updateSingleCard(issueKey)` **синхронно**
4. Но RAF batching добавляет задержку!

```javascript
// content.js:1242
this.codeCache[this.currentIssueKey] = foundCode;
// ✅ Кеш обновлен

this.updateSingleCard(this.currentIssueKey);
// ⚠️ Но RAF batching может сработать ПОЗЖЕ
```

**Проверка:**
```javascript
// В updateSingleCard:
this.rafBatcher.scheduleWrite(() => {
  this._applyCardModifications(card, link, issueKey);
});
```

RAF batching откладывает выполнение до следующего кадра (16ms), но это не объясняет задержку в несколько секунд.

---

### ❌ ПРОБЛЕМА #2: РАННЕЕ ВОЗВРАЩЕНИЕ ИЗ extractAndSaveOfficeCode()

**Расположение:** `extractAndSaveOfficeCode()` line 1154-1159

```javascript
async extractAndSaveOfficeCode() {
  // Ранний выход если код уже в кеше
  if (this.currentIssueKey && this.codeCache[this.currentIssueKey]) {
    console.log(`✓ Office code in cache: ${this.currentIssueKey} -> ${this.codeCache[this.currentIssueKey]}`);
    return; // ⚠️ НЕ ВЫЗЫВАЕТСЯ updateSingleCard()!
  }
```

**Проблема:** Если код уже в кеше (например, после первого открытия задачи), метод выходит раньше и **НЕ обновляет карточку**!

**Сценарий:**
1. Открываем SYSADM-41010 первый раз → код извлекается → карточка обновляется через updateAllCards (debounced 1000ms)
2. Открываем другую задачу
3. Возвращаемся к SYSADM-41010 → код в кеше → РАННИЙ ВЫХОД → карточка НЕ обновляется мгновенно
4. Обновление произойдет только через updateAllCards() через 1 секунду

---

### ❌ ПРОБЛЕМА #3: DEBOUNCED updateAllCards()

**Расположение:** `updateAllCards()` line 1635-1643

```javascript
async updateAllCards() {
  if (!this._updateAllCardsDebounced) {
    this._updateAllCardsDebounced = debounceLeading(
      () => this._updateAllCardsImpl(),
      1000, // ⚠️ ЗАДЕРЖКА 1 СЕКУНДА
      { leading: false, trailing: true, maxWait: 2000 }
    );
  }
  return this._updateAllCardsDebounced();
}
```

**Проблема:** 
- `leading: false` означает что первый вызов **НЕ выполняется сразу**
- Функция ждет 1000ms перед выполнением
- Это и есть задержка, которую видит пользователь!

**Почему это важно:**
- `extractAndSaveOfficeCode()` вызывает ОБА метода:
  1. `updateSingleCard()` - должен работать мгновенно
  2. `updateAllCards()` - откладывается на 1000ms

Если `updateSingleCard()` не находит карточку (проблема #1), то обновление происходит только через `updateAllCards()` → **задержка 1 секунда**.

---

### ❌ ПРОБЛЕМА #4: КАРТОЧКА НЕ НАЙДЕНА В updateSingleCard()

**Расположение:** `updateSingleCard()` line 1649-1674

**Возможные причины:**

1. **Карточка вне viewport и не в DOM:**
   - Jira использует виртуализацию
   - Карточки за пределами экрана могут отсутствовать в DOM

2. **Карточка еще не отрисована:**
   - DOM обновляется асинхронно React/Jira
   - Между `extractAndSaveOfficeCode()` и поиском карточки DOM может измениться

3. **Неправильный selector:**
   - Карточка имеет другой testid
   - Структура DOM изменилась

**Проверка из логов пользователя:**
```
content.js:1728 ✅ Processed 39 visible cards out of 39
```
Это из `_updateAllCardsImpl()` - все 39 карточек найдены и обработаны.

**Но нет логов:**
```
⚡ Instant update card: SYSADM-41010
```
Это означает что `updateSingleCard()` либо:
- Не вызывается
- Не находит карточку
- Не доходит до console.log

---

## 🔬 ДЕТАЛЬНЫЙ АНАЛИЗ ЛОГОВ

### Из консоли пользователя:

```javascript
// 1. Задача открывается
content.js:1079 🔍 Starting address extraction...
content.js:1092 ✅ Found address on attempt 1: "Тургенев..."

// 2. Адрес сохраняется
content.js:1101 💾 Address saved: SYSADM-41010 -> Тургенев...

// 3. Начинается извлечение кода
content.js:1158 🏢 Starting office code extraction...
content.js:1173 🔎 Attempt 1: Field1="Тургенев...", Field2="..."
content.js:1182 ✅ Found exact code match in Field1: "Тургенев"

// 4. Код сохраняется
content.js:1236 💾 Office code saved: SYSADM-41010 -> Тургенев

// ⚠️ НЕТ ЛОГА: ⚡ Instant update card: SYSADM-41010
// Это значит updateSingleCard() не нашла карточку!

// 5. Обновление всех карточек (через 1 секунду)
content.js:1691 📊 Device types cached: 46
content.js:1695 📦 Cache updated: 0 statuses, 12 addresses, 13 codes
content.js:1705 🎴 Found 30 cards, processing only visible ones
content.js:1728 ✅ Processed 30 visible cards out of 30
```

**Вывод:** `updateSingleCard()` не находит карточку, поэтому обновление происходит только через `updateAllCards()` с задержкой 1000ms.

---

## ✅ РЕШЕНИЕ

### 🎯 ВАРИАНТ 1: ДОБАВИТЬ FALLBACK В updateSingleCard()

Если карточка не найдена сразу, попробовать еще раз через короткую задержку:

```javascript
updateSingleCard(issueKey) {
  if (!issueKey) return;
  
  const tryUpdate = () => {
    const allCards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
    
    for (const card of allCards) {
      const link = card.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
      if (!link) continue;
      
      const href = link.href || '';
      const issueMatch = href.match(/([A-Z]+-\d+)/);
      if (!issueMatch || issueMatch[1] !== issueKey) continue;
      
      // Найдена - обновляем
      console.log(`⚡ Instant update card: ${issueKey}`);
      this.rafBatcher.scheduleWrite(() => {
        this._applyCardModifications(card, link, issueKey);
      });
      return true; // ✅ Успешно обновлена
    }
    return false; // ❌ Не найдена
  };
  
  // Первая попытка
  if (!tryUpdate()) {
    // Вторая попытка через 100ms
    console.log(`⏳ Card not found immediately, retrying in 100ms: ${issueKey}`);
    setTimeout(() => {
      if (!tryUpdate()) {
        console.log(`⚠️ Card still not found, will update via updateAllCards: ${issueKey}`);
      }
    }, 100);
  }
}
```

### 🎯 ВАРИАНТ 2: ФОРСИРОВАТЬ updateAllCards() БЕЗ DEBOUNCE

Добавить параметр `immediate` для пропуска debounce:

```javascript
async updateAllCards(immediate = false) {
  if (immediate) {
    // Пропускаем debounce
    return this._updateAllCardsImpl();
  }
  
  // Стандартный debounced путь
  if (!this._updateAllCardsDebounced) {
    this._updateAllCardsDebounced = debounceLeading(
      () => this._updateAllCardsImpl(),
      1000,
      { leading: false, trailing: true, maxWait: 2000 }
    );
  }
  return this._updateAllCardsDebounced();
}

// В extractAndSaveOfficeCode:
this.updateSingleCard(this.currentIssueKey);
this.updateAllCards(true); // ✅ Немедленное обновление
```

### 🎯 ВАРИАНТ 3: ИСПОЛЬЗОВАТЬ MutationObserver

Следить за появлением карточки в DOM и обновлять её:

```javascript
updateSingleCardWhenReady(issueKey) {
  // Пытаемся обновить сразу
  if (this.updateSingleCard(issueKey)) {
    return; // Успешно
  }
  
  // Если не получилось - ждем появления карточки
  const observer = new MutationObserver(() => {
    if (this.updateSingleCard(issueKey)) {
      observer.disconnect();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
  // Отключаем observer через 2 секунды
  setTimeout(() => observer.disconnect(), 2000);
}
```

---

## 🎯 РЕКОМЕНДУЕМОЕ РЕШЕНИЕ: ВАРИАНТ 1

**Почему:**
- Простая реализация
- Не меняет существующую логику
- Добавляет retry механизм
- Падает обратно на updateAllCards если не получается

**Преимущества:**
- Мгновенное обновление если карточка уже в DOM
- Retry через 100ms если карточка появляется позже
- Не блокирует основной поток
- Сохраняет fallback через updateAllCards

---

## 📊 ОЖИДАЕМЫЙ РЕЗУЛЬТАТ

**До исправления:**
```
Открытие задачи → Извлечение кода (200ms) → updateSingleCard не находит карточку → 
updateAllCards ждет 1000ms → Код появляется
ИТОГО: ~1200ms задержка
```

**После исправления:**
```
Открытие задачи → Извлечение кода (200ms) → updateSingleCard retry через 100ms → 
Код появляется
ИТОГО: ~300ms задержка
```

**Улучшение: 4x быстрее! ⚡**
