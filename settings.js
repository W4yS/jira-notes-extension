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

  // Copypaste Template
  const { copypasteTemplate } = await chrome.storage.local.get('copypasteTemplate');
  document.getElementById('copypasteTemplate').value = copypasteTemplate || ``;

  // Available Fields for Template
  await loadAvailableFields();
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
    const tableBody = document.getElementById('issues-table-body');
    const allData = await chrome.storage.local.get(null);
    const issueDataEntries = Object.entries(allData).filter(([key]) => key.startsWith('issuedata_'));

    if (issueDataEntries.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px;">Нет сохраненных данных по карточкам.</td></tr>`;
        return;
    }

    const rowsHtml = issueDataEntries.map(([key, data]) => {
        const getField = (id) => data.fields?.[id]?.value || '<span class="empty">—</span>';
        
        const issueKey = data.issueKey || '<span class="empty">N/A</span>';
        const geo = getField('customfield_11174');
        const date = getField('customfield_11119');
        const office = getField('customfield_11120');

        const allFieldsHtml = Object.entries(data.fields).map(([fieldKey, field]) => `
            <div class="field-card">
                <div class="field-label">${field.label} (${fieldKey})</div>
                <div class="field-value">${field.value || '<span class="empty">пусто</span>'}</div>
            </div>
        `).join('');

        return `
            <tr class="main-row" data-details-id="${key}">
                <td>${issueKey}</td>
                <td>${geo}</td>
                <td>${date}</td>
                <td>${office}</td>
            </tr>
            <tr class="details-row" id="${key}">
                <td colspan="4">
                    <div class="details-content">${allFieldsHtml}</div>
                </td>
            </tr>
        `;
    }).join('');

    tableBody.innerHTML = rowsHtml;
}

