// Синхронизация с Supabase для командной работы
// Храним только: ID задачи, текст заметки, статус, кто/когда создал/изменил

class SupabaseSync {
  constructor() {
    this.supabase = null;
    this.currentTeamId = null;
    this.realtimeChannel = null;
    this.syncQueue = [];
    this.isSyncing = false;
    this.isOnline = navigator.onLine;
    
    // Настройки синхронизации
    this.config = {
      autoSync: true,
      syncInterval: 30000, // 30 секунд
      retryAttempts: 3,
      retryDelay: 5000
    };
    
    // Слушаем изменения онлайн статуса
    window.addEventListener('online', () => {
      this.isOnline = true;
      console.log('🌐 Online - starting sync');
      this.processSyncQueue();
    });
    
    window.addEventListener('offline', () => {
      this.isOnline = false;
      console.log('📴 Offline - queuing changes');
    });
  }

  // ========== Инициализация ==========

  async init(supabaseUrl, supabaseKey) {
    try {
      // Создаем клиент Supabase
      this.supabase = supabase.createClient(supabaseUrl, supabaseKey, {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false
        }
      });

      // Пытаемся восстановить сессию
      const { data: { session } } = await this.supabase.auth.getSession();
      
      if (session) {
        console.log('✅ Supabase session restored');
        await this.loadTeamId();
        await this.setupRealtimeSubscription();
        
        // Запускаем периодическую синхронизацию
        if (this.config.autoSync) {
          this.startAutoSync();
        }
        
        return { success: true, user: session.user };
      }
      
      return { success: false, error: 'No active session' };
    } catch (error) {
      console.error('❌ Failed to initialize Supabase:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== Аутентификация ==========

  async signUp(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      console.log('✅ User registered:', data.user.email);
      return { success: true, user: data.user };
    } catch (error) {
      console.error('❌ Sign up failed:', error);
      return { success: false, error: error.message };
    }
  }

  async signIn(email, password) {
    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      console.log('✅ User signed in:', data.user.email);
      
      // Загружаем ID команды пользователя
      await this.loadTeamId();
      
      // Подписываемся на real-time обновления
      await this.setupRealtimeSubscription();
      
      // Запускаем автосинхронизацию
      if (this.config.autoSync) {
        this.startAutoSync();
      }

      return { success: true, user: data.user };
    } catch (error) {
      console.error('❌ Sign in failed:', error);
      return { success: false, error: error.message };
    }
  }

  async signOut() {
    try {
      // Отписываемся от real-time
      if (this.realtimeChannel) {
        await this.supabase.removeChannel(this.realtimeChannel);
      }
      
      // Останавливаем автосинхронизацию
      this.stopAutoSync();
      
      // Выходим
      const { error } = await this.supabase.auth.signOut();
      if (error) throw error;

      this.currentTeamId = null;
      console.log('✅ User signed out');
      return { success: true };
    } catch (error) {
      console.error('❌ Sign out failed:', error);
      return { success: false, error: error.message };
    }
  }

  async getCurrentUser() {
    try {
      const { data: { user } } = await this.supabase.auth.getUser();
      return user;
    } catch (error) {
      console.error('❌ Failed to get user:', error);
      return null;
    }
  }

  // ========== Команды ==========

