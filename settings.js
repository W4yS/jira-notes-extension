// Settings Page Logic v2 - GitHub Style

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize UI and load data
  await loadSettings();
  setupEventListeners();
  
  // Initial UI state
  const syncMode = document.querySelector('input[name="syncMode"]:checked')?.value || 'personal';
  updateModeUI(syncMode);
  updateStatusPreview();
});

// --- Data Loading ---

async function loadSettings() {
  const settings = await chrome.storage.local.get([
    'syncMode', 'teamId', 'userEmail', 'userName', 'userColor', 'customStatuses', 'officeDetectionEnabled', 'smartFieldConfig'
  ]);

  // Sync Mode
  const syncMode = settings.syncMode || 'personal';
  const modeInput = document.querySelector(`input[name="syncMode"][value="${syncMode}"]`);
  if (modeInput) modeInput.checked = true;

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
  
  // Load Field Priorities
  if (settings.smartFieldConfig) {
    loadFieldPriorities(settings.smartFieldConfig);
  }
}

function loadFieldPriorities(config) {
  for (const [category, data] of Object.entries(config)) {
    const list = document.getElementById(`${category}Priority`);
    if (!list || !data.priority) continue;

    const currentItems = Array.from(list.querySelectorAll('.field-priority-item'));
    const itemMap = new Map(currentItems.map(item => [item.dataset.field, item]));
    
    // Clear list
    list.innerHTML = '';
    
    // Add items in saved order
    data.priority.forEach(fieldId => {
      const item = itemMap.get(fieldId);
      if (item) {
        list.appendChild(item);
        itemMap.delete(fieldId);
      }
    });
    
    // Add any remaining items (newly added fields since save)
    itemMap.forEach(item => list.appendChild(item));
    
    updatePriorityNumbers(list);
  }
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
        tableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--color-fg-muted);">Нет сохраненных данных по карточкам.</td></tr>`;
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

// --- UI Update Functions ---

function updateModeUI(mode) {
  const syncSettings = document.getElementById('syncSettings');
  if (syncSettings) {
    syncSettings.style.display = mode === 'team' ? 'block' : 'none';
  }
}

function updateStatusPreview() {
  const name = document.getElementById('newStatusName').value || 'Имя статуса';
  const emoji = document.getElementById('newStatusEmoji').value;
  const color = document.getElementById('newStatusColor').value;

  document.getElementById('previewName').textContent = name;
  document.getElementById('previewEmoji').textContent = emoji;
  document.getElementById('previewDot').style.backgroundColor = color;
}

