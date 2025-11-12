// Settings Page Logic v2 - GitHub Style

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI and load data
  await loadSettings();
  setupEventListeners();
  updateModeUI(document.querySelector('input[name="syncMode"]:checked').value);
  updateStatusPreview();
});

// --- Data Loading ---

async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'syncMode', 'teamId', 'userEmail', 'userName', 'userColor', 'customStatuses', 'officeDetectionEnabled'
  ]);

  // Sync Mode
  const syncMode = settings.syncMode || 'personal';
  document.querySelector(`input[name="syncMode"][value="${syncMode}"]`).checked = true;

  // Office Detection
  document.getElementById('officeDetectionToggle').checked = settings.officeDetectionEnabled !== false;

  // Team Settings
  document.getElementById('teamId').value = settings.teamId || '';
  document.getElementById('userEmail').value = settings.userEmail || '';
  document.getElementById('userName').value = settings.userName || '';

  // Color Picker
  const userColor = settings.userColor || '#0969da';
  const colorSelector = document.getElementById('colorSelector');
  const colors = ['#0969da', '#2da44e', '#9a6700', '#cf222e', '#8250df', '#e36209'];
  colorSelector.innerHTML = colors.map(color =>
    `<div class="color-option" data-color="${color}" style="background-color: ${color};"></div>`
  ).join('');
  const selectedOption = colorSelector.querySelector(`[data-color="${userColor}"]`);
  if (selectedOption) {
    selectedOption.classList.add('selected');
  }

  // Custom Statuses
  await loadCustomStatuses();
  
  // Issue Data
  await loadIssueDataList();
}

async function loadCustomStatuses() {
  const { customStatuses } = await chrome.storage.local.get('customStatuses');
  const statuses = customStatuses || [
    { id: 'red', name: 'Проблема', color: '#EF4444', isDefault: true },
    { id: 'yellow', name: 'В процессе', color: '#EAB308', isDefault: true },
    { id: 'purple', name: 'В фокусе', color: '#A855F7', isDefault: true },
    { id: 'green', name: 'Готово', color: '#22C55E', isDefault: true }
  ];

  const statusesList = document.getElementById('statusesList');
  if (statuses.length === 0) {
    statusesList.innerHTML = '<p class="note">Нет созданных статусов. Вы можете добавить их ниже или сбросить к стандартным.</p>';
    return;
  }
  
  statusesList.innerHTML = statuses.map(status => `
    <div class="status-item">
      <div class="status-item-preview">
        ${status.emoji ? `<span>${status.emoji}</span>` : ''}
        <div class="status-dot" style="background-color: ${status.color};"></div>
        <span>${status.name}</span>
      </div>
      <button class="btn btn-danger" data-id="${status.id}">Удалить</button>
    </div>
  `).join('');
}

async function loadIssueDataList() {
    const selector = document.getElementById('issueSelector');
    const allData = await chrome.storage.local.get(null);
    const issueKeys = Object.keys(allData)
        .filter(key => key.startsWith('issuedata_'))
        .map(key => key.replace('issuedata_', ''))
        .sort();

    selector.innerHTML = '<option value="">-- Выберите карточку --</option>';
    if (issueKeys.length === 0) {
        document.getElementById('issuedataTab').querySelector('.box').style.display = 'none';
        return;
    }

    issueKeys.forEach(key => {
        const option = document.createElement('option');
        option.value = key;
        option.textContent = key;
        selector.appendChild(option);
    });
}


// --- UI Update Functions ---

function updateModeUI(mode) {
  document.getElementById('syncSettings').style.display = mode === 'team' ? 'block' : 'none';
}

function updateStatusPreview() {
  const name = document.getElementById('newStatusName').value || 'Имя статуса';
  const emoji = document.getElementById('newStatusEmoji').value;
  const color = document.getElementById('newStatusColor').value;

  document.getElementById('previewName').textContent = name;
  document.getElementById('previewEmoji').textContent = emoji;
  document.getElementById('previewDot').style.backgroundColor = color;
}

// --- Event Listeners ---

