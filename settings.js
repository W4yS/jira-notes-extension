// Settings Page Logic
let syncService = null;

let currentMode = 'personal';
let selectedColor = '#667eea';
let currentTab = 'sync';

// Стандартные статусы по умолчанию
const DEFAULT_STATUSES = [
  { id: 'red', name: 'Проблема', emoji: '🔴', color: '#EF4444', isDefault: true },
  { id: 'yellow', name: 'В процессе', emoji: '🟡', color: '#EAB308', isDefault: true },
  { id: 'purple', name: 'В фокусе', emoji: '🟣', color: '#A855F7', isDefault: true },
  { id: 'green', name: 'Готово', emoji: '🟢', color: '#22C55E', isDefault: true }
];

// Динамическая загрузка sync-service
async function loadSyncService() {
  try {
    const module = await import('./sync-service.js');
    syncService = module.syncService;
    console.log('✅ Sync service loaded');
  } catch (error) {
    // Sync service опционален, игнорируем если не найден
    console.log('ℹ️ Sync service not available (personal mode only)');
  }
}

// Загрузка сохранённых настроек
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'syncMode',
    'teamId',
    'userEmail',
    'userName',
    'userColor',
    'customStatuses',
    'officeDetectionEnabled'
  ]);

  currentMode = settings.syncMode || 'personal';
  
  // Загружаем состояние чекбокса автоопределения офисов (по умолчанию включено)
  const officeToggle = document.getElementById('officeDetectionToggle');
  if (officeToggle) {
    officeToggle.checked = settings.officeDetectionEnabled !== false; // по умолчанию true
  }
  
  // Устанавливаем активный режим
  document.querySelectorAll('.mode-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === currentMode);
  });

  // Показываем/скрываем настройки синхронизации
  updateModeUI();

  // Заполняем поля
  if (settings.teamId) document.getElementById('teamId').value = settings.teamId;
  if (settings.userEmail) document.getElementById('userEmail').value = settings.userEmail;
  if (settings.userName) document.getElementById('userName').value = settings.userName;
  if (settings.userColor) {
    selectedColor = settings.userColor;
    updateColorSelection();
  }

  // Если в командном режиме и настройки есть - показываем статус
  if (currentMode === 'team' && settings.teamId && settings.userEmail) {
    await checkConnection(settings);
  }

  // Загружаем кастомные статусы
  await loadCustomStatuses();
}

// Обновление UI в зависимости от режима
function updateModeUI() {
  const syncSettings = document.getElementById('syncSettings');
  const personalButtons = document.getElementById('personalButtons');

  if (currentMode === 'team') {
    syncSettings.classList.add('visible');
    personalButtons.style.display = 'none';
  } else {
    syncSettings.classList.remove('visible');
    personalButtons.style.display = 'flex';
  }
}

// Обновление выбранного цвета
function updateColorSelection() {
  document.querySelectorAll('.color-option').forEach(option => {
    option.classList.toggle('selected', option.dataset.color === selectedColor);
  });
}

// Проверка подключения
async function checkConnection(settings) {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const statusDot = statusIndicator.querySelector('.status-dot');

  statusIndicator.style.display = 'flex';
  statusText.textContent = 'Подключение...';

  try {
    if (!syncService) {
      throw new Error('Sync service not available');
    }
    
    const success = await syncService.init(
      settings.teamId,
      settings.userEmail,
      settings.userName,
      settings.userColor
    );

    if (success) {
      statusIndicator.classList.remove('offline');
      statusIndicator.classList.add('online');
      statusDot.classList.remove('offline');
      statusDot.classList.add('online');
      statusText.textContent = '✅ Подключено к команде';

      // Загружаем участников команды
      await loadTeamMembers();
    } else {
      throw new Error('Connection failed');
    }
  } catch (error) {
    statusIndicator.classList.remove('online');
    statusIndicator.classList.add('offline');
    statusDot.classList.remove('online');
    statusDot.classList.add('offline');
    statusText.textContent = '❌ Ошибка подключения';
  }
}