function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast show ${type}`; // type can be 'success' or 'error' (add css for error if needed)
  
  setTimeout(() => {
    toast.className = toast.className.replace('show', '');
  }, 3000);
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
      showToast('Настройки сохранены');
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
      showToast('Настройки подключения сохранены');
      // Add connection logic here
  });

  // Status creation form
  ['newStatusName', 'newStatusEmoji', 'newStatusColor'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateStatusPreview);
  });

  document.getElementById('addStatusBtn').addEventListener('click', async () => {
    const name = document.getElementById('newStatusName').value.trim();
    if (!name) {
        showToast('Название статуса не может быть пустым', 'error');
        return;
    }

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
    
    // Reset form
    document.getElementById('newStatusName').value = '';
    document.getElementById('newStatusEmoji').value = '';
    updateStatusPreview();
    showToast('Статус добавлен');
  });
  
  // Reset statuses
  document.getElementById('resetDefaultsBtn').addEventListener('click', async () => {
      if (confirm('Вы уверены, что хотите сбросить статусы к стандартным? Все ваши созданные статусы будут удалены.')) {
          await chrome.storage.local.remove('customStatuses');
          await loadCustomStatuses();
          showToast('Статусы сброшены');
      }
  });

  // Delete all statuses
  document.getElementById('deleteAllStatusesBtn').addEventListener('click', async () => {
      if (confirm('Вы уверены, что хотите удалить ВСЕ статусы?')) {
          await chrome.storage.local.set({ customStatuses: [] });
          await loadCustomStatuses();
          showToast('Все статусы удалены');
      }
  });

  // Delete status
  document.getElementById('statusesList').addEventListener('click', async (e) => {
    if (e.target.matches('.btn-danger')) {
      const statusId = e.target.dataset.id;
      if (confirm('Удалить этот статус?')) {
        let { customStatuses } = await chrome.storage.local.get('customStatuses');
        if (!customStatuses) {
            // If no custom statuses saved yet, but user sees defaults, we need to init them first
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
        showToast('Статус удален');
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
          showToast('Данные очищены');
      }
  });

  // Export all issues
  document.getElementById('exportAllIssuesBtn').addEventListener('click', async () => {
    try {
        const allData = await chrome.storage.local.get(null);
        const issueDataEntries = Object.entries(allData).filter(([key]) => key.startsWith('issuedata_'));

        if (issueDataEntries.length === 0) {
            showToast('Нет данных для экспорта', 'error');
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
        showToast('Экспорт завершен');

    } catch (error) {
        console.error('Export error:', error);
        showToast('Ошибка при экспорте', 'error');
    }
  });

  // --- Template Logic ---
  
  // Save Template Button
  document.getElementById('saveTemplateBtn').addEventListener('click', () => {
    const template = document.getElementById('copypasteTemplate').value;
    chrome.storage.local.set({ copypasteTemplate: template }, () => {
      showToast('Шаблон сохранен');
    });
  });

  // Insert Placeholder Button
  document.getElementById('insertPlaceholderBtn').addEventListener('click', () => {
    const textarea = document.getElementById('copypasteTemplate');
    const placeholders = [
      '{{ФИО}}', 
      '{{АДРЕС}}', 
      '{{ТЕЛЕГРАМ}}', 
      '{{ТЕЛЕФОН}}', 
      '{{ОБОРУДОВАНИЕ}}', 
      '{{ПЕРИФЕРИЯ}}', 
      '{{СОДЕРЖАНИЕ}}'
    ];
    
    // Remove old menu if exists
    const oldMenu = document.querySelector('.placeholder-menu');
    if (oldMenu) oldMenu.remove();

    // Create menu
    const menu = document.createElement('div');
    menu.className = 'placeholder-menu';

    placeholders.forEach(ph => {
      const item = document.createElement('div');
      item.className = 'placeholder-menu-item';
      item.textContent = ph;
      item.addEventListener('click', () => {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        textarea.value = text.substring(0, start) + ph + text.substring(end);
        textarea.focus();
        textarea.selectionEnd = start + ph.length;
        menu.remove();
      });
      menu.appendChild(item);
    });
    
    // Position near button
    const btn = document.getElementById('insertPlaceholderBtn');
    const rect = btn.getBoundingClientRect();
    // Simple positioning, can be improved
    menu.style.position = 'absolute';
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + window.scrollY + 4}px`;
    menu.style.zIndex = '1000';
    
    document.body.appendChild(menu);
    
    // Close on outside click
    setTimeout(() => {
      const closeHandler = (e) => {
        if (!menu.contains(e.target) && e.target !== btn) {
          menu.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);
  });

  // Load Example Button
  document.getElementById('loadExampleBtn').addEventListener('click', () => {
    const exampleTemplate = `
Добрый день.
                
Меня зовут {{ФИО}}, я системный администратор.

Я получил запрос на отправку тебе корпоративной персональной техники. В заказе указано: {{ОБОРУДОВАНИЕ}}{{ПЕРИФЕРИЯ}}

Отправка будет осуществляться транспортной компанией СДЭК.  Подскажи, пожалуйста, верно ли указан адрес для доставки: {{АДРЕС}} / {{ТЕЛЕФОН}} ?
    `;
    
    document.getElementById('copypasteTemplate').value = exampleTemplate;
    showToast('Пример загружен');
  });

  // Clear Template Button
  document.getElementById('clearTemplateBtn').addEventListener('click', () => {
    if (confirm('Вы уверены, что хотите очистить шаблон?')) {
      document.getElementById('copypasteTemplate').value = '';
      showToast('Шаблон очищен');
    }
  });
  
  // --- Smart Field Priorities ---
  
  // Initialize drag and drop for field priorities
  const categories = ['fullname', 'address', 'telegram', 'phone', 'equipment', 'peripherals', 'description'];
  categories.forEach(category => {
    const list = document.getElementById(`${category}Priority`);
    if (!list) return;
    
    setupPriorityDragAndDrop(list);
  });
  
  // Save field priorities button
  document.getElementById('saveFieldPrioritiesBtn')?.addEventListener('click', async () => {
    const config = {};
    
    categories.forEach(category => {
      const list = document.getElementById(`${category}Priority`);
      if (!list) return;
      
      const items = list.querySelectorAll('.field-priority-item');
      config[category] = {
        priority: Array.from(items).map(item => item.dataset.field)
      };
    });
    
    await chrome.storage.local.set({ smartFieldConfig: config });
    showToast('Приоритеты полей сохранены');
  });
  
  // Reset field priorities button
  document.getElementById('resetFieldPrioritiesBtn')?.addEventListener('click', async () => {
    if (confirm('Вы уверены, что хотите сбросить приоритеты полей к стандартным?')) {
      await chrome.storage.local.remove('smartFieldConfig');
      location.reload(); // Reload to reset UI
    }
  });
}

// --- Helper Functions ---

function setupPriorityDragAndDrop(listElement) {
  let draggedElement = null;
  
  listElement.addEventListener('dragstart', (e) => {
    if (e.target.classList.contains('field-priority-item')) {
      draggedElement = e.target;
      e.target.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    }
  });
  
  listElement.addEventListener('dragend', (e) => {
    if (e.target.classList.contains('field-priority-item')) {
      e.target.classList.remove('dragging');
    }
  });
  
  listElement.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    const afterElement = getDragAfterElement(listElement, e.clientY);
    if (afterElement == null) {
      listElement.appendChild(draggedElement);
    } else {
      listElement.insertBefore(draggedElement, afterElement);
    }
    
    // Update priority numbers
    updatePriorityNumbers(listElement);
  });
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.field-priority-item:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function updatePriorityNumbers(listElement) {
  const items = listElement.querySelectorAll('.field-priority-item');
  items.forEach((item, index) => {
    const numberEl = item.querySelector('.priority-number');
    if (numberEl) {
      numberEl.textContent = index + 1;
    }
  });
}
