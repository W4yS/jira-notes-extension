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
    console.warn('⚠️ Sync service not available:', error);
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
    'customStatuses'
  ]);

  currentMode = settings.syncMode || 'personal';
  
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
      
      console.log('syncTab:', syncTab, 'statusesTab:', statusesTab);
      
      if (syncTab) syncTab.style.display = tabName === 'sync' ? 'block' : 'none';
      if (statusesTab) statusesTab.style.display = tabName === 'statuses' ? 'block' : 'none';
      
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
