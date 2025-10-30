// Sync Service - Сервис синхронизации между пользователями
import { firebaseConfig } from './firebase-config.js';

class SyncService {
  constructor() {
    this.db = null;
    this.teamId = null;
    this.userId = null;
    this.userName = null;
    this.userColor = null;
    this.isOnline = false;
    this.listeners = [];
    this.isInitialized = false;
  }

  // Инициализация Firebase
  async init(teamId, userEmail, userName, userColor) {
    if (this.isInitialized) {
      console.log('🔄 Sync already initialized');
      return true;
    }

    try {
      console.log('🔥 Initializing Firebase sync...');
      
      this.teamId = teamId;
      this.userId = userEmail;
      this.userName = userName || userEmail.split('@')[0];
      this.userColor = userColor || '#667eea';

      // Загружаем Firebase SDK из CDN
      await this.loadFirebaseSDK();

      // Инициализируем Firebase
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      
      this.db = firebase.database();
      this.isOnline = true;
      this.isInitialized = true;

      // Регистрируем пользователя в команде
      await this.registerUser();

      console.log('✅ Firebase sync initialized');
      return true;
    } catch (error) {
      console.error('❌ Firebase init error:', error);
      this.isOnline = false;
      return false;
    }
  }

  // Загрузка Firebase SDK
  async loadFirebaseSDK() {
    return new Promise((resolve, reject) => {
      if (typeof firebase !== 'undefined') {
        resolve();
        return;
      }

      // Firebase App
      const appScript = document.createElement('script');
      appScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
      appScript.onload = () => {
        // Firebase Database
        const dbScript = document.createElement('script');
        dbScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-database-compat.js';
        dbScript.onload = () => resolve();
        dbScript.onerror = () => reject(new Error('Failed to load Firebase Database'));
        document.head.appendChild(dbScript);
      };
      appScript.onerror = () => reject(new Error('Failed to load Firebase App'));
      document.head.appendChild(appScript);
    });
  }

  // Регистрация пользователя в команде
  async registerUser() {
    if (!this.db || !this.teamId || !this.userId) return;

    const userRef = this.db.ref(`teams/${this.teamId}/members/${this.userId}`);
    await userRef.set({
      name: this.userName,
      color: this.userColor,
      lastSeen: firebase.database.ServerValue.TIMESTAMP
    });

    console.log(`👤 User registered: ${this.userName} (${this.userColor})`);
  }

  // Сохранение заметки (синхронизированное)
  async saveNote(issueKey, noteData) {
    if (!this.isOnline || !this.db) {
      console.log('📴 Offline mode - saving locally');
      return this.saveLocal(issueKey, noteData);
    }

    try {
      const noteRef = this.db.ref(`teams/${this.teamId}/notes/${issueKey}`);
      
      const data = {
        text: noteData.text || '',
        status: noteData.status || null,
        address: noteData.address || null,
        lastModified: firebase.database.ServerValue.TIMESTAMP,
        lastModifiedBy: this.userId,
        lastModifiedByName: this.userName,
        lastModifiedByColor: this.userColor
      };

      await noteRef.set(data);
      console.log(`💾 Synced note for ${issueKey}`);
      
      // Также сохраняем локально для оффлайн доступа
      await this.saveLocal(issueKey, noteData);
      
      return true;
    } catch (error) {
      console.error('❌ Sync error:', error);
      return this.saveLocal(issueKey, noteData);
    }
  }

  // Сохранение локально (fallback)
  async saveLocal(issueKey, noteData) {
    const keys = {};
    
    if (noteData.text !== undefined) {
      keys[`note_${issueKey}`] = noteData.text;
    }
    if (noteData.status !== undefined) {
      keys[`status_${issueKey}`] = noteData.status;
    }
    if (noteData.address !== undefined) {
      keys[`address_${issueKey}`] = noteData.address;
    }

    await chrome.storage.local.set(keys);
    return true;
  }

  // Подписка на изменения заметок
  subscribeToChanges(callback) {
    if (!this.isOnline || !this.db) {
      console.log('📴 Cannot subscribe - offline mode');
      return null;
    }

    const notesRef = this.db.ref(`teams/${this.teamId}/notes`);
    
    const listener = notesRef.on('value', (snapshot) => {
      const notes = snapshot.val() || {};
      console.log('🔄 Received sync update:', Object.keys(notes).length, 'notes');
      callback(notes);
    });

    this.listeners.push({ ref: notesRef, listener });
    
    return listener;
  }