async function loadAvailableFields() {
    const allData = await chrome.storage.local.get(null);
    const issueDataEntries = Object.values(allData).filter(value => value && value.issueKey && value.fields);

    const uniqueFields = new Map();

    // Add default fields first, they will be handled specially
    const defaultFields = new Map([
        ['TASK_ID', { label: 'ID Задачи', id: 'TASK_ID' }],
        ['USER_NAME', { label: 'Имя пользователя', id: 'USER_NAME' }],
        ['EQUIPMENT', { label: 'Оборудование', id: 'EQUIPMENT' }],
        ['ADDRESS', { label: 'Адрес', id: 'ADDRESS' }],
        ['SUMMARY', { label: 'Название заявки', id: 'SUMMARY' }]
    ]);

    for (const entry of issueDataEntries) {
        for (const [fieldId, fieldData] of Object.entries(entry.fields)) {
            if (!defaultFields.has(fieldId) && fieldData.label) {
                uniqueFields.set(fieldId, { label: fieldData.label, id: fieldId });
            }
        }
    }

    // --- Grouping and Sorting Logic ---
    const groups = {
        'Основные': Array.from(defaultFields.values()),
        'Пользователь': [],
        'Оборудование': [],
        'Локация': [],
        'Прочее': []
    };

    const groupKeywords = {
        'Пользователь': ['пользовател', 'сотрудник', 'telegram', 'имя', 'фамилия', 'отчество', 'должность', 'позиция', 'отдел', 'департамент', 'recruiter', 'руководител', 'наблюдатели'],
        'Оборудование': ['оборудован', 'техника', 'equipment', 'mac', 'озу', 'ram', 'процессор', 'cpu', 'хранилище', 'storage', 'диагональ', 'периферия', 'выкуп', 'увольнения'],
        'Локация': ['адрес', 'офис', 'гео', 'geo', 'город', 'страна', 'country']
    };

    uniqueFields.forEach(field => {
        const lowerCaseLabel = field.label.toLowerCase();
        let assigned = false;
        for (const groupName in groupKeywords) {
            if (groupKeywords[groupName].some(keyword => lowerCaseLabel.includes(keyword))) {
                groups[groupName].push(field);
                assigned = true;
                break;
            }
        }
        if (!assigned) {
            groups['Прочее'].push(field);
        }
    });

    // Sort fields within each group alphabetically by label
    for (const groupName in groups) {
        groups[groupName].sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    }

    const fieldsContainer = document.getElementById('availableFields');
    fieldsContainer.innerHTML = ''; // Clear existing fields

    for (const groupName in groups) {
        const groupFields = groups[groupName];
        if (groupFields.length > 0) {
            const groupHeader = document.createElement('h4');
            groupHeader.className = 'field-group-header';
            groupHeader.textContent = groupName;
            fieldsContainer.appendChild(groupHeader);

            const groupContainer = document.createElement('div');
            groupContainer.className = 'field-group-container';
            
            groupFields.forEach(field => {
                const pill = document.createElement('div');
                pill.className = 'field-pill';
                pill.textContent = field.label;
                pill.title = `Плейсхолдер: {{${field.id}}}`;
                pill.draggable = true;
                pill.dataset.placeholder = `{{${field.id}}}`;
                groupContainer.appendChild(pill);
            });
            fieldsContainer.appendChild(groupContainer);
        }
    }
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
        let { customStatuses } = await chrome.storage.local.get('customStatuses');
        // Если customStatuses не существует, используем стандартный набор
        if (!customStatuses) {
            customStatuses = [
                { id: 'red', name: 'Проблема', color: '#EF4444', isDefault: true },
                { id: 'yellow', name: 'В процессе', color: '#EAB308', isDefault: true },
                { id: 'purple', name: 'В фокусе', color: '#A855F7', isDefault: true },
                { id: 'green', name: 'Готово', color: '#22C55E', isDefault: true }
            ];
        }
        const filtered = customStatuses.filter(s => s.id !== statusId);
        await chrome.storage.local.set({ customStatuses: filtered });
        await loadCustomStatuses();
      }
    }
  });

  // Toggle issue details
  document.getElementById('issues-table-body').addEventListener('click', (e) => {
    const mainRow = e.target.closest('.main-row');
    if (!mainRow) return;

    const detailsId = mainRow.dataset.detailsId;
    const detailsRow = document.getElementById(detailsId);
    if (detailsRow) {
        mainRow.classList.toggle('expanded');
        detailsRow.classList.toggle('visible');
    }
  });
  
  // Delete all issues
  document.getElementById('deleteAllIssuesBtn').addEventListener('click', async () => {
      if (confirm('Вы уверены, что хотите удалить данные ВСЕХ карточек? Это действие нельзя отменить.')) {
          const allData = await chrome.storage.local.get(null);
          const keysToDelete = Object.keys(allData).filter(key => key.startsWith('issuedata_'));
          await chrome.storage.local.remove(keysToDelete);
          await loadIssueDataList();
      }
  });

  // Export all issues
  document.getElementById('exportAllIssuesBtn').addEventListener('click', async () => {
    try {
        const allData = await chrome.storage.local.get(null);
        const issueDataEntries = Object.entries(allData).filter(([key]) => key.startsWith('issuedata_'));

        if (issueDataEntries.length === 0) {
            alert('Нет данных для экспорта.');
            return;
        }

        const exportData = issueDataEntries.map(([key, data]) => data);

        const jsonContent = JSON.stringify(exportData, null, 2);
        
        const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `jira-issues-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

    } catch (error) {
        console.error('Export error:', error);
        alert('Произошла ошибка при экспорте данных.');
    }
  });

  // --- Template Logic ---
  document.getElementById('saveTemplateBtn').addEventListener('click', () => {
    const template = document.getElementById('copypasteTemplate').value;
    chrome.storage.local.set({ copypasteTemplate: template }, () => {
      // Optional: show a confirmation message
      const btn = document.getElementById('saveTemplateBtn');
      const originalText = btn.textContent;
      btn.textContent = 'Сохранено!';
      btn.classList.add('btn-success');
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('btn-success');
      }, 2000);
    });
  });

  document.getElementById('previewTemplateBtn').addEventListener('click', async () => {
    const template = document.getElementById('copypasteTemplate').value;
    const previewBox = document.getElementById('templatePreviewBox');
    const previewContent = document.getElementById('templatePreviewContent');
    previewBox.style.display = 'block'; // Показываем блок превью сразу

    try {
        // 1. Получаем все данные из хранилища
        const allData = await chrome.storage.local.get(null);
        const issueDataEntries = Object.values(allData).filter(
            (value) => value && value.issueKey && value.fields && value.extractedAt
        );

        if (issueDataEntries.length === 0) {
            previewContent.textContent = 'Нет сохраненных данных по задачам для предпросмотра. Откройте любую задачу в Jira, чтобы расширение сохранило данные.';
            return;
        }

        // 2. Находим самую последнюю запись по дате extractedAt
        issueDataEntries.sort((a, b) => new Date(b.extractedAt) - new Date(a.extractedAt));
        const latestIssueData = issueDataEntries[0];
        
        console.log(`Using data from the latest issue for preview: ${latestIssueData.issueKey} (extracted at ${latestIssueData.extractedAt})`);

        // 3. Собираем все поля для подстановки
        const replacementData = {
            ...latestIssueData.fields, // Все поля из объекта fields
            issueKey: { value: latestIssueData.issueKey } // Добавляем issueKey
        };

        let filledTemplate = template;

        // 4. Заменяем все плейсхолдеры
        for (const key in replacementData) {
            const placeholder = new RegExp(`{{${key}}}`, 'g');
            const value = replacementData[key]?.value || '';
            filledTemplate = filledTemplate.replace(placeholder, value);
        }
        
        // Заменяем старые плейсхолдеры для обратной совместимости
        filledTemplate = filledTemplate
            .replace(/{{TASK_ID}}/g, latestIssueData.issueKey || '')
            .replace(/{{USER_NAME}}/g, latestIssueData.fields?.customfield_10989?.value || '')
            .replace(/{{EQUIPMENT}}/g, latestIssueData.fields?.customfield_11122?.value || '')
            .replace(/{{ADDRESS}}/g, latestIssueData.fields?.customfield_11120?.value || '');


        previewContent.textContent = filledTemplate;

    } catch (error) {
        console.error("Error generating preview from local data:", error);
        previewContent.textContent = `Произошла ошибка при генерации предпросмотра: ${error.message}`;
    }
  });

  // --- Template Drag and Drop Logic ---
  const availableFieldsContainer = document.getElementById('availableFields');
  const templateTextarea = document.getElementById('copypasteTemplate');

  availableFieldsContainer.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('field-pill')) {
      e.dataTransfer.setData('text/plain', e.target.dataset.placeholder);
      e.target.style.opacity = '0.5';
    }
  });

  availableFieldsContainer.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('field-pill')) {
      e.target.style.opacity = '1';
    }
  });

  templateTextarea.addEventListener('dragover', (e) => {
    e.preventDefault();
    templateTextarea.classList.add('drag-over');
  });

  templateTextarea.addEventListener('dragleave', () => {
    templateTextarea.classList.remove('drag-over');
  });

  templateTextarea.addEventListener('drop', (e) => {
    e.preventDefault();
    templateTextarea.classList.remove('drag-over');
    const placeholder = e.dataTransfer.getData('text/plain');
    const start = templateTextarea.selectionStart;
    const end = templateTextarea.selectionEnd;
    const text = templateTextarea.value;
    templateTextarea.value = text.substring(0, start) + placeholder + text.substring(end);
    templateTextarea.focus();
    templateTextarea.selectionEnd = start + placeholder.length;
  });
}