  async createTeam(teamName) {
    try {
      const user = await this.getCurrentUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await this.supabase
        .from('teams')
        .insert([{
          name: teamName,
          created_by: user.id
        }])
        .select()
        .single();

      if (error) throw error;

      // Добавляем создателя как админа команды
      await this.supabase
        .from('team_members')
        .insert([{
          team_id: data.id,
          user_id: user.id,
          role: 'admin'
        }]);

      this.currentTeamId = data.id;
      await chrome.storage.local.set({ current_team_id: data.id });

      console.log('✅ Team created:', data.name);
      return { success: true, team: data };
    } catch (error) {
      console.error('❌ Failed to create team:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return { success: false, error: error.message || error.toString() };
    }
  }

  async joinTeam(teamId) {
    try {
      const user = await this.getCurrentUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await this.supabase
        .from('team_members')
        .insert([{
          team_id: teamId,
          user_id: user.id,
          role: 'member'
        }]);

      if (error) throw error;

      this.currentTeamId = teamId;
      await chrome.storage.local.set({ current_team_id: teamId });

      console.log('✅ Joined team:', teamId);
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to join team:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return { success: false, error: error.message || error.toString() };
    }
  }

  async getMyTeams() {
    try {
      const user = await this.getCurrentUser();
      if (!user) throw new Error('User not authenticated');

      const { data, error } = await this.supabase
        .from('team_members')
        .select(`
          team_id,
          role,
          joined_at,
          teams (
            id,
            name,
            created_at
          )
        `)
        .eq('user_id', user.id);

      if (error) throw error;

      return { success: true, teams: data };
    } catch (error) {
      console.error('❌ Failed to get teams:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      return { success: false, error: error.message || error.toString() };
    }
  }

  async getTeamMembers(teamId) {
    try {
      const { data, error } = await this.supabase
        .from('team_members')
        .select('user_id, role, joined_at')
        .eq('team_id', teamId || this.currentTeamId);

      if (error) throw error;

      console.log('👥 Team members loaded:', data?.length || 0);
      return { success: true, members: data || [] };
    } catch (error) {
      console.error('❌ Failed to get team members:', error);
      return { success: false, error: error.message, members: [] };
    }
  }

  async loadTeamId() {
    const result = await chrome.storage.local.get('current_team_id');
    if (result.current_team_id) {
      this.currentTeamId = result.current_team_id;
      console.log('📁 Loaded team ID:', this.currentTeamId);
    } else {
      // Загружаем первую команду пользователя
      const { success, teams } = await this.getMyTeams();
      if (success && teams.length > 0) {
        this.currentTeamId = teams[0].teams.id;
        await chrome.storage.local.set({ current_team_id: this.currentTeamId });
      }
    }
  }

  async switchTeam(teamId) {
    this.currentTeamId = teamId;
    await chrome.storage.local.set({ current_team_id: teamId });
    
    // Переподписываемся на real-time
    await this.setupRealtimeSubscription();
    
    console.log('🔄 Switched to team:', teamId);
  }

  // ========== Синхронизация заметок ==========

  async saveNote(issueKey, text) {
    if (!this.currentTeamId) {
      console.warn('⚠️ No team selected, saving locally only');
      return { success: false, error: 'No team selected' };
    }

    const noteData = {
      issue_key: issueKey,
      team_id: this.currentTeamId,
      text: text
    };

    if (this.isOnline) {
      try {
        const { data, error } = await this.supabase
          .from('notes')
          .upsert(noteData, {
            onConflict: 'team_id,issue_key'
          })
          .select()
          .single();

        if (error) throw error;

        console.log('💾 Note synced:', issueKey);
        
        // Добавляем в audit log
        await this.logAction(issueKey, 'note_updated', null, text);
        
        return { success: true, data };
      } catch (error) {
        console.error('❌ Failed to sync note:', error);
        // Добавляем в очередь
        this.addToSyncQueue('note', noteData);
        return { success: false, error: error.message };
      }
    } else {
      // Оффлайн - добавляем в очередь
      this.addToSyncQueue('note', noteData);
      return { success: false, error: 'Offline - queued for sync' };
    }
  }

  async getNote(issueKey) {
    if (!this.currentTeamId) return null;

    try {
      const { data, error } = await this.supabase
        .from('notes')
        .select('*')
        .eq('team_id', this.currentTeamId)
        .eq('issue_key', issueKey)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Заметка не найдена
          return null;
        }
        throw error;
      }

      return data;
    } catch (error) {
      console.error('❌ Failed to get note:', error);
      return null;
    }
  }

  async getAllNotes() {
    if (!this.currentTeamId) return [];

    try {
      const { data, error } = await this.supabase
        .from('notes')
        .select('*')
        .eq('team_id', this.currentTeamId)
        .order('updated_at', { ascending: false });

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('❌ Failed to get notes:', error);
      return [];
    }
  }