// Загрузка участников команды
async function loadTeamMembers() {
  const teamMembers = document.getElementById('teamMembers');
  const membersList = document.getElementById('membersList');

  try {
    if (!syncService) {
      console.warn('Sync service not available');
      return;
    }
    
    const members = await syncService.getTeamMembers();
    
    if (members.length > 0) {
      teamMembers.style.display = 'block';
      membersList.innerHTML = members.map(member => `
        <div class="member">
          <div class="member-color" style="background: ${member.color};"></div>
          <div class="member-info">
            <div class="member-name">${member.name}</div>
            <div class="member-email">${member.email}</div>
          </div>
        </div>
      `).join('');
    }
  } catch (error) {
    console.error('Error loading team members:', error);
  }
}

// Обработчики событий
document.addEventListener('DOMContentLoaded', async () => {
  console.log('⚙️ Settings page loaded');
  console.log('📋 DOM elements check:');
  console.log('  - .tab elements:', document.querySelectorAll('.tab').length);
  console.log('  - #syncTab:', !!document.getElementById('syncTab'));
  console.log('  - #statusesTab:', !!document.getElementById('statusesTab'));
  
  // Загружаем sync service асинхронно
  await loadSyncService();
  
  // Загружаем настройки
  await loadSettings();

  // Переключение табов
  const tabs = document.querySelectorAll('.tab');
  console.log('Found tabs:', tabs.length);
  
  tabs.forEach(tab => {
    console.log('Adding click listener to tab:', tab.dataset.tab);
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      console.log('Tab clicked:', tabName);
      
      // Обновляем активный таб
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Показываем нужный контент
      const syncTab = document.getElementById('syncTab');
      const statusesTab = document.getElementById('statusesTab');
      const issuedataTab = document.getElementById('issuedataTab');
      
      console.log('syncTab:', syncTab, 'statusesTab:', statusesTab, 'issuedataTab:', issuedataTab);
      
      if (syncTab) syncTab.style.display = tabName === 'sync' ? 'block' : 'none';
      if (statusesTab) statusesTab.style.display = tabName === 'statuses' ? 'block' : 'none';
      if (issuedataTab) {
        issuedataTab.style.display = tabName === 'issuedata' ? 'block' : 'none';
        if (tabName === 'issuedata') {
          loadIssueDataList();
        }
      }
      
      currentTab = tabName;
    });
  });

  // Переключение режима
  document.querySelectorAll('.mode-button').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.mode-button').forEach(btn => {
        btn.classList.remove('active');
      });
      button.classList.add('active');
      currentMode = button.dataset.mode;
      updateModeUI();
    });
  });

  // Выбор цвета
  document.querySelectorAll('.color-option').forEach(option => {
    option.addEventListener('click', () => {
      selectedColor = option.dataset.color;
      updateColorSelection();
    });
  });

  // Подключение к команде
  document.getElementById('connectBtn').addEventListener('click', async () => {
    const teamId = document.getElementById('teamId').value.trim();
    const userEmail = document.getElementById('userEmail').value.trim();
    const userName = document.getElementById('userName').value.trim();

    if (!teamId || !userEmail || !userName) {
      alert('Пожалуйста, заполните все поля!');
      return;
    }

    const settings = {
      syncMode: 'team',
      teamId,
      userEmail,
      userName,
      userColor: selectedColor
    };

    // Сохраняем настройки
    await chrome.storage.local.set(settings);

    // Пытаемся подключиться
    await checkConnection(settings);

    // Спрашиваем о миграции данных
    if (syncService && confirm('Хотите загрузить ваши локальные заметки в командную синхронизацию?')) {
      await syncService.migrateLocalToTeam();
      alert('✅ Заметки успешно загружены в командную синхронизацию!');
    }

    alert('✅ Настройки сохранены! Перезагрузите страницу Jira для применения изменений.');
  });

  // Тест соединения
  document.getElementById('testBtn').addEventListener('click', async () => {
    const teamId = document.getElementById('teamId').value.trim();
    const userEmail = document.getElementById('userEmail').value.trim();
    const userName = document.getElementById('userName').value.trim();

    if (!teamId || !userEmail || !userName) {
      alert('Пожалуйста, заполните все поля!');
      return;
    }

    await checkConnection({
      teamId,
      userEmail,
      userName,
      userColor: selectedColor
    });
  });

  // Сохранение личного режима
  document.getElementById('savePersonalBtn').addEventListener('click', async () => {
    await chrome.storage.local.set({
      syncMode: 'personal'
    });

    // Отключаем синхронизацию
    if (syncService) {
      syncService.disconnect();
    }

    alert('✅ Личный режим активирован!');
  });

  // Сохранение настройки автоопределения офисов
  const officeToggle = document.getElementById('officeDetectionToggle');
  if (officeToggle) {
    officeToggle.addEventListener('change', async () => {
      await chrome.storage.local.set({
        officeDetectionEnabled: officeToggle.checked
      });
      console.log('🏢 Office detection:', officeToggle.checked ? 'enabled' : 'disabled');
      alert(officeToggle.checked 
        ? '✅ Автоопределение офисов включено!' 
        : '⚠️ Автоопределение офисов отключено. Кодировки офисов не будут отображаться на карточках.');
    });
  }

  // === КАСТОМНЫЕ СТАТУСЫ ===

  // Обновление предпросмотра статуса
  const updatePreview = () => {
    const name = document.getElementById('newStatusName').value || 'Новый статус';
    const emoji = document.getElementById('newStatusEmoji').value || '';
    const color = document.getElementById('newStatusColor').value;

    document.getElementById('previewName').textContent = name;
    document.getElementById('previewEmoji').textContent = emoji;
    document.getElementById('previewEmoji').style.display = emoji ? 'inline' : 'none';
    document.getElementById('previewDot').style.background = color;
  };

  document.getElementById('newStatusName')?.addEventListener('input', updatePreview);
  document.getElementById('newStatusEmoji')?.addEventListener('input', updatePreview);
  document.getElementById('newStatusColor')?.addEventListener('input', (e) => {
    document.getElementById('newStatusColorHex').value = e.target.value;
    updatePreview();
  });
  document.getElementById('newStatusColorHex')?.addEventListener('input', (e) => {
    const hex = e.target.value;
    if (/^#[0-9A-Fa-f]{6}$/.test(hex)) {
      document.getElementById('newStatusColor').value = hex;
      updatePreview();
    }
  });

  // Выбор цвета из пресетов
  document.querySelectorAll('.color-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      document.getElementById('newStatusColor').value = color;
      document.getElementById('newStatusColorHex').value = color;
      updatePreview();
    });
  });

  // Добавление нового статуса
  document.getElementById('addStatusBtn')?.addEventListener('click', async () => {
    const name = document.getElementById('newStatusName').value.trim();
    const emoji = document.getElementById('newStatusEmoji').value.trim();
    const color = document.getElementById('newStatusColor').value;

    if (!name) {
      alert('Введите название статуса!');
      return;
    }

    // Генерируем уникальный ID
    const id = 'custom_' + Date.now();

    const newStatus = {
      id,
      name,
      emoji,
      color,
      isDefault: false
    };

    // Получаем текущие статусы
    const result = await chrome.storage.local.get('customStatuses');
    const statuses = result.customStatuses || DEFAULT_STATUSES;

    // Добавляем новый
    statuses.push(newStatus);

    // Сохраняем
    await chrome.storage.local.set({ customStatuses: statuses });

    // Обновляем список
    await loadCustomStatuses();

    // Очищаем форму
    document.getElementById('newStatusName').value = '';
    document.getElementById('newStatusEmoji').value = '';
    document.getElementById('newStatusColor').value = '#3b82f6';
    document.getElementById('newStatusColorHex').value = '#3b82f6';
    updatePreview();

    alert('✅ Статус добавлен! Перезагрузите страницу Jira для применения изменений.');
  });

  // Сброс к стандартным статусам
  document.getElementById('resetDefaultsBtn')?.addEventListener('click', async () => {
    if (confirm('Вернуть стандартные статусы? Все кастомные статусы будут удалены.')) {
      await chrome.storage.local.set({ customStatuses: DEFAULT_STATUSES });
      await loadCustomStatuses();
      alert('✅ Статусы сброшены к стандартным!');
    }
  });

  // === ДАННЫЕ КАРТОЧЕК ===

  // Обработчик выбора карточки
  document.getElementById('issueSelector')?.addEventListener('change', (e) => {
    const issueKey = e.target.value;
    if (issueKey) {
      displayIssueData(issueKey);
    } else {
      document.getElementById('issueDataContainer').style.display = 'none';
    }
  });

  // Экспорт ВСЕХ данных карточек в один JSON
  document.getElementById('exportAllIssuesBtn')?.addEventListener('click', async () => {
    // Получаем все данные из storage
    const allData = await chrome.storage.local.get(null);
    
    // Фильтруем только issuedata_*
    const allIssues = {};
    let count = 0;
    
    for (const [key, value] of Object.entries(allData)) {
      if (key.startsWith('issuedata_')) {
        const issueKey = key.replace('issuedata_', '');
        allIssues[issueKey] = value;
        count++;
      }
    }
    
    if (count === 0) {
      alert('⚠️ Нет сохраненных данных карточек для экспорта');
      return;
    }
    
    // Создаем файл с текущей датой и временем
    const now = new Date();
    const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `jira_all_issues_${timestamp}.json`;
    
    // Экспортируем
    const exportData = {
      exportedAt: now.toISOString(),
      totalIssues: count,
      issues: allIssues
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    
    alert(`✅ Экспортировано ${count} карточек в файл ${filename}`);
  });

  // Удаление ВСЕХ данных карточек
  document.getElementById('deleteAllIssuesBtn')?.addEventListener('click', async () => {
    // Получаем все данные из storage
    const allData = await chrome.storage.local.get(null);
    
    // Фильтруем только issuedata_*, devicetype_*
    const keysToDelete = [];
    let count = 0;
    
    for (const key of Object.keys(allData)) {
      if (key.startsWith('issuedata_') || key.startsWith('devicetype_')) {
        keysToDelete.push(key);
        if (key.startsWith('issuedata_')) {
          count++;
        }
      }
    }
    
    if (count === 0) {
      alert('⚠️ Нет сохраненных данных карточек для удаления');
      return;
    }
    
    // Подтверждение удаления
    if (!confirm(`⚠️ ВНИМАНИЕ!\n\nВы уверены, что хотите удалить ВСЕ данные карточек?\n\nБудет удалено: ${count} карточек\n\nЭто действие нельзя отменить!`)) {
      return;
    }
    
    // Второе подтверждение для безопасности
    if (!confirm(`🚨 Последнее предупреждение!\n\nВы действительно хотите удалить ${count} карточек?\n\nНажмите "ОК" для подтверждения удаления.`)) {
      return;
    }
    
    // Удаляем все ключи
    await chrome.storage.local.remove(keysToDelete);
    
    // Обновляем интерфейс
    document.getElementById('issueDataContainer').style.display = 'none';
    document.getElementById('issueSelector').value = '';
    await loadIssueDataList();
    
    alert(`✅ Успешно удалено ${count} карточек и связанных данных!`);
  });

  // Экспорт данных карточки в JSON
  document.getElementById('exportIssueBtn')?.addEventListener('click', async () => {
    const issueKey = document.getElementById('issueSelector').value;
    if (!issueKey) return;

    const result = await chrome.storage.local.get(`issuedata_${issueKey}`);
    const data = result[`issuedata_${issueKey}`];

    if (data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${issueKey}_data.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Удаление данных карточки
  document.getElementById('deleteIssueBtn')?.addEventListener('click', async () => {
    const issueKey = document.getElementById('issueSelector').value;
    if (!issueKey) return;

    if (confirm(`Удалить данные карточки ${issueKey}?`)) {
      await chrome.storage.local.remove(`issuedata_${issueKey}`);
      document.getElementById('issueDataContainer').style.display = 'none';
      document.getElementById('issueSelector').value = '';
      await loadIssueDataList();
      alert('✅ Данные удалены!');
    }
  });
});

// Загрузка и отображение кастомных статусов
async function loadCustomStatuses() {
  const result = await chrome.storage.local.get('customStatuses');
  const statuses = result.customStatuses || DEFAULT_STATUSES;

  // Если статусов нет, устанавливаем стандартные
  if (!result.customStatuses) {
    await chrome.storage.local.set({ customStatuses: DEFAULT_STATUSES });
  }

  const statusesList = document.getElementById('statusesList');
  if (!statusesList) return;

  statusesList.innerHTML = statuses.map(status => `
    <div class="status-item ${status.isDefault ? 'default' : ''}">
      <div class="status-item-left">
        ${status.emoji ? `<span class="status-item-emoji">${status.emoji}</span>` : ''}
        <div class="status-item-dot" style="background: ${status.color};"></div>
        <span class="status-item-name">${status.name}</span>
        ${status.isDefault ? '<span class="status-item-badge">Стандартный</span>' : ''}
      </div>
      <div class="status-item-actions">
        ${!status.isDefault ? `<button class="delete" data-id="${status.id}">🗑️ Удалить</button>` : ''}
      </div>
    </div>
  `).join('');

  // Обработчики удаления
  statusesList.querySelectorAll('.delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (confirm('Удалить этот статус?')) {
        const filtered = statuses.filter(s => s.id !== id);
        await chrome.storage.local.set({ customStatuses: filtered });
        await loadCustomStatuses();
        alert('✅ Статус удален!');
      }
    });
  });
}

