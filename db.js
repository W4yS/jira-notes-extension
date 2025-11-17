// IndexedDB wrapper для хранения больших объемов данных
// Обходит лимит chrome.storage.local (5 МБ) и обеспечивает быстрый поиск

class JiraNotesDB {
  constructor() {
    this.db = null;
    this.dbName = 'JiraNotesDB';
    this.version = 1;
  }

  // Инициализация базы данных
  async init() {
    // Защита от повторной инициализации
    if (this.db) {
      console.log('✅ IndexedDB already initialized');
      return this.db;
    }
    
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('❌ Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        
        // Обработка неожиданного закрытия
        this.db.onversionchange = () => {
          this.db.close();
          console.warn('⚠️ Database version changed, closing connection');
        };
        
        this.db.onerror = (event) => {
          console.error('❌ Database error:', event.target.error);
        };
        
        console.log('✅ IndexedDB initialized');
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store для заметок
        if (!db.objectStoreNames.contains('notes')) {
          const notesStore = db.createObjectStore('notes', { keyPath: 'issueKey' });
          notesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          notesStore.createIndex('statusId', 'statusId', { unique: false });
          console.log('📝 Created notes store');
        }

        // Store для данных карточек (все поля из Jira)
        if (!db.objectStoreNames.contains('issueData')) {
          const dataStore = db.createObjectStore('issueData', { keyPath: 'issueKey' });
          dataStore.createIndex('extractedAt', 'extractedAt', { unique: false });
          dataStore.createIndex('deviceType', 'deviceType', { unique: false });
          console.log('📊 Created issueData store');
        }

        // Store для истории изменений
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id', autoIncrement: true });
          historyStore.createIndex('issueKey', 'issueKey', { unique: false });
          historyStore.createIndex('timestamp', 'timestamp', { unique: false });
          historyStore.createIndex('type', 'type', { unique: false });
          console.log('📜 Created history store');
        }
      };
    });
  }

  // === Notes Operations ===

  async saveNote(issueKey, data) {
    if (!issueKey || typeof issueKey !== 'string') {
      throw new Error('Invalid issueKey provided');
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['notes'], 'readwrite');
        const store = transaction.objectStore('notes');

        const noteData = {
          issueKey,
          text: data?.text || '',
          statusId: data?.statusId || null,
          updatedAt: Date.now()
        };

        const request = store.put(noteData);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getNote(issueKey) {
    if (!issueKey || typeof issueKey !== 'string') {
      throw new Error('Invalid issueKey provided');
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['notes'], 'readonly');
        const store = transaction.objectStore('notes');
        const request = store.get(issueKey);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getAllNotes() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNote(issueKey) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readwrite');
      const store = transaction.objectStore('notes');
      const request = store.delete(issueKey);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // Полнотекстовый поиск по заметкам
  async searchNotes(query) {
    const lowerQuery = query.toLowerCase();
    const allNotes = await this.getAllNotes();

    return allNotes.filter(note =>
      note.text?.toLowerCase().includes(lowerQuery) ||
      note.issueKey?.toLowerCase().includes(lowerQuery)
    );
  }

  // Получить заметки по статусу
  async getNotesByStatus(statusId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['notes'], 'readonly');
      const store = transaction.objectStore('notes');
      const index = store.index('statusId');
      const request = index.getAll(statusId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // === Issue Data Operations ===

  async saveIssueData(issueKey, data) {
    if (!issueKey || typeof issueKey !== 'string') {
      throw new Error('Invalid issueKey provided');
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['issueData'], 'readwrite');
        const store = transaction.objectStore('issueData');

        const issueData = {
          issueKey,
          fields: data?.fields || {},
          deviceType: data?.deviceType || null,
          extractedAt: Date.now()
        };

        const request = store.put(issueData);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getIssueData(issueKey) {
    if (!issueKey || typeof issueKey !== 'string') {
      throw new Error('Invalid issueKey provided');
    }
    if (!this.db) {
      throw new Error('Database not initialized');
    }
    
    return new Promise((resolve, reject) => {
      try {
        const transaction = this.db.transaction(['issueData'], 'readonly');
        const store = transaction.objectStore('issueData');
        const request = store.get(issueKey);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getAllIssueData() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['issueData'], 'readonly');
      const store = transaction.objectStore('issueData');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteIssueData(issueKey) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['issueData'], 'readwrite');
      const store = transaction.objectStore('issueData');
      const request = store.delete(issueKey);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async deleteAllIssueData() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['issueData'], 'readwrite');
      const store = transaction.objectStore('issueData');
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // === History Operations ===

  async addHistory(issueKey, type, oldValue, newValue) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['history'], 'readwrite');
      const store = transaction.objectStore('history');

      const historyEntry = {
        issueKey,
        type, // 'note', 'status', 'field'
        oldValue,
        newValue,
        timestamp: Date.now()
      };

      const request = store.add(historyEntry);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getHistory(issueKey, limit = 20) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['history'], 'readonly');
      const store = transaction.objectStore('history');
      const index = store.index('issueKey');
      const request = index.getAll(issueKey);

      request.onsuccess = () => {
        const results = request.result
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  // === Migration from chrome.storage ===

  async migrateFromChromeStorage() {
    console.log('🔄 Starting migration from chrome.storage to IndexedDB...');

    try {
      const allData = await chrome.storage.local.get(null);
      let migratedNotes = 0;
      let migratedIssueData = 0;
      const errors = [];

      // Migrate notes and statuses
      const noteKeys = Object.keys(allData).filter(key => key.startsWith('note_'));

      for (const noteKey of noteKeys) {
        try {
          const issueKey = noteKey.replace('note_', '');
          if (!issueKey) continue; // Skip invalid keys
          
          const statusKey = `status_${issueKey}`;

          const noteData = {
            text: allData[noteKey] || '',
            statusId: allData[statusKey] || null
          };

          await this.saveNote(issueKey, noteData);
          migratedNotes++;
        } catch (error) {
          errors.push({ key: noteKey, error: error.message });
          console.warn(`⚠️ Failed to migrate note ${noteKey}:`, error);
        }
      }

      // Migrate issue data
      const issueDataKeys = Object.keys(allData).filter(key => key.startsWith('issuedata_'));

      for (const dataKey of issueDataKeys) {
        try {
          const issueKey = dataKey.replace('issuedata_', '');
          if (!issueKey) continue; // Skip invalid keys
          
          const deviceTypeKey = `devicetype_${issueKey}`;

          const issueData = {
            fields: allData[dataKey]?.fields || {},
            deviceType: allData[deviceTypeKey] || null
          };

          await this.saveIssueData(issueKey, issueData);
          migratedIssueData++;
        } catch (error) {
          errors.push({ key: dataKey, error: error.message });
          console.warn(`⚠️ Failed to migrate issue data ${dataKey}:`, error);
        }
      }

      const result = { 
        notes: migratedNotes, 
        issueData: migratedIssueData,
        errors: errors.length 
      };
      
      console.log(`✅ Migration complete: ${migratedNotes} notes, ${migratedIssueData} issue data entries`);
      if (errors.length > 0) {
        console.warn(`⚠️ ${errors.length} items failed to migrate:`, errors);
      }
      
      return result;

    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  // === Utility Methods ===

  async getStats() {
    const notes = await this.getAllNotes();
    const issueData = await this.getAllIssueData();

    return {
      totalNotes: notes.length,
      totalIssueData: issueData.length,
      notesWithStatus: notes.filter(n => n.statusId).length,
      estimatedSize: this.estimateSize({ notes, issueData })
    };
  }

  estimateSize(data) {
    const jsonString = JSON.stringify(data);
    const sizeInBytes = new Blob([jsonString]).size;
    const sizeInKB = (sizeInBytes / 1024).toFixed(2);
    const sizeInMB = (sizeInBytes / (1024 * 1024)).toFixed(2);

    return { bytes: sizeInBytes, kb: sizeInKB, mb: sizeInMB };
  }

  // Закрыть соединение
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('🔒 IndexedDB connection closed');
    }
  }
}

// Экспорт для использования в других файлах
if (typeof module !== 'undefined' && module.exports) {
  module.exports = JiraNotesDB;
}
