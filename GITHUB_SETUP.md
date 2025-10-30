# 🚀 Инструкция по загрузке в GitHub

## Шаг 1: Создание репозитория на GitHub

1. Перейдите на [GitHub](https://github.com)
2. Нажмите кнопку **"+"** в правом верхнем углу → **"New repository"**
3. Заполните данные:
   - **Repository name**: `jira-notes-extension`
   - **Description**: "Chrome extension for personal notes and statuses in Jira | Расширение Chrome для личных заметок и статусов в Jira"
   - **Visibility**: выберите Public или Private
   - **НЕ СОЗДАВАЙТЕ** README, .gitignore или License (они уже есть)
4. Нажмите **"Create repository"**

## Шаг 2: Подключение локального репозитория

После создания репозитория GitHub покажет команды. Выполните в PowerShell:

```powershell
cd c:\vscode\jira-notes-extension

# Подключите удалённый репозиторий (замените YOUR_USERNAME на ваш username)
git remote add origin https://github.com/YOUR_USERNAME/jira-notes-extension.git

# Переименуйте ветку в main (если нужно)
git branch -M main

# Загрузите код на GitHub
git push -u origin main
```

## Шаг 3: Создание тестовой ветки для синхронизации

```powershell
# Создайте и переключитесь на новую ветку
git checkout -b sync-test

# Проверьте, что вы на нужной ветке
git branch
```

Теперь вы на ветке `sync-test` и готовы к разработке функции синхронизации!

## 🔄 Что дальше?

### На ветке sync-test мы реализуем:

1. **Firebase Realtime Database** - для синхронизации между пользователями
2. **Настройки синхронизации** - выбор режима (личный / командный)
3. **Индикаторы** - кто и когда последний редактировал заметку
4. **Конфликт-резолюция** - обработка одновременного редактирования

### Структура изменений:

```
sync-test ветка:
├── firebase-config.js      # Конфигурация Firebase
├── sync-service.js         # Сервис синхронизации
├── content.js              # Обновлённая логика с синхронизацией
└── manifest.json           # Добавлены разрешения для Firebase
```

## 📝 Важные команды Git

### Посмотреть статус
```powershell
git status
```

### Переключиться между ветками
```powershell
git checkout main       # На основную ветку
git checkout sync-test  # На тестовую ветку
```

### Сохранить изменения
```powershell
git add .
git commit -m "Описание изменений"
git push origin sync-test
```

### Слить изменения из sync-test в main (после тестирования)
```powershell
git checkout main
git merge sync-test
git push origin main
```

## 🔐 Аутентификация GitHub

Если GitHub запрашивает пароль при push:

### Вариант 1: Personal Access Token (рекомендуется)

1. Перейдите в Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Создайте новый token с правами `repo`
3. Используйте token вместо пароля

### Вариант 2: SSH ключ

```powershell
# Генерация SSH ключа
ssh-keygen -t ed25519 -C "your-email@example.com"

# Добавьте ключ в GitHub: Settings → SSH and GPG keys → New SSH key
```

Затем измените remote URL:
```powershell
git remote set-url origin git@github.com:YOUR_USERNAME/jira-notes-extension.git
```

## ✅ Проверка

После загрузки проверьте:
- Репозиторий виден на GitHub
- Все файлы загружены
- README.md отображается корректно
- Ветка sync-test создана

## 🎯 Следующие шаги

1. ✅ Создать репозиторий на GitHub
2. ✅ Загрузить текущую версию в main
3. ✅ Создать ветку sync-test
4. 🚧 Реализовать синхронизацию на sync-test
5. 🚧 Протестировать с 2-3 пользователями
6. 🚧 Слить в main после успешного тестирования

---

**Готовы начать? Выполните команды из Шага 2! 🚀**