// === ФУНКЦИИ ДЛЯ РАБОТЫ С ДАННЫМИ КАРТОЧЕК ===

// Загрузка списка всех карточек с данными
async function loadIssueDataList() {
  const selector = document.getElementById('issueSelector');
  const emptyState = document.getElementById('emptyState');
  
  if (!selector) return;

  // Получаем все ключи из localStorage
  const allKeys = await chrome.storage.local.get(null);
  const issueKeys = Object.keys(allKeys)
    .filter(key => key.startsWith('issuedata_'))
    .map(key => key.replace('issuedata_', ''))
    .sort();

  // Очищаем селектор
  selector.innerHTML = '<option value="">-- Выберите карточку --</option>';

  if (issueKeys.length === 0) {
    emptyState.style.display = 'block';
    document.getElementById('issueDataContainer').style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';

  // Добавляем опции с типом устройства
  for (const key of issueKeys) {
    const data = allKeys[`issuedata_${key}`];
    const deviceType = detectDeviceType(data?.fields || {});
    
    const option = document.createElement('option');
    option.value = key;
    option.textContent = `${key} — ${deviceType.icon} ${deviceType.name}`;
    selector.appendChild(option);
  }
}

// Определение типа устройства по данным карточки
function detectDeviceType(fields) {
  // Ищем поле с типом оборудования (customfield_11122)
  const equipmentField = fields.customfield_11122;
  
  if (!equipmentField || !equipmentField.value) {
    return {
      type: 'other',
      name: 'Другое',
      icon: '📦',
      badge: '<span style="background: linear-gradient(135deg, #9333ea 0%, #6b21a8 100%); color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin-left: 8px; font-weight: 600;">📦 Другое</span>'
    };
  }
  
  const value = equipmentField.value.toLowerCase();
  
  // Apple/Mac
  if (value.includes('macbook') || value.includes('mac') || value.includes('apple')) {
    return {
      type: 'apple',
      name: 'Apple',
      icon: '',
      badge: '<span style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin-left: 8px; font-weight: 600;"> Apple</span>'
    };
  }
  
  // Windows ноутбуки
  if (value.includes('windows') || value.includes('ноутбук') || value.includes('laptop')) {
    return {
      type: 'windows',
      name: 'Windows',
      icon: '🪟',
      badge: '<span style="background: linear-gradient(135deg, #0078d4 0%, #00a4ef 100%); color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin-left: 8px; font-weight: 600;">🪟 Windows</span>'
    };
  }
  
  // Все остальное (периферия, телефоны, другое оборудование) - other
  return {
    type: 'other',
    name: 'Другое',
    icon: '📦',
    badge: '<span style="background: linear-gradient(135deg, #9333ea 0%, #6b21a8 100%); color: white; padding: 4px 10px; border-radius: 12px; font-size: 12px; margin-left: 8px; font-weight: 600;">📦 Другое</span>'
  };
}

// Отображение данных выбранной карточки
async function displayIssueData(issueKey) {
  const container = document.getElementById('issueDataContainer');
  const fieldsGrid = document.getElementById('issueFieldsGrid');
  const selectedKey = document.getElementById('selectedIssueKey');
  const extractedAt = document.getElementById('extractedAt');

  if (!container || !fieldsGrid) return;

  // Получаем данные
  const result = await chrome.storage.local.get(`issuedata_${issueKey}`);
  const data = result[`issuedata_${issueKey}`];

  if (!data) {
    container.style.display = 'none';
    return;
  }

  // Показываем контейнер
  container.style.display = 'block';

  // Определяем тип устройства
  const deviceType = detectDeviceType(data.fields);
  
  // Обновляем заголовок и метаданные с типом устройства
  selectedKey.innerHTML = `
    Карточка: ${issueKey} 
    ${deviceType.badge}
  `;
  extractedAt.textContent = new Date(data.extractedAt).toLocaleString('ru-RU');

  // Отображаем поля
  fieldsGrid.innerHTML = '';

  const fields = data.fields || {};
  
  // Разделяем на основные поля и кастомные
  const mainFields = ['issueKey', 'summary'];
  const mainFieldEntries = Object.entries(fields)
    .filter(([key]) => mainFields.includes(key));
  
  const customFieldEntries = Object.entries(fields)
    .filter(([key]) => key.startsWith('customfield_'))
    .sort((a, b) => {
      const numA = parseInt(a[0].replace('customfield_', ''));
      const numB = parseInt(b[0].replace('customfield_', ''));
      return numA - numB;
    });

  const allEntries = [...mainFieldEntries, ...customFieldEntries];

  if (allEntries.length === 0) {
    fieldsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: #999; padding: 40px;">Нет данных для отображения</div>';
    return;
  }

  // Иконки по умолчанию для разных типов полей
  const getIcon = (fieldId, fieldName) => {
    // Специальные иконки для основных полей
    if (fieldId === 'issueKey') return '🔑';
    if (fieldId === 'summary') return '📝';
    
    const name = fieldName.toLowerCase();
    if (name.includes('дата') || name.includes('date')) return '📅';
    if (name.includes('оборудование') || name.includes('equipment')) return '💻';
    if (name.includes('telegram') || name.includes('телеграм')) return '✈️';
    if (name.includes('проект') || name.includes('project')) return '📊';
    if (name.includes('отдел') || name.includes('department')) return '🏢';
    if (name.includes('адрес') || name.includes('address')) return '📍';
    if (name.includes('телефон') || name.includes('phone')) return '📞';
    if (name.includes('geo') || name.includes('гео')) return '🌍';
    if (name.includes('исполнитель') || name.includes('executor')) return '👤';
    if (name.includes('задача') || name.includes('task')) return '📋';
    return '📌'; // По умолчанию
  };

  allEntries.forEach(([fieldId, fieldData]) => {
    const { label, value } = fieldData;
    
    if (!value) return;

    const fieldCard = document.createElement('div');
    fieldCard.className = 'field-card';

    const fieldLabel = document.createElement('div');
    fieldLabel.className = 'field-label';
    fieldLabel.textContent = `${getIcon(fieldId, label)} ${label || fieldId}`;

    const fieldValue = document.createElement('div');
    fieldValue.className = 'field-value';
    
    // Определяем тип данных для стилизации
    if (label && (label.includes('дата') || label.includes('Date'))) {
      fieldValue.className = 'field-value date';
    }
    
    fieldValue.textContent = value;

    // Добавляем подсказку с ID поля
    fieldCard.title = fieldId;

    fieldCard.appendChild(fieldLabel);
    fieldCard.appendChild(fieldValue);
    fieldsGrid.appendChild(fieldCard);
  });

  // Добавляем счетчик полей
  const counter = document.createElement('div');
  counter.style.cssText = 'grid-column: 1/-1; text-align: center; color: #999; font-size: 12px; padding-top: 16px; border-top: 1px solid #e5e7eb;';
  counter.textContent = `Всего полей: ${allEntries.length} (основных: ${mainFieldEntries.length}, кастомных: ${customFieldEntries.length})`;
  fieldsGrid.appendChild(counter);
}

