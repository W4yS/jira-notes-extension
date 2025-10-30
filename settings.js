// Settings Page Logic
import { syncService } from './sync-service.js';

let currentMode = 'personal';
let selectedColor = '#667eea';

// Загрузка сохранённых настроек
async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'syncMode',
    'teamId',
    'userEmail',
    'userName',
    'userColor'
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
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

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
    if (confirm('Хотите загрузить ваши локальные заметки в командную синхронизацию?')) {
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
    syncService.disconnect();

    alert('✅ Личный режим активирован!');
  });
});