  async deleteNote(issueKey) {
    if (!this.currentTeamId) return { success: false };

    try {
      const { error } = await this.supabase
        .from('notes')
        .delete()
        .eq('team_id', this.currentTeamId)
        .eq('issue_key', issueKey);

      if (error) throw error;

      console.log('🗑️ Note deleted:', issueKey);
      await this.logAction(issueKey, 'note_deleted', null, null);
      
      return { success: true };
    } catch (error) {
      console.error('❌ Failed to delete note:', error);
      return { success: false, error: error.message };
    }
  }

  // ========== Синхронизация статусов ==========

  async saveStatus(issueKey, statusId) {
    if (!this.currentTeamId) {
      console.warn('⚠️ No team selected, saving locally only');
      return { success: false, error: 'No team selected' };
    }

    const statusData = {
      issue_key: issueKey,
      team_id: this.currentTeamId,
      status_id: statusId
    };

    if (this.isOnline) {
      try {
        const { data, error } = await this.supabase
          .from('issue_statuses')
          .upsert(statusData, {
            onConflict: 'team_id,issue_key'
          })
          .select()
          .single();

        if (error) throw error;

        console.log('💾 Status synced:', issueKey, statusId);
        await this.logAction(issueKey, 'status_changed', null, statusId);
        
        return { success: true, data };
      } catch (error) {
        console.error('❌ Failed to sync status:', error);
        this.addToSyncQueue('status', statusData);
        return { success: false, error: error.message };
      }
    } else {
      this.addToSyncQueue('status', statusData);
      return { success: false, error: 'Offline - queued for sync' };
    }
  }

