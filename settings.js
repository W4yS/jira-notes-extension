// Settings Page Logic v2 - GitHub Style + Supabase Auth

let syncManager = null; // Instance of SupabaseSync

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Supabase sync
  await initializeSupabaseSync();
  
  // Initialize UI and load data
  await loadSettings();
  setupEventListeners();
  
  // Initial UI state
  const syncMode = document.querySelector('input[name="syncMode"]:checked')?.value || 'personal';
  updateModeUI(syncMode);
  updateStatusPreview();
});

// === Supabase Initialization ===

async function initializeSupabaseSync() {
  try {
    // Load config
    const response = await fetch(chrome.runtime.getURL('config.json'));
    
    if (!response.ok) {
      console.log('ℹ️ config.json not found - Supabase sync disabled');
      return;
    }
    
    const config = await response.json();
    
    if (!config.supabaseUrl || !config.supabaseKey) {
      console.log('ℹ️ Supabase not configured in config.json');
      return;
    }

    // Create sync manager instance
    syncManager = new SupabaseSync();
    const result = await syncManager.init(config.supabaseUrl, config.supabaseKey);
    
    if (result.success) {
      console.log('✅ Supabase initialized:', result.user.email);
      await updateAuthUI(true, result.user);
      await checkTeamStatus();
      await updateSyncStats();
    } else {
      console.log('ℹ️ Not authenticated');
      await updateAuthUI(false);
    }
  } catch (error) {
    console.log('ℹ️ Supabase sync not available:', error.message);
    // Не показываем ошибку пользователю - это нормально, если Supabase не настроен
  }
}

async function updateAuthUI(isAuthenticated, user = null) {
  const notAuthSection = document.getElementById('notAuthenticatedSection');
  const authSection = document.getElementById('authenticatedSection');
  const notAuthButtons = document.getElementById('notAuthenticatedButtons');
  const authButtons = document.getElementById('authenticatedButtons');
  const teamBox = document.getElementById('teamBox');
  const syncStatusBox = document.getElementById('syncStatusBox');
  
  // Проверяем существование элементов (на случай если в личном режиме)
  if (!notAuthSection || !authSection) return;
  
  if (isAuthenticated && user) {
    notAuthSection.style.display = 'none';
    authSection.style.display = 'block';
    if (notAuthButtons) notAuthButtons.style.display = 'none';
    if (authButtons) authButtons.style.display = 'flex';
    if (teamBox) teamBox.style.display = 'block';
    if (syncStatusBox) syncStatusBox.style.display = 'block';
    
    const emailDisplay = document.getElementById('userEmailDisplay');
    if (emailDisplay) emailDisplay.textContent = user.email;
  } else {
    notAuthSection.style.display = 'block';
    authSection.style.display = 'none';
    if (notAuthButtons) notAuthButtons.style.display = 'flex';
    if (authButtons) authButtons.style.display = 'none';
    if (teamBox) teamBox.style.display = 'none';
    if (syncStatusBox) syncStatusBox.style.display = 'none';
  }
}

async function checkTeamStatus() {
  if (!syncManager || !syncManager.hasTeam()) {
    showNoTeamUI();
    return;
  }
  
  try {
    // Load team info
    const { success, teams } = await syncManager.getMyTeams();
    if (success && teams.length > 0) {
      const teamData = teams[0].teams;
      await showTeamUI(teamData);
    } else {
      showNoTeamUI();
    }
  } catch (error) {
    console.error('Failed to check team status:', error);
    showNoTeamUI();
  }
}

function showNoTeamUI() {
  const noTeamSection = document.getElementById('noTeamSection');
  const hasTeamSection = document.getElementById('hasTeamSection');
  const noTeamButtons = document.getElementById('noTeamButtons');
  const hasTeamButtons = document.getElementById('hasTeamButtons');
  
  if (!noTeamSection) return;
  
  noTeamSection.style.display = 'block';
  if (hasTeamSection) hasTeamSection.style.display = 'none';
  if (noTeamButtons) noTeamButtons.style.display = 'flex';
  if (hasTeamButtons) hasTeamButtons.style.display = 'none';
}

async function showTeamUI(team) {
  const noTeamSection = document.getElementById('noTeamSection');
  const hasTeamSection = document.getElementById('hasTeamSection');
  const noTeamButtons = document.getElementById('noTeamButtons');
  const hasTeamButtons = document.getElementById('hasTeamButtons');
  
  if (!hasTeamSection) return;
  
  if (noTeamSection) noTeamSection.style.display = 'none';
  hasTeamSection.style.display = 'block';
  if (noTeamButtons) noTeamButtons.style.display = 'none';
  if (hasTeamButtons) hasTeamButtons.style.display = 'flex';
  
  const teamNameEl = document.getElementById('currentTeamName');
  const teamIdEl = document.getElementById('currentTeamId');
  
  if (teamNameEl) teamNameEl.textContent = team.name;
  if (teamIdEl) teamIdEl.textContent = team.id;
  
  // Load team members
  await loadTeamMembers();
}

