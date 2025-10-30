# 🚀 Быстрый старт - Команды для GitHub

## 📤 Загрузка на GitHub (выполнить ОДИН РАЗ)

```powershell
cd c:\vscode\jira-notes-extension

# 1. Подключить GitHub репозиторий (замените YOUR_USERNAME на ваш username)
git remote add origin https://github.com/YOUR_USERNAME/jira-notes-extension.git

# 2. Переименовать ветку master → main (опционально)
git branch -M main

# 3. Загрузить основную ветку
git push -u origin main

# 4. Загрузить тестовую ветку
git push -u origin sync-test
```

## 🔄 Ежедневная работа

### Работа на ветке sync-test (разработка синхронизации)

```powershell
# Переключиться на sync-test
git checkout sync-test

# Проверить статус (какие файлы изменены)
git status

# Добавить изменения
git add .

# Сохранить с комментарием
git commit -m "Описание изменений"

# Загрузить на GitHub
git push origin sync-test
```

### Проверка изменений

```powershell
# Посмотреть какие файлы изменены
git status

# Посмотреть что именно изменилось в файлах
git diff

# Посмотреть историю коммитов
git log --oneline
```

### Переключение между ветками

```powershell
# На основную ветку (стабильная версия)
git checkout main

# На тестовую ветку (разработка синхронизации)
git checkout sync-test

# Посмотреть все ветки
git branch
```

## 🎯 Сценарии использования

### 1️⃣ Первая загрузка проекта на GitHub

```powershell
# Откройте PowerShell и выполните:
cd c:\vscode\jira-notes-extension
git remote add origin https://github.com/YOUR_USERNAME/jira-notes-extension.git
git branch -M main
git push -u origin main
git push -u origin sync-test
```

### 2️⃣ Начало работы над синхронизацией

```powershell
# Переключитесь на тестовую ветку
git checkout sync-test

# Создайте новые файлы (firebase-config.js, sync-service.js)
# Редактируйте существующие файлы

# Сохраните изменения
git add .
git commit -m "Add Firebase configuration and sync service"
git push origin sync-test
```

### 3️⃣ Синхронизация с GitHub (если работаете с другого компьютера)

```powershell
# Скачать последние изменения
git fetch origin

# Переключиться на нужную ветку
git checkout sync-test

# Подтянуть изменения
git pull origin sync-test
```

### 4️⃣ Слияние sync-test в main (после успешного тестирования)

```powershell
# Переключитесь на основную ветку
git checkout main

# Слейте изменения из sync-test
git merge sync-test

# Загрузите на GitHub
git push origin main
```

## 🆘 Решение проблем

### Забыли добавить файлы в последний коммит

```powershell
git add забытый-файл.js
git commit --amend --no-edit
git push origin sync-test -f
```

### Хотите отменить последний коммит (но оставить изменения)

```powershell
git reset --soft HEAD~1
```

### Хотите полностью откатить изменения

```powershell
# Отменить изменения в конкретном файле
git checkout -- имя-файла.js

# Отменить ВСЕ изменения (ОСТОРОЖНО!)
git reset --hard HEAD
```

### Ошибка "fatal: remote origin already exists"

```powershell
# Удалите существующий remote
git remote remove origin

# Добавьте заново
git remote add origin https://github.com/YOUR_USERNAME/jira-notes-extension.git
```

## 🔐 Аутентификация

### Personal Access Token (рекомендуется)

1. GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)
2. "Generate new token (classic)"
3. Выберите права: `repo` (full control)
4. Скопируйте токен
5. При `git push` вместо пароля вставьте токен

### Сохранение credentials

```powershell
# Сохранить credentials в Windows Credential Manager
git config --global credential.helper wincred
```

## 📊 Полезные команды

```powershell
# Посмотреть удалённые репозитории
git remote -v

# Посмотреть все ветки (включая удалённые)
git branch -a

# Красивый лог
git log --graph --oneline --all

# Кто и когда менял файл
git blame имя-файла.js

# Найти в истории
git log --all --grep="поисковый запрос"

# Размер репозитория
git count-objects -vH
```

## ✅ Checklist перед push

- [ ] Проверил `git status` - нет лишних файлов
- [ ] Проверил `git diff` - изменения корректны
- [ ] Написал понятный commit message
- [ ] Протестировал расширение локально
- [ ] Готов загрузить на GitHub

---

**💡 Совет**: Коммитьте часто, пушьте регулярно!

**📖 Подробнее**: Смотрите GITHUB_SETUP.md для детальных инструкций
