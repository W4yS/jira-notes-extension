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
  document.getElementById('exportBtn').addEventListener('click', exportNotes);
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', importNotes);
  document.getElementById('clearBtn').addEventListener('click', clearAllNotes);
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

// Очистка всех заметок
async function clearAllNotes() {
  const confirmed = confirm(
    'Вы уверены, что хотите удалить ВСЕ заметки и метки?\n\n' +
    'Это действие нельзя отменить!'
  );

  if (!confirmed) return;

  try {
    const data = await chrome.storage.local.get(null);
    const keysToRemove = Object.keys(data).filter(key => 
      key.startsWith('note_') || key.startsWith('tag_')
    );
    
    await chrome.storage.local.remove(keysToRemove);
    await updateStats();
    
    showStatus('Все данные удалены', 'success');
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