async function loadTeamMembers() {
  const membersList = document.getElementById('teamMembersList');
  if (!membersList || !syncManager) return;
  
  membersList.innerHTML = '<p class="note">Загрузка участников...</p>';
  
  try {
    const result = await syncManager.getTeamMembers();
    if (result.success && result.members.length > 0) {
      membersList.innerHTML = result.members.map(member => `
        <div class="member-item">
          <div class="member-info">
            <div class="member-avatar">👤</div>
            <span class="member-name">${member.user_id.substring(0, 8)}...</span>
          </div>
          <span class="member-role ${member.role}">${member.role}</span>
        </div>
      `).join('');
    } else {
      membersList.innerHTML = '<div class="member-item">Участников не найдено</div>';
    }
  } catch (error) {
    console.error('Failed to load members:', error);
    membersList.innerHTML = '<div class="member-item">Ошибка загрузки участников</div>';
  }
}

async function updateSyncStats() {
  if (!syncManager) return;
  
  try {
    const stats = await syncManager.getStats();
    if (stats) {
      const notesCount = document.getElementById('notesCount');
      const statusesCount = document.getElementById('statusesCount');
      const membersCount = document.getElementById('membersCount');
      const queueCount = document.getElementById('queueCount');
      
      if (notesCount) notesCount.textContent = stats.notes || 0;
      if (statusesCount) statusesCount.textContent = stats.statuses || 0;
      if (membersCount) membersCount.textContent = stats.members || 0;
      if (queueCount) queueCount.textContent = stats.queuedItems || 0;
      
      // Update status indicator
      const statusDot = document.getElementById('syncStatusDot');
      const statusText = document.getElementById('syncStatusText');
      const statusIndicator = document.getElementById('syncStatus');
      
      if (statusIndicator && statusText) {
        if (stats.queuedItems > 0) {
          statusIndicator.className = 'status-indicator syncing';
          statusText.textContent = `Синхронизация (${stats.queuedItems} в очереди)...`;
        } else {
          statusIndicator.className = 'status-indicator online';
          statusText.textContent = 'Синхронизировано';
        }
      }
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function showAuthMessage(message, type = 'info') {
  const msgEl = document.getElementById('authMessage');
  msgEl.textContent = message;
  msgEl.className = `auth-message ${type}`;
  msgEl.style.display = 'block';
  
  if (type === 'success') {
    setTimeout(() => {
      msgEl.style.display = 'none';
    }, 5000);
  }
}

// --- Data Loading ---

async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get([
      'syncMode', 'customStatuses', 'officeDetectionEnabled', 'smartFieldConfig', 'copypasteTemplate'
    ]);

    // Sync Mode
    const syncMode = settings.syncMode || 'personal';
    const modeInput = document.querySelector(`input[name="syncMode"][value="${syncMode}"]`);
    if (modeInput) modeInput.checked = true;

    // Office Detection
    const officeToggle = document.getElementById('officeDetectionToggle');
    if (officeToggle) {
      officeToggle.checked = settings.officeDetectionEnabled !== false;
    }

    // Custom Statuses
    await loadCustomStatuses();
    
    // Issue Data
    await loadIssueDataList();

    // Copypaste Template
    const templateTextarea = document.getElementById('copypasteTemplate');
    if (templateTextarea) {
      templateTextarea.value = settings.copypasteTemplate || '';
    }
    
    // Load Field Priorities
    if (settings.smartFieldConfig) {
      loadFieldPriorities(settings.smartFieldConfig);
    }
  } catch (error) {
    console.error('❌ Error loading settings:', error);
    showToast('Ошибка загрузки настроек: ' + error.message, 'error');
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
  // === Supabase Auth Events ===
  
  // Sign In
  document.getElementById('signInBtn').addEventListener('click', async () => {
    if (!syncManager) {
      showAuthMessage('Supabase не инициализирован. Проверьте config.json', 'error');
      return;
    }
    
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    
    if (!email || !password) {
      showAuthMessage('Заполните email и пароль', 'error');
      return;
    }
    
    const btn = document.getElementById('signInBtn');
    btn.disabled = true;
    btn.textContent = 'Вход...';
    
    try {
      const result = await syncManager.signIn(email, password);
      
      if (result.success) {
        showAuthMessage('Вход выполнен успешно!', 'success');
        await updateAuthUI(true, result.user);
        await checkTeamStatus();
        await updateSyncStats();
        
        // Clear fields
        document.getElementById('authEmail').value = '';
        document.getElementById('authPassword').value = '';
      } else {
        showAuthMessage('Ошибка входа: ' + result.error, 'error');
      }
    } catch (error) {
      showAuthMessage('Ошибка: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Войти';
    }
  });
  
  // Sign Up
  document.getElementById('signUpBtn').addEventListener('click', async () => {
    if (!syncManager) {
      showAuthMessage('Supabase не инициализирован. Проверьте config.json', 'error');
      return;
    }
    
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    
    if (!email || !password) {
      showAuthMessage('Заполните email и пароль', 'error');
      return;
    }
    
    if (password.length < 6) {
      showAuthMessage('Пароль должен быть не менее 6 символов', 'error');
      return;
    }
    
    const btn = document.getElementById('signUpBtn');
    btn.disabled = true;
    btn.textContent = 'Регистрация...';
    
    try {
      const result = await syncManager.signUp(email, password);
      
      if (result.success) {
        showAuthMessage('Регистрация успешна! Проверьте email для подтверждения.', 'success');
        // Clear fields
        document.getElementById('authEmail').value = '';
        document.getElementById('authPassword').value = '';
      } else {
        showAuthMessage('Ошибка регистрации: ' + result.error, 'error');
      }
    } catch (error) {
      showAuthMessage('Ошибка: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Зарегистрироваться';
    }
  });
  
  // Sign Out
  document.getElementById('signOutBtn').addEventListener('click', async () => {
    if (!syncManager) return;
    if (!confirm('Вы уверены, что хотите выйти?')) return;
    
    const result = await syncManager.signOut();
    if (result.success) {
      showAuthMessage('Вы вышли из аккаунта', 'info');
      await updateAuthUI(false);
    } else {
      showAuthMessage('Ошибка выхода: ' + result.error, 'error');
    }
  });
  
  // === Team Management Events ===
  
  // Create Team
  document.getElementById('createTeamBtn').addEventListener('click', async () => {
    if (!syncManager) {
      showToast('Необходимо войти в аккаунт', 'error');
      return;
    }
    
    const teamName = document.getElementById('newTeamName').value.trim();
    
    if (!teamName) {
      showToast('Введите название команды', 'error');
      return;
    }
    
    const btn = document.getElementById('createTeamBtn');
    btn.disabled = true;
    btn.textContent = 'Создание...';
    
    try {
      const result = await syncManager.createTeam(teamName);
      
      if (result.success) {
        showToast('Команда создана!');
        await checkTeamStatus();
        await updateSyncStats();
        document.getElementById('newTeamName').value = '';
      } else {
        showToast('Ошибка: ' + result.error, 'error');
      }
    } catch (error) {
      showToast('Ошибка: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Создать команду';
    }
  });
  
  // Join Team
  document.getElementById('joinTeamBtn').addEventListener('click', async () => {
    if (!syncManager) {
      showToast('Необходимо войти в аккаунт', 'error');
      return;
    }
    
    const teamId = document.getElementById('joinTeamId').value.trim();
    
    if (!teamId) {
      showToast('Введите Team ID', 'error');
      return;
    }
    
    const btn = document.getElementById('joinTeamBtn');
    btn.disabled = true;
    btn.textContent = 'Присоединение...';
    
    try {
      const result = await syncManager.joinTeam(teamId);
      
      if (result.success) {
        showToast('Вы присоединились к команде!');
        await checkTeamStatus();
        await updateSyncStats();
        // Перезагружаем страницу для обновления real-time подписки
        setTimeout(() => {
          window.location.reload();
        }, 1000);
        document.getElementById('joinTeamId').value = '';
      } else {
        showToast('Ошибка: ' + result.error, 'error');
      }
    } catch (error) {
      showToast('Ошибка: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Присоединиться';
    }
  });
  
  // Copy Team ID
  document.getElementById('copyTeamIdBtn').addEventListener('click', () => {
    const teamId = document.getElementById('currentTeamId').textContent;
    navigator.clipboard.writeText(teamId).then(() => {
      showToast('Team ID скопирован в буфер обмена');
    });
  });
  
  // Leave Team
  document.getElementById('leaveTeamBtn').addEventListener('click', async () => {
    if (!confirm('Вы уверены, что хотите покинуть команду? Все синхронизированные данные останутся доступны другим участникам.')) return;
    
    showToast('Функция выхода из команды будет добавлена позже', 'info');
    // TODO: Implement leave team
  });
  
  // === Sync Stats Events ===
  
  // Refresh Stats
  document.getElementById('refreshStatsBtn').addEventListener('click', async () => {
    await updateSyncStats();
    showToast('Статистика обновлена');
  });
  
  // Force Sync
  document.getElementById('forceSyncBtn').addEventListener('click', async () => {
    if (!syncManager) return;
    
    const btn = document.getElementById('forceSyncBtn');
    btn.disabled = true;
    btn.textContent = 'Синхронизация...';
    
    try {
      await syncManager.processSyncQueue();
      await updateSyncStats();
      showToast('Синхронизация завершена');
    } catch (error) {
      showToast('Ошибка синхронизации: ' + error.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Синхронизировать сейчас';
    }
  });
  
  // === Original Event Listeners ===
  
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
    radio.addEventListener('change', async (e) => {
        const mode = e.target.value;
        updateModeUI(mode);
        await chrome.storage.local.set({ syncMode: mode });
        
        if (mode === 'team') {
          // Initialize Supabase if not already
          if (!syncManager) {
            await initializeSupabaseSync();
          }
        }
    });
  });
  
  // Office detection toggle
  document.getElementById('officeDetectionToggle').addEventListener('change', (e) => {
      chrome.storage.local.set({ officeDetectionEnabled: e.target.checked });
      showToast('Настройки сохранены');
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