  async getStatus(issueKey) {
    if (!this.currentTeamId) return null;

    try {
      const { data, error } = await this.supabase
        .from('issue_statuses')
        .select('*')
        .eq('team_id', this.currentTeamId)
        .eq('issue_key', issueKey)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return null;
        throw error;
      }

      return data;
    } catch (error) {
      console.error('❌ Failed to get status:', error);
      return null;
    }
  }

  async getAllStatuses() {
    if (!this.currentTeamId) return [];

    try {
      const { data, error } = await this.supabase
        .from('issue_statuses')
        .select('*')
        .eq('team_id', this.currentTeamId);

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('❌ Failed to get statuses:', error);
      return [];
    }
  }

  // ========== Real-time обновления ==========

  async setupRealtimeSubscription() {
    if (!this.currentTeamId || !this.supabase) return;

    // Отписываемся от старого канала
    if (this.realtimeChannel) {
      await this.supabase.removeChannel(this.realtimeChannel);
    }

    // Подписываемся на изменения в заметках и статусах команды
    this.realtimeChannel = this.supabase
      .channel(`team_${this.currentTeamId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notes',
          filter: `team_id=eq.${this.currentTeamId}`
        },
        (payload) => this.handleNoteChange(payload)
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'issue_statuses',
          filter: `team_id=eq.${this.currentTeamId}`
        },
        (payload) => this.handleStatusChange(payload)
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('🔔 Subscribed to real-time updates');
        }
      });
  }

  handleNoteChange(payload) {
    console.log('📨 Real-time note update:', payload);
    
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    // Отправляем событие для обновления UI
    window.dispatchEvent(new CustomEvent('note-updated', {
      detail: {
        eventType,
        issueKey: newRecord?.issue_key || oldRecord?.issue_key,
        data: newRecord
      }
    }));
  }

  handleStatusChange(payload) {
    console.log('📨 Real-time status update:', payload);
    
    const { eventType, new: newRecord, old: oldRecord } = payload;
    
    window.dispatchEvent(new CustomEvent('status-updated', {
      detail: {
        eventType,
        issueKey: newRecord?.issue_key || oldRecord?.issue_key,
        data: newRecord
      }
    }));
  }

  // ========== Очередь синхронизации (для оффлайн режима) ==========

  addToSyncQueue(type, data) {
    this.syncQueue.push({
      type,
      data,
      timestamp: Date.now(),
      attempts: 0
    });
    
    console.log('📥 Added to sync queue:', type, data.issue_key);
    
    // Сохраняем очередь в chrome.storage
    chrome.storage.local.set({ sync_queue: this.syncQueue });
  }

  async loadSyncQueue() {
    const result = await chrome.storage.local.get('sync_queue');
    if (result.sync_queue) {
      this.syncQueue = result.sync_queue;
      console.log('📂 Loaded sync queue:', this.syncQueue.length, 'items');
    }
  }

  async processSyncQueue() {
    if (this.isSyncing || !this.isOnline || this.syncQueue.length === 0) {
      return;
    }

    this.isSyncing = true;
    console.log('🔄 Processing sync queue:', this.syncQueue.length, 'items');

    const failedItems = [];

    for (const item of this.syncQueue) {
      try {
        if (item.type === 'note') {
          await this.supabase
            .from('notes')
            .upsert(item.data, { onConflict: 'team_id,issue_key' });
        } else if (item.type === 'status') {
          await this.supabase
            .from('issue_statuses')
            .upsert(item.data, { onConflict: 'team_id,issue_key' });
        }
        
        console.log('✅ Synced queued item:', item.type, item.data.issue_key);
      } catch (error) {
        console.error('❌ Failed to sync item:', error);
        item.attempts++;
        
        if (item.attempts < this.config.retryAttempts) {
          failedItems.push(item);
        } else {
          console.error('❌ Max retry attempts reached, dropping item:', item);
        }
      }
    }

    this.syncQueue = failedItems;
    await chrome.storage.local.set({ sync_queue: this.syncQueue });

    this.isSyncing = false;
    console.log('✅ Sync queue processed');
  }

  // ========== Автосинхронизация ==========

  startAutoSync() {
    this.autoSyncInterval = setInterval(() => {
      this.processSyncQueue();
    }, this.config.syncInterval);
    
    console.log('🔄 Auto-sync started');
  }

  stopAutoSync() {
    if (this.autoSyncInterval) {
      clearInterval(this.autoSyncInterval);
      this.autoSyncInterval = null;
      console.log('⏸️ Auto-sync stopped');
    }
  }

  // ========== Audit Log ==========

  async logAction(issueKey, actionType, oldValue, newValue) {
    if (!this.currentTeamId) return;

    try {
      const user = await this.getCurrentUser();
      
      await this.supabase
        .from('audit_log')
        .insert([{
          issue_key: issueKey,
          team_id: this.currentTeamId,
          action_type: actionType,
          user_id: user?.id,
          user_email: user?.email,
          old_value: oldValue,
          new_value: newValue
        }]);
    } catch (error) {
      console.error('❌ Failed to log action:', error);
    }
  }

  async getAuditLog(issueKey, limit = 20) {
    if (!this.currentTeamId) return [];

    try {
      const { data, error } = await this.supabase
        .from('audit_log')
        .select('*')
        .eq('team_id', this.currentTeamId)
        .eq('issue_key', issueKey)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('❌ Failed to get audit log:', error);
      return [];
    }
  }

  // ========== Утилиты ==========

  isAuthenticated() {
    return this.supabase && this.getCurrentUser() !== null;
  }

  hasTeam() {
    return this.currentTeamId !== null;
  }

  async getStats() {
    if (!this.currentTeamId) return null;

    try {
      const [notesCount, statusesCount, membersCount] = await Promise.all([
        this.supabase
          .from('notes')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', this.currentTeamId),
        this.supabase
          .from('issue_statuses')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', this.currentTeamId),
        this.supabase
          .from('team_members')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', this.currentTeamId)
      ]);

      return {
        notes: notesCount.count,
        statuses: statusesCount.count,
        members: membersCount.count,
        queuedItems: this.syncQueue.length
      };
    } catch (error) {
      console.error('❌ Failed to get stats:', error);
      return null;
    }
  }
}

// Экспорт для использования в других файлах
if (typeof window !== 'undefined') {
  window.SupabaseSync = SupabaseSync;
}