function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.nav-tab, .tab-content').forEach(el => el.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tabName}Tab`).classList.add('active');
    });
  });

  // Sync mode change
  document.querySelectorAll('input[name="syncMode"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const mode = e.target.value;
        updateModeUI(mode);
        chrome.storage.local.set({ syncMode: mode });
    });
  });
  
  // Office detection toggle
  document.getElementById('officeDetectionToggle').addEventListener('change', (e) => {
      chrome.storage.local.set({ officeDetectionEnabled: e.target.checked });
  });

  // Color picker
  document.getElementById('colorSelector').addEventListener('click', (e) => {
    if (e.target.classList.contains('color-option')) {
      document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
      e.target.classList.add('selected');
      chrome.storage.local.set({ userColor: e.target.dataset.color });
    }
  });
  
  // Connect button
  document.getElementById('connectBtn').addEventListener('click', () => {
      const teamId = document.getElementById('teamId').value;
      const userEmail = document.getElementById('userEmail').value;
      const userName = document.getElementById('userName').value;
      chrome.storage.local.set({ teamId, userEmail, userName });
      // Add connection logic here
  });

  // Status creation form
  ['newStatusName', 'newStatusEmoji', 'newStatusColor'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateStatusPreview);
  });

  document.getElementById('addStatusBtn').addEventListener('click', async () => {
    const name = document.getElementById('newStatusName').value.trim();
    if (!name) return alert('Название статуса не может быть пустым.');

    const newStatus = {
      id: 'custom_' + Date.now(),
      name,
      emoji: document.getElementById('newStatusEmoji').value.trim(),
      color: document.getElementById('newStatusColor').value,
      isDefault: false
    };

    const { customStatuses } = await chrome.storage.local.get('customStatuses');
    const statuses = customStatuses || [];
    statuses.push(newStatus);
    await chrome.storage.local.set({ customStatuses: statuses });
    await loadCustomStatuses();
  });
  
  // Reset statuses
  document.getElementById('resetDefaultsBtn').addEventListener('click', async () => {
      if (confirm('Вы уверены, что хотите сбросить статусы к стандартным? Все ваши созданные статусы будут удалены.')) {
          await chrome.storage.local.remove('customStatuses');
          await loadCustomStatuses();
      }
  });

  // Delete all statuses
  document.getElementById('deleteAllStatusesBtn').addEventListener('click', async () => {
      if (confirm('Вы уверены, что хотите удалить ВСЕ статусы?')) {
          await chrome.storage.local.set({ customStatuses: [] });
          await loadCustomStatuses();
      }
  });

  // Delete status
  document.getElementById('statusesList').addEventListener('click', async (e) => {
    if (e.target.matches('.btn-danger')) {
      const statusId = e.target.dataset.id;
      if (confirm('Удалить этот статус?')) {
        const { customStatuses } = await chrome.storage.local.get('customStatuses');
        const filtered = customStatuses.filter(s => s.id !== statusId);
        await chrome.storage.local.set({ customStatuses: filtered });
        await loadCustomStatuses();
      }
    }
  });
  
  // Issue data selector
  document.getElementById('issueSelector').addEventListener('change', (e) => {
      displayIssueData(e.target.value);
  });
  
  // Delete all issues
  document.getElementById('deleteAllIssuesBtn').addEventListener('click', async () => {
      if (confirm('Вы уверены, что хотите удалить данные ВСЕХ карточек? Это действие нельзя отменить.')) {
          const allData = await chrome.storage.local.get(null);
          const keysToDelete = Object.keys(allData).filter(key => key.startsWith('issuedata_'));
          await chrome.storage.local.remove(keysToDelete);
          await loadIssueDataList();
          document.getElementById('issueDataContainer').style.display = 'none';
      }
  });
}

async function displayIssueData(issueKey) {
    const container = document.getElementById('issueDataContainer');
    if (!issueKey) {
        container.style.display = 'none';
        return;
    }

    const result = await chrome.storage.local.get(`issuedata_${issueKey}`);
    const data = result[`issuedata_${issueKey}`];
    if (!data) return;

    container.style.display = 'block';
    document.getElementById('selectedIssueKey').textContent = issueKey;
    document.getElementById('extractedAt').textContent = new Date(data.extractedAt).toLocaleString();
    
    const grid = document.getElementById('issueFieldsGrid');
    grid.innerHTML = Object.entries(data.fields).map(([key, field]) => `
        <div class="field-card">
            <div class="field-label">${field.label} (${key})</div>
            <div class="field-value">${field.value || 'пусто'}</div>
        </div>
    `).join('');
}

