# Исправление политик RLS (бесконечная рекурсия)

## Проблема
```
infinite recursion detected in policy for relation "team_members"
```

Политики `team_members` ссылаются сами на себя, создавая рекурсию.

## Решение

Выполните этот SQL в Supabase Dashboard → SQL Editor:

```sql
-- ===== ШАГ 1: Удаляем старые политики =====

DROP POLICY IF EXISTS "Users can view members of their teams" ON team_members;
DROP POLICY IF EXISTS "Team admins can add members" ON team_members;
DROP POLICY IF EXISTS "Users can view teams they are members of" ON teams;
DROP POLICY IF EXISTS "Users can create teams" ON teams;

-- ===== ШАГ 2: Создаём правильные политики для teams =====

-- Просмотр команд: проверяем напрямую в team_members
CREATE POLICY "Users can view their teams"
ON teams FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_members 
    WHERE team_members.team_id = teams.id 
    AND team_members.user_id = auth.uid()
  )
);

-- Создание команд: только свои
CREATE POLICY "Users can create teams"
ON teams FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- Обновление команд: только если админ
CREATE POLICY "Team admins can update teams"
ON teams FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM team_members 
    WHERE team_members.team_id = teams.id 
    AND team_members.user_id = auth.uid() 
    AND team_members.role = 'admin'
  )
);

-- ===== ШАГ 3: Создаём правильные политики для team_members =====

-- Просмотр участников: если сам состоишь в команде
CREATE POLICY "Members can view team members"
ON team_members FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = team_members.team_id 
    AND tm.user_id = auth.uid()
  )
);

-- Добавление участников: создатель команды ВСЕГДА может добавить себя, 
-- админы могут добавлять других
CREATE POLICY "Creator and admins can add members"
ON team_members FOR INSERT
WITH CHECK (
  -- Если добавляешь себя, это всегда разрешено (для создания команды)
  user_id = auth.uid()
  OR
  -- Или ты админ этой команды
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid() 
    AND tm.role = 'admin'
  )
);

-- Удаление участников: только админы или сам себя
CREATE POLICY "Members can leave or admins can remove"
ON team_members FOR DELETE
USING (
  user_id = auth.uid() -- можешь удалить себя
  OR 
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid() 
    AND tm.role = 'admin'
  )
);

-- ===== ШАГ 4: Исправляем политики для notes =====

-- Они тоже могут вызывать рекурсию, исправим на безопасный вариант

DROP POLICY IF EXISTS "Users can view team notes" ON notes;
DROP POLICY IF EXISTS "Users can insert team notes" ON notes;
DROP POLICY IF EXISTS "Users can update team notes" ON notes;
DROP POLICY IF EXISTS "Admins can delete team notes" ON notes;

CREATE POLICY "Members can view team notes"
ON notes FOR SELECT
USING (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Members can insert team notes"
ON notes FOR INSERT
WITH CHECK (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
  AND created_by = auth.uid()
);

CREATE POLICY "Members can update team notes"
ON notes FOR UPDATE
USING (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Admins can delete team notes"
ON notes FOR DELETE
USING (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid() 
    AND tm.role = 'admin'
  )
);

-- ===== ШАГ 5: Исправляем политики для issue_statuses =====

DROP POLICY IF EXISTS "Users can view team statuses" ON issue_statuses;
DROP POLICY IF EXISTS "Users can insert team statuses" ON issue_statuses;
DROP POLICY IF EXISTS "Users can update team statuses" ON issue_statuses;

CREATE POLICY "Members can view team statuses"
ON issue_statuses FOR SELECT
USING (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Members can insert team statuses"
ON issue_statuses FOR INSERT
WITH CHECK (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
  AND set_by = auth.uid()
);

CREATE POLICY "Members can update team statuses"
ON issue_statuses FOR UPDATE
USING (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

-- ===== ШАГ 6: Исправляем политики для audit_log =====

DROP POLICY IF EXISTS "Users can view team audit log" ON audit_log;
DROP POLICY IF EXISTS "Users can insert audit log" ON audit_log;

CREATE POLICY "Members can view team audit log"
ON audit_log FOR SELECT
USING (
  team_id IN (
    SELECT tm.team_id FROM team_members tm
    WHERE tm.user_id = auth.uid()
  )
);

CREATE POLICY "Members can insert audit log"
ON audit_log FOR INSERT
WITH CHECK (user_id = auth.uid());
```

## Проверка

После выполнения SQL:

1. Откройте настройки расширения
2. Войдите в аккаунт
3. Попробуйте создать команду
4. Должно работать без ошибки "infinite recursion"

## Что было исправлено

### До (плохо - рекурсия):
```sql
-- team_members ссылается сам на себя через team_id IN (SELECT team_id FROM team_members)
CREATE POLICY "Users can view members of their teams"
ON team_members FOR SELECT
USING (
  team_id IN (
    SELECT team_id FROM team_members WHERE user_id = auth.uid()
  )
);
```

### После (хорошо - псевдоним):
```sql
-- Используем псевдоним таблицы (tm) чтобы избежать рекурсии
CREATE POLICY "Members can view team members"
ON team_members FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM team_members tm
    WHERE tm.team_id = team_members.team_id 
    AND tm.user_id = auth.uid()
  )
);
```

## Ключевые отличия

1. **Используем псевдонимы таблиц** (`team_members tm`) в подзапросах
2. **Используем EXISTS вместо IN** где возможно (быстрее)
3. **Разделяем проверки** на уровне строк без циклических ссылок

Теперь политики работают правильно и не вызывают рекурсию! ✅