  // Подписка на изменения конкретной заметки
  subscribeToNote(issueKey, callback) {
    if (!this.isOnline || !this.db) {
      console.log('📴 Cannot subscribe - offline mode');
      return null;
    }

    const noteRef = this.db.ref(`teams/${this.teamId}/notes/${issueKey}`);
    
    const listener = noteRef.on('value', (snapshot) => {
      const note = snapshot.val();
      if (note) {
        console.log(`🔄 Note updated: ${issueKey}`, note);
        callback(issueKey, note);
      }
    });

    this.listeners.push({ ref: noteRef, listener });
    
    return listener;
  }

  // Получение информации о последнем редакторе
  async getLastModifiedInfo(issueKey) {
    if (!this.isOnline || !this.db) {
      return null;
    }

    try {
      const noteRef = this.db.ref(`teams/${this.teamId}/notes/${issueKey}`);
      const snapshot = await noteRef.once('value');
      const note = snapshot.val();
      
      if (note) {
        return {
          userName: note.lastModifiedByName || 'Unknown',
          userColor: note.lastModifiedByColor || '#666',
          timestamp: note.lastModified,
          userId: note.lastModifiedBy
        };
      }
      
      return null;
    } catch (error) {
      console.error('❌ Error getting last modified info:', error);
      return null;
    }
  }

  // Получение всех участников команды
  async getTeamMembers() {
    if (!this.isOnline || !this.db) {
      return [];
    }

    try {
      const membersRef = this.db.ref(`teams/${this.teamId}/members`);
      const snapshot = await membersRef.once('value');
      const members = snapshot.val() || {};
      
      return Object.entries(members).map(([email, data]) => ({
        email,
        name: data.name,
        color: data.color,
        lastSeen: data.lastSeen
      }));
    } catch (error) {
      console.error('❌ Error getting team members:', error);
      return [];
    }
  }

  // Отключение синхронизации
  disconnect() {
    if (this.listeners.length > 0) {
      this.listeners.forEach(({ ref, listener }) => {
        ref.off('value', listener);
      });
      this.listeners = [];
    }
    
    this.isOnline = false;
    this.isInitialized = false;
    console.log('🔌 Sync disconnected');
  }

  // Проверка статуса синхронизации
  getStatus() {
    return {
      isOnline: this.isOnline,
      isInitialized: this.isInitialized,
      teamId: this.teamId,
      userId: this.userId,
      userName: this.userName,
      userColor: this.userColor
    };
  }

  // Загрузка всех заметок команды
  async loadAllTeamNotes() {
    if (!this.isOnline || !this.db) {
      console.log('📴 Cannot load - offline mode');
      return {};
    }

    try {
      const notesRef = this.db.ref(`teams/${this.teamId}/notes`);
      const snapshot = await notesRef.once('value');
      const notes = snapshot.val() || {};
      
      console.log(`📥 Loaded ${Object.keys(notes).length} team notes`);
      
      // Сохраняем локально для оффлайн доступа
      for (const [issueKey, noteData] of Object.entries(notes)) {
        await this.saveLocal(issueKey, noteData);
      }
      
      return notes;
    } catch (error) {
      console.error('❌ Error loading team notes:', error);
      return {};
    }
  }

  // Миграция локальных заметок в командные
  async migrateLocalToTeam() {
    if (!this.isOnline || !this.db) {
      console.log('📴 Cannot migrate - offline mode');
      return false;
    }

    try {
      console.log('🔄 Migrating local notes to team...');
      
      const localStorage = await chrome.storage.local.get(null);
      const notes = {};

      // Собираем все заметки по ключам задач
      for (const [key, value] of Object.entries(localStorage)) {
        if (key.startsWith('note_') || key.startsWith('status_') || key.startsWith('address_')) {
          const [type, issueKey] = key.split('_', 2);
          
          if (!notes[issueKey]) {
            notes[issueKey] = {};
          }
          
          notes[issueKey][type] = value;
        }
      }

      // Загружаем каждую заметку в Firebase
      let migrated = 0;
      for (const [issueKey, noteData] of Object.entries(notes)) {
        await this.saveNote(issueKey, {
          text: noteData.note || '',
          status: noteData.status || null,
          address: noteData.address || null
        });
        migrated++;
      }

      console.log(`✅ Migrated ${migrated} notes to team`);
      return true;
    } catch (error) {
      console.error('❌ Migration error:', error);
      return false;
    }
  }
}

// Экспортируем singleton
export const syncService = new SyncService();
