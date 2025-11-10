// Popup скрипт для управления заметками

document.addEventListener('DOMContentLoaded', async () => {
  await updateStats();
  setupEventListeners();
});

// Обновление статистики
async function updateStats() {
  try {
    const data = await chrome.storage.local.get(null);
    const notes = Object.entries(data).filter(([key]) => key.startsWith('note_'));
    const tags = Object.entries(data).filter(([key]) => key.startsWith('tag_'));
    
    document.getElementById('totalNotes').textContent = notes.length;
    
    // Подсчет использованной памяти
    const dataString = JSON.stringify(data);
    const sizeInBytes = new Blob([dataString]).size;
    const sizeInKB = (sizeInBytes / 1024).toFixed(2);
    
    document.getElementById('storageUsed').textContent = `${sizeInKB} KB`;
  } catch (error) {
    console.error('Error updating stats:', error);
  }
}

// Настройка обработчиков событий
function setupEventListeners() {
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('exportBtn').addEventListener('click', exportNotes);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importNotes);
  document.getElementById('clearBtn').addEventListener('click', clearAllNotes);
}

// Открыть страницу настроек
function openSettings() {
  chrome.tabs.create({
    url: chrome.runtime.getURL('settings.html')
  });
}

// Экспорт заметок в JSON
async function exportNotes() {
  try {
    const data = await chrome.storage.local.get(null);
    const notes = {};
    const tags = {};

    Object.entries(data).forEach(([key, value]) => {
      if (key.startsWith('note_')) {
        const issueKey = key.replace('note_', '');
        notes[issueKey] = value;
      } else if (key.startsWith('tag_')) {
        const issueKey = key.replace('tag_', '');
        tags[issueKey] = value;
      }
    });

    const exportData = {
      version: '2.0.0',
      exportDate: new Date().toISOString(),
      notes: notes,
      tags: tags
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { 
      type: 'application/json' 
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jira-notes-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    showStatus('Заметки экспортированы!', 'success');
  } catch (error) {
    console.error('Export error:', error);
    showStatus('Ошибка экспорта', 'error');
  }
}

// Импорт заметок из JSON
async function importNotes(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const text = await file.text();
    const importData = JSON.parse(text);

    if (!importData.notes) {
      throw new Error('Invalid file format');
    }

    // Подготавливаем данные для импорта
    const dataToImport = {};
    
    // Импортируем заметки
    Object.entries(importData.notes).forEach(([issueKey, note]) => {
      dataToImport[`note_${issueKey}`] = note;
    });

    // Импортируем метки (если есть)
    if (importData.tags) {
      Object.entries(importData.tags).forEach(([issueKey, tag]) => {
        dataToImport[`tag_${issueKey}`] = tag;
      });
    }
    // Совместимость со старыми маркерами
    if (importData.markers) {
      Object.entries(importData.markers).forEach(([issueKey, marker]) => {
        dataToImport[`tag_${issueKey}`] = { tag: marker, color: 'blue' };
      });
    }

    // Спрашиваем подтверждение
    const notesCount = Object.keys(importData.notes).length;
    const tagsCount = (importData.tags ? Object.keys(importData.tags).length : 0) + 
                     (importData.markers ? Object.keys(importData.markers).length : 0);
    
    const confirmed = confirm(
      `Импортировать ${notesCount} заметок и ${tagsCount} меток?\n\n` +
      'Существующие данные будут перезаписаны.'
    );

    if (!confirmed) return;

    await chrome.storage.local.set(dataToImport);
    await updateStats();
    
    showStatus('Заметки импортированы!', 'success');
  } catch (error) {
    console.error('Import error:', error);
    showStatus('Import error. Check file format.', 'error');
  }

  // Сбрасываем input
  event.target.value = '';
}

// Очистка всех заметок, статусов, адресов, кодов и кеша
async function clearAllNotes() {
  const confirmed = confirm(
    'Вы уверены, что хотите удалить ВСЕ данные?\n\n' +
    '• Все заметки\n' +
    '• Все статусы\n' +
    '• Все адреса и коды офисов\n' +
    '• Весь кеш\n\n' +
    'Маппинг офисов (code.json) будет сохранен.\n\n' +
    'Это действие нельзя отменить!'
  );

  if (!confirmed) return;

  try {
    const data = await chrome.storage.local.get(null);
    
    // Удаляем ВСЁ кроме настроек расширения и кастомных статусов
    const keysToRemove = Object.keys(data).filter(key => 
      key.startsWith('note_') ||      // Заметки
      key.startsWith('tag_') ||        // Метки (старое)
      key.startsWith('status_') ||     // Статусы
      key.startsWith('address_') ||    // Адреса
      key.startsWith('code_') ||       // Коды офисов
      key === 'panel_position'         // Позиция панели
    );
    
    console.log(`🗑️ Clearing ${keysToRemove.length} items from storage:`, {
      notes: keysToRemove.filter(k => k.startsWith('note_')).length,
      tags: keysToRemove.filter(k => k.startsWith('tag_')).length,
      statuses: keysToRemove.filter(k => k.startsWith('status_')).length,
      addresses: keysToRemove.filter(k => k.startsWith('address_')).length,
      codes: keysToRemove.filter(k => k.startsWith('code_')).length,
      other: keysToRemove.filter(k => !k.startsWith('note_') && !k.startsWith('tag_') && 
             !k.startsWith('status_') && !k.startsWith('address_') && !k.startsWith('code_')).length
    });
    
    await chrome.storage.local.remove(keysToRemove);
    await updateStats();
    
    showStatus(`Удалено ${keysToRemove.length} записей. Настройки сохранены.`, 'success');
  } catch (error) {
    console.error('Clear error:', error);
    showStatus('Ошибка удаления', 'error');
  }
}

// Показать статус операции
function showStatus(message, type) {
  const statusEl = document.getElementById('status');
  statusEl.textContent = message;
  statusEl.className = type;
  statusEl.style.display = 'block';

  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 3000);
}
