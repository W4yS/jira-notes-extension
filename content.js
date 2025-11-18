// Главный скрипт расширения для добавления заметок к задачам Jira

// === Performance Utilities ===

// Memoization для дорогих вычислений
class Memoizer {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  memoize(fn) {
    return (...args) => {
      const key = JSON.stringify(args);
      
      if (this.cache.has(key)) {
        return this.cache.get(key);
      }
      
      const result = fn(...args);
      
      // LRU eviction
      if (this.cache.size >= this.maxSize) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      
      this.cache.set(key, result);
      return result;
    };
  }
  
  clear() {
    this.cache.clear();
  }
}

// Улучшенный debounce с leading edge
function debounceLeading(func, wait, options = {}) {
  let timeout, result;
  const { leading = true, trailing = true, maxWait = null } = options;
  let lastCallTime = 0;
  let lastInvokeTime = 0;
  
  function invokeFunc(time) {
    lastInvokeTime = time;
    result = func();
    return result;
  }
  
  function shouldInvoke(time) {
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    
    return (
      lastCallTime === 0 ||
      timeSinceLastCall >= wait ||
      (maxWait !== null && timeSinceLastInvoke >= maxWait)
    );
  }
  
  function debounced() {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);
    
    lastCallTime = time;
    
    if (isInvoking && leading) {
      if (lastInvokeTime === 0) {
        lastInvokeTime = time;
        result = func();
      }
    }
    
    clearTimeout(timeout);
    
    if (trailing) {
      timeout = setTimeout(() => {
        const currentTime = Date.now();
        if (shouldInvoke(currentTime)) {
          invokeFunc(currentTime);
        }
      }, wait);
    }
    
    return result;
  }
  
  debounced.cancel = function() {
    clearTimeout(timeout);
    lastCallTime = 0;
    lastInvokeTime = 0;
  };
  
  return debounced;
}

// RAF Batcher для оптимизации DOM операций
class RAFBatcher {
  constructor() {
    this.readCallbacks = [];
    this.writeCallbacks = [];
    this.scheduled = false;
  }
  
  scheduleRead(callback) {
    this.readCallbacks.push(callback);
    this.schedule();
  }
  
  scheduleWrite(callback) {
    this.writeCallbacks.push(callback);
    this.schedule();
  }
  
  schedule() {
    if (this.scheduled) return;
    
    this.scheduled = true;
    requestAnimationFrame(() => this.flush());
  }
  
  flush() {
    // Phase 1: All reads (measure)
    const reads = this.readCallbacks.slice();
    this.readCallbacks = [];
    reads.forEach(callback => callback());
    
    // Phase 2: All writes (mutate)
    const writes = this.writeCallbacks.slice();
    this.writeCallbacks = [];
    writes.forEach(callback => callback());
    
    this.scheduled = false;
  }
}

// === Main Extension Class ===

class JiraNotesExtension {
  constructor() {
    this.currentIssueKey = null;
    this.notesContainer = null;
    this.initialized = false;
    this.isUpdating = false; // Флаг для предотвращения множественных обновлений
    this._updateInProgress = false; // Защита от race conditions
    this.officeDetectionEnabled = true; // По умолчанию включено
    
    // Performance utilities
    this.memoizer = new Memoizer(500);
    this.rafBatcher = new RAFBatcher();
    
    // IndexedDB for large data storage
    this.db = new JiraNotesDB();
    this.dbInitialized = false;
    
    // Lazy loading observer for images
    this.lazyImageObserver = null;
    
    // Кеш для оптимизации производительности
    this.statusCache = {}; // { issueKey: status }
    this.addressCache = {}; // { issueKey: address }
    this.codeCache = {}; // { issueKey: code } - кодировки офисов (ХЗ, Гоголь, и т.д.)
    this.deviceTypeCache = {}; // { issueKey: 'apple' | 'windows' }
    this.processedCards = new Set(); // Карточки, которые уже обработаны
    this.lastUpdateTime = 0; // Время последнего обновления
    this.statusesMetadata = {}; // Кеш метаданных статусов { statusId: { name, color, emoji } }
    this.contextInvalidatedShown = false; // Флаг для показа уведомления о перезагрузке
    
    // Таблица соответствий адресов и кодов (загружается из code.json)
    this.addressMapping = {
      codes: [],
      addresses: [],
      normalizedAddresses: [] // НОВОЕ: кеш нормализованных адресов
    };
    
    // Загружаем маппинг и настройки при инициализации
    this.loadSettings();
    this.loadAddressMapping();
  }
  
  // Загрузка настроек расширения
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get('officeDetectionEnabled');
      this.officeDetectionEnabled = result.officeDetectionEnabled !== false; // по умолчанию true
      console.log('⚙️ Office detection:', this.officeDetectionEnabled ? 'enabled' : 'disabled');
    } catch (error) {
      console.error('❌ Failed to load settings:', error);
      this.officeDetectionEnabled = true; // fallback на включенное состояние
    }
  }
  
  // Загрузка таблицы соответствий из code.json
  async loadAddressMapping() {
    try {
      const response = await fetch(chrome.runtime.getURL('code.json'));
      const data = await response.json();
      
      this.addressMapping = {
        codes: data.code || [],
        addresses: data.addresses || [],
        normalizedAddresses: [] // Предвычислим нормализованные адреса
      };
      
      // ОПТИМИЗАЦИЯ: Предвычисляем нормализованные адреса ОДИН РАЗ
      this.addressMapping.normalizedAddresses = this.addressMapping.addresses.map(
        addr => this.normalizeAddress(addr)
      );
      
      console.log('📋 Address mapping loaded:', this.addressMapping.codes.length, 'codes (normalized cache ready)');
    } catch (error) {
      console.error('❌ Failed to load address mapping:', error);
      // Fallback на пустые массивы
      this.addressMapping = { codes: [], addresses: [], normalizedAddresses: [] };
    }
  }

  // ОПТИМИЗАЦИЯ: Быстрое сравнение объектов (без JSON.stringify)
  compareObjects(obj1, obj2) {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    
    if (keys1.length !== keys2.length) return false;
    
    for (const key of keys1) {
      if (obj1[key] !== obj2[key]) return false;
    }
    
    return true;
  }

  // Получение метаданных статуса (с кешированием)
  async getStatusData(statusId) {
    if (!statusId) return { name: 'Без статуса', color: '#9ca3af', emoji: '' };
    
    // Если в кеше есть - возвращаем
    if (this.statusesMetadata[statusId]) {
      return this.statusesMetadata[statusId];
    }
    
    // Загружаем из storage
    const result = await chrome.storage.local.get('customStatuses');
    const statuses = result.customStatuses || [
      { id: 'red', name: 'Проблема', color: '#EF4444' },
      { id: 'yellow', name: 'В процессе', color: '#EAB308' },
      { id: 'purple', name: 'В фокусе', color: '#A855F7' },
      { id: 'green', name: 'Готово', color: '#22C55E' }
    ];
    
    // Заполняем кеш
    statuses.forEach(s => {
      this.statusesMetadata[s.id] = { name: s.name, color: s.color, emoji: s.emoji };
    });
    
    return this.statusesMetadata[statusId] || { name: 'Неизвестно', color: '#9ca3af', emoji: '' };
  }

  // Инициализация расширения
  init() {
    if (this.initialized) return;
    
    console.log('Jira Personal Notes: Initializing...');
    this.initialized = true;
    
    // Ждем загрузки страницы
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.start());
    } else {
      this.start();
    }
  }

  // Запуск основной логики
  async start() {
    // ОЧИЩАЕМ ВСЕ СТАРЫЕ ЭЛЕМЕНТЫ при инициализации расширения
    this.cleanupOldElements();
    
    // Initialize IndexedDB
    try {
      await this.db.init();
      this.dbInitialized = true;
      console.log('💾 IndexedDB initialized');
      
      // Check if migration needed
      const stats = await this.db.getStats();
      if (stats.totalNotes === 0 && stats.totalIssueData === 0) {
        console.log('🔄 Checking for chrome.storage data to migrate...');
        const chromeData = await chrome.storage.local.get(null);
        const hasOldData = Object.keys(chromeData).some(key => 
          key.startsWith('note_') || key.startsWith('issuedata_')
        );
        
        if (hasOldData) {
          console.log('🔄 Migrating data from chrome.storage to IndexedDB...');
          const result = await this.db.migrateFromChromeStorage();
          console.log(`✅ Migrated ${result.notes} notes, ${result.issueData} issue data`);
        }
      }
    } catch (error) {
      console.error('❌ Failed to initialize IndexedDB:', error);
      console.log('⚠️ Falling back to chrome.storage');
      this.dbInitialized = false;
    }
    
    // Setup lazy loading for images
    this.setupLazyLoading();
    
    // Работаем только в локальном режиме
    console.log('💾 Using local storage mode');
    
    await this.loadStatusesMetadata(); // Загружаем метаданные статусов
    this.detectIssueKey();
    this.injectNotesPanel();
    this.setupObserver();
    this.setupSettingsListener(); // Слушаем изменения настроек
  }
  
  // Слушатель изменений настроек
  setupSettingsListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.officeDetectionEnabled) {
        const newValue = changes.officeDetectionEnabled.newValue;
        console.log('⚙️ Office detection setting changed:', newValue);
        this.officeDetectionEnabled = newValue;
        
        // Перерисовываем карточки
        this.updateAllCards();
      }
    });
  }

  // Загрузка метаданных статусов в кеш
  async loadStatusesMetadata() {
    const result = await chrome.storage.local.get('customStatuses');
    const statuses = result.customStatuses || [
      { id: 'red', name: 'Проблема', color: '#EF4444' },
      { id: 'yellow', name: 'В процессе', color: '#EAB308' },
      { id: 'purple', name: 'В фокусе', color: '#A855F7' },
      { id: 'green', name: 'Готово', color: '#22C55E' }
    ];
    
    statuses.forEach(s => {
      this.statusesMetadata[s.id] = { name: s.name, color: s.color, emoji: s.emoji };
    });
    
    console.log('📊 Loaded status metadata:', Object.keys(this.statusesMetadata).length, 'statuses');
  }

  // Очистка старых элементов расширения (при перезагрузке)
  cleanupOldElements() {
    console.log('🧹 Cleaning up old elements...');
    
    // Удаляем все старые панели заметок
    document.querySelectorAll('[data-jira-notes-panel="true"]').forEach(el => {
      console.log('Removing old notes panel:', el);
      el.remove();
    });
    
    // Удаляем все старые статусы, адреса, коды и иконки устройств
    document.querySelectorAll('.jira-personal-status').forEach(el => {
      console.log('Removing old status:', el);
      el.remove();
    });
    document.querySelectorAll('.jira-personal-address-inline').forEach(el => {
      console.log('Removing old address:', el);
      el.remove();
    });
    document.querySelectorAll('.jira-personal-code-inline').forEach(el => {
      console.log('Removing old code:', el);
      el.remove();
    });
    document.querySelectorAll('.jira-device-icon').forEach(el => {
      console.log('Removing old device icon:', el);
      el.remove();
    });
    
    // Сбрасываем флаги обработки
    document.querySelectorAll('[data-jira-processed]').forEach(card => {
      card.removeAttribute('data-jira-processed');
    });
    
    console.log('✅ Cleanup complete');
  }
  
  // Setup lazy loading for images
  setupLazyLoading() {
    if ('IntersectionObserver' in window) {
      this.lazyImageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            const src = img.dataset.src;
            if (src) {
              img.src = src;
              img.removeAttribute('data-src');
              this.lazyImageObserver.unobserve(img);
            }
          }
        });
      }, {
        rootMargin: '50px' // Load 50px before entering viewport
      });
      console.log('🖼️ Lazy loading observer initialized');
    } else {
      console.log('⚠️ IntersectionObserver not available, lazy loading disabled');
    }
  }
  
  // Add image to lazy loading
  lazyLoadImage(img) {
    if (this.lazyImageObserver && img.dataset.src) {
      this.lazyImageObserver.observe(img);
    } else if (img.dataset.src) {
      // Fallback if no IntersectionObserver
      img.src = img.dataset.src;
      img.removeAttribute('data-src');
    }
  }
  
  // ========== Data Access Layer (IndexedDB with chrome.storage fallback) ==========
  
  async getNote(issueKey) {
    try {
      if (this.dbInitialized) {
        const noteData = await this.db.getNote(issueKey);
        return noteData?.text || '';
      }
      // Fallback to chrome.storage
      const result = await chrome.storage.local.get(`note_${issueKey}`);
      return result[`note_${issueKey}`] || '';
    } catch (error) {
      console.error('❌ Error getting note:', error);
      // Fallback to chrome.storage on error
      try {
        const result = await chrome.storage.local.get(`note_${issueKey}`);
        return result[`note_${issueKey}`] || '';
      } catch (fallbackError) {
        console.error('❌ Fallback also failed:', fallbackError);
        return '';
      }
    }
  }
  
  async saveNote(issueKey, noteText) {
    try {
      if (this.dbInitialized) {
        await this.db.saveNote(issueKey, { text: noteText });
      } else {
        await chrome.storage.local.set({ [`note_${issueKey}`]: noteText });
      }
    } catch (error) {
      console.error('❌ Error saving note:', error);
      // Fallback to chrome.storage on error
      try {
        await chrome.storage.local.set({ [`note_${issueKey}`]: noteText });
        console.log('✅ Note saved to chrome.storage as fallback');
      } catch (fallbackError) {
        console.error('❌ Fallback save also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }
  
  async getIssueData(issueKey) {
    try {
      if (this.dbInitialized) {
        return await this.db.getIssueData(issueKey);
      }
      // Fallback to chrome.storage
      const result = await chrome.storage.local.get(`issuedata_${issueKey}`);
      return result[`issuedata_${issueKey}`] || null;
    } catch (error) {
      console.error('❌ Error getting issue data:', error);
      try {
        const result = await chrome.storage.local.get(`issuedata_${issueKey}`);
        return result[`issuedata_${issueKey}`] || null;
      } catch (fallbackError) {
        console.error('❌ Fallback also failed:', fallbackError);
        return null;
      }
    }
  }
  
  async saveIssueData(issueKey, data) {
    try {
      if (this.dbInitialized) {
        await this.db.saveIssueData(issueKey, data);
      } else {
        await chrome.storage.local.set({ [`issuedata_${issueKey}`]: data });
      }
    } catch (error) {
      console.error('❌ Error saving issue data:', error);
      try {
        await chrome.storage.local.set({ [`issuedata_${issueKey}`]: data });
        console.log('✅ Issue data saved to chrome.storage as fallback');
      } catch (fallbackError) {
        console.error('❌ Fallback save also failed:', fallbackError);
        throw fallbackError;
      }
    }
  }
  
  async getStatus(issueKey) {
    const data = await this.getIssueData(issueKey);
    return data?.status || null;
  }
  
  async saveStatus(issueKey, statusId) {
    const data = await this.getIssueData(issueKey) || {};
    data.status = statusId;
    await this.saveIssueData(issueKey, data);
  }
  
  async getAddress(issueKey) {
    const data = await this.getIssueData(issueKey);
    return data?.address || null;
  }
  
  async saveAddress(issueKey, address) {
    const data = await this.getIssueData(issueKey) || {};
    data.address = address;
    await this.saveIssueData(issueKey, data);
  }
  
  async getCode(issueKey) {
    const data = await this.getIssueData(issueKey);
    return data?.code || null;
  }
  
  async saveCode(issueKey, code) {
    const data = await this.getIssueData(issueKey) || {};
    data.code = code;
    await this.saveIssueData(issueKey, data);
  }
  
  async getDeviceType(issueKey) {
    const data = await this.getIssueData(issueKey);
    return data?.deviceType || null;
  }
  
  async saveDeviceType(issueKey, deviceType) {
    const data = await this.getIssueData(issueKey) || {};
    data.deviceType = deviceType;
    await this.saveIssueData(issueKey, data);
  }

  // Определяем ключ текущей задачи
  detectIssueKey() {
    // Пробуем получить из URL параметра selectedIssue
    const urlParams = new URLSearchParams(window.location.search);
    const selectedIssue = urlParams.get('selectedIssue');
    if (selectedIssue && selectedIssue.match(/^[A-Z]+-\d+$/)) {
      this.currentIssueKey = selectedIssue;
      console.log('Detected issue key from URL param:', this.currentIssueKey);
      return;
    }

    // Пробуем получить из URL path для старого формата
    const urlMatch = window.location.href.match(/\/browse\/([A-Z]+-\d+)/);
    if (urlMatch) {
      this.currentIssueKey = urlMatch[1];
      console.log('Detected issue key from URL path:', this.currentIssueKey);
      return;
    }

    // Пробуем найти в DOM
    const issueKeyElement = document.querySelector('[data-testid="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]') ||
                           document.querySelector('[data-issue-key]') ||
                           document.querySelector('#key-val') ||
                           document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"]');
    
    if (issueKeyElement) {
      const key = issueKeyElement.getAttribute('data-issue-key') || 
                  issueKeyElement.textContent.trim().match(/[A-Z]+-\d+/)?.[0];
      if (key) {
        this.currentIssueKey = key;
        console.log('Detected issue key from DOM:', this.currentIssueKey);
      }
    }
  }

  // Ожидаем загрузку модального окна Jira
  waitForJiraModal() {
    return new Promise((resolve) => {
      const checkModal = () => {
        // Ищем признаки того, что боковая панель загрузилась
        const modal = document.querySelector('[role="dialog"]') || 
                     document.querySelector('[data-testid*="issue"]') ||
                     document.querySelector('.issue-view');
        
        if (modal) {
          console.log('✅ Jira modal detected, waiting 500ms more...');
          setTimeout(resolve, 500); // Даем еще полсекунды на стабилизацию
        } else {
          console.log('⏳ Waiting for Jira modal...');
          setTimeout(checkModal, 200); // Проверяем каждые 200мс
        }
      };
      checkModal();
    });
  }

  // Вставляем панель с заметками
  async injectNotesPanel() {
    if (!this.currentIssueKey) {
      console.log('❌ No issue key detected, retrying...');
      setTimeout(() => this.injectNotesPanel(), 1000);
      return;
    }

    // Проверяем, не существует ли уже панель
    const existingPanel = document.querySelector('[data-jira-notes-panel="true"]');
    if (existingPanel) {
      console.log('♻️ Removing old panel before creating new one...');
      existingPanel.remove();
    }

    // Ждем загрузки бокового окна Jira
    console.log('⏳ Waiting for Jira modal to fully load...');
    await this.waitForJiraModal();
    
    console.log('🎨 Creating panel for', this.currentIssueKey);
    
    // Создаем панель (теперь async)
    const panel = await this.createNotesPanel();
    
    // Вставляем в body
    document.body.appendChild(panel);
    
    // Проверяем что панель видима
    const rect = panel.getBoundingClientRect();
    console.log(' Panel position:', {
      top: rect.top,
      left: rect.left,
      display: window.getComputedStyle(panel).display,
      visibility: window.getComputedStyle(panel).visibility,
      zIndex: window.getComputedStyle(panel).zIndex
    });

    // Загружаем сохраненные заметки
    await this.loadNotes();
  }

  // Находим контейнер для вставки панели
  findTargetContainer() {
    // Возвращаем body для плавающего окна
    return document.body;
  }

  // Создаем HTML панели с заметками
  async createNotesPanel() {
    const result = await chrome.storage.local.get('customStatuses');
    const statuses = result.customStatuses || [
      { id: 'red', name: 'Проблема', color: '#EF4444' },
      { id: 'yellow', name: 'В процессе', color: '#EAB308' },
      { id: 'purple', name: 'В фокусе', color: '#A855F7' },
      { id: 'green', name: 'Готово', color: '#22C55E' }
    ];

    const panel = document.createElement('div');
    panel.className = 'jira-notes-panel';
    panel.setAttribute('data-jira-notes-panel', 'true');

    const statusButtons = statuses.map(status => `
      <button class="jira-status-btn" data-status="${status.id}" title="${status.name}">
        <span class="status-dot" style="background-color: ${status.color};"></span>
        ${status.name}
      </button>
    `).join('');

    panel.innerHTML = `
      <div class="jira-notes-header" id="jira-notes-drag-handle">
        <h3 class="jira-notes-title">${this.currentIssueKey}</h3>
        <div class="jira-notes-header-buttons">
          <button class="jira-notes-minimize" title="Свернуть">—</button>
          <button class="jira-notes-close" title="Закрыть">×</button>
        </div>
      </div>
      <div class="jira-notes-content">
        <div>
          <div class="jira-notes-markers-label">Статус</div>
          <div class="jira-notes-markers-container">
            ${statusButtons}
            <button class="jira-status-btn" data-status="" title="Очистить статус">
              <span class="status-dot" style="background-color: var(--jpn-color-fg-subtle);"></span>
              Очистить
            </button>
          </div>
        </div>
        <div>
          <div class="jira-notes-textarea-label">Заметка</div>
          <textarea class="jira-notes-textarea" placeholder="Добавьте личную заметку..."></textarea>
        </div>
        <div class="jira-notes-copypaste-section">
          <button class="jira-copypaste-btn" title="Скопировать заполненный шаблон в буфер обмена">
            📋 Копипаста
          </button>
        </div>
        <div class="jira-notes-footer">
          Автосохранение включено
        </div>
      </div>
    `;

    this.attachEventListeners(panel);
    await this.restoreCollapsedState(panel);
    this.restorePosition(panel);
    this.makeDraggable(panel);
    this.protectPanel(panel);

    return panel;
  }

  // Защита панели от удаления - УПРОЩЕННАЯ ВЕРСИЯ (без лагов при скролле)
  protectPanel(panel) {
    // Устанавливаем максимальный z-index и GPU ускорение
    const ensureZIndex = () => {
      panel.style.zIndex = '2147483647'; // Максимально возможный z-index
      panel.style.position = 'fixed';
    };
    
    ensureZIndex();
    panel.style.willChange = 'transform'; // GPU ускорение для плавности
    
    // Только проверяем что панель в DOM и z-index не изменился
    const protectionInterval = setInterval(() => {
      if (!document.body.contains(panel)) {
        console.log(`⚠️ Panel was removed from DOM, re-adding...`);
        document.body.appendChild(panel);
        ensureZIndex();
      } else if (panel.style.zIndex !== '2147483647') {
        // Если кто-то изменил z-index - восстанавливаем
        ensureZIndex();
      }
    }, 2000); // Проверяем каждые 2 секунды
    
    // При скролле проверяем z-index (throttled)
    let scrollTimeout;
    const handleScroll = () => {
      if (scrollTimeout) return;
      scrollTimeout = setTimeout(() => {
        ensureZIndex();
        scrollTimeout = null;
      }, 100); // Проверяем не чаще чем раз в 100мс
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    document.addEventListener('scroll', handleScroll, { passive: true, capture: true });
  }

  // Привязываем обработчики событий - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ
  attachEventListeners(panel) {
    const textarea = panel.querySelector('.jira-notes-textarea');
    const closeButton = panel.querySelector('.jira-notes-close');
    const minimizeButton = panel.querySelector('.jira-notes-minimize');
    const statusButtons = panel.querySelectorAll('.jira-status-btn');
    const copypasteButton = panel.querySelector('.jira-copypaste-btn');

    // Автосохранение при вводе с debounce
    let saveTimeout;
    const debouncedSave = () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => this.saveNotes(), 800); // Уменьшили с 1000 до 800мс
    };
    
    textarea.addEventListener('input', debouncedSave, { passive: true });

    // Закрытие окна (не удаляем, просто скрываем)
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
      console.log('Panel hidden by user');
    }, { passive: false });

    // Сворачивание/разворачивание окна
    minimizeButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await this.togglePanelCollapse(panel);
    }, { passive: false });

    // Обработчики статусов с делегированием
    statusButtons.forEach(button => {
      button.addEventListener('click', async () => {
        const status = button.getAttribute('data-status');
        await this.setStatus(status);
        
        // Извлекаем адрес при установке статуса (если еще не сохранен и если автоопределение включено)
        if (this.officeDetectionEnabled && !this.addressCache[this.currentIssueKey]) {
          this.extractAndSaveAddress();
        }
      }, { passive: true });
    });

    // Обработчик кнопки копипасты
    if (copypasteButton) {
      copypasteButton.addEventListener('click', async () => {
        await this.generateAndCopyCopypaste();
      }, { passive: true });
    }

    // Горячие клавиши
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        clearTimeout(saveTimeout); // Отменяем отложенное сохранение
        this.saveNotes(true);
      }
    });

    console.log('Event listeners attached to panel');
  }

  // Делаем окно перетаскиваемым
  makeDraggable(panel) {
    const handle = panel.querySelector('#jira-notes-drag-handle');
    let isDragging = false;
    let currentX;
    let currentY;
    let initialX;
    let initialY;

    handle.style.cursor = 'move';
    
    // Защита от удаления панели
    panel.setAttribute('data-jira-notes-panel', 'true');

    handle.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('jira-notes-close')) return;
      
      isDragging = true;
      const rect = panel.getBoundingClientRect();
      initialX = e.clientX - rect.left;
      initialY = e.clientY - rect.top;
      
      panel.style.transition = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      e.preventDefault();
      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      // Ограничиваем перемещение в пределах экрана
      const maxX = window.innerWidth - panel.offsetWidth;
      const maxY = window.innerHeight - panel.offsetHeight;
      
      currentX = Math.max(0, Math.min(currentX, maxX));
      currentY = Math.max(0, Math.min(currentY, maxY));

      panel.style.left = currentX + 'px';
      panel.style.top = currentY + 'px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        isDragging = false;
        panel.style.transition = '';
        this.savePosition(panel);
      }
    });
  }

  // Сохранение позиции окна
  async savePosition(panel) {
    const position = {
      left: panel.style.left,
      top: panel.style.top
    };

    try {
      // Проверяем, что контекст расширения еще валиден
      if (!chrome.runtime?.id) {
        return; // Тихо выходим - позиция не критична
      }
      
      await chrome.storage.local.set({
        'panel_position': position
      });
    } catch (error) {
      // Игнорируем ошибку Extension context invalidated
      if (error.message?.includes('Extension context invalidated')) {
        return; // Тихо выходим при перезагрузке расширения
      } else {
        console.error('Error saving position:', error);
      }
    }
  }

  // Восстановление позиции окна
  async restorePosition(panel) {
    try {
      const result = await chrome.storage.local.get(['panel_position']);
      const position = result.panel_position;

      if (position && position.left !== undefined && position.top !== undefined) {
        // Парсим значения (могут быть как числа, так и строки с 'px')
        const savedLeft = parseInt(position.left);
        const savedTop = parseInt(position.top);
        
        // Проверяем что значения валидные
        if (!isNaN(savedLeft) && !isNaN(savedTop)) {
          // Проверяем, что позиция в пределах экрана
          const maxLeft = window.innerWidth - 350; // 320px ширина панели + запас
          const maxTop = window.innerHeight - 200; // минимальная высота панели
          
          const safeLeft = Math.max(20, Math.min(savedLeft, maxLeft));
          const safeTop = Math.max(20, Math.min(savedTop, maxTop));
          
          console.log(` Restoring position: saved(${savedLeft}, ${savedTop}) -> safe(${safeLeft}, ${safeTop}), screen(${window.innerWidth}x${window.innerHeight})`);
          
          panel.style.left = safeLeft + 'px';
          panel.style.top = safeTop + 'px';
          panel.style.right = 'auto';
          panel.style.bottom = 'auto';
          return;
        }
      }
      
      // Позиция по умолчанию - правый верхний угол
      const defaultLeft = window.innerWidth - 350;
      panel.style.left = defaultLeft + 'px';
      panel.style.top = '20px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      console.log(` Using default position: (${defaultLeft}, 20), screen(${window.innerWidth}x${window.innerHeight})`);
    } catch (error) {
      console.error('Error restoring position:', error);
      // Fallback на правый верхний угол
      panel.style.left = (window.innerWidth - 350) + 'px';
      panel.style.top = '20px';
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    }
  }
  
  // Сворачивание/разворачивание панели
  async togglePanelCollapse(panel) {
    const minimizeBtn = panel.querySelector('.jira-notes-minimize');
    const isCollapsed = panel.classList.contains('collapsed');
    
    if (isCollapsed) {
      // Разворачиваем - сначала меняем позицию, потом показываем контент
      
      // Восстанавливаем позицию
      const savedTop = panel.dataset.savedTop;
      if (savedTop && savedTop !== '' && savedTop !== 'undefined') {
        panel.style.top = savedTop;
        panel.style.bottom = 'auto';
        delete panel.dataset.savedTop;
      } else {
        panel.style.bottom = 'auto';
      }
      
      // Двойной RAF для гарантированного применения стилей
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      
      // Теперь показываем контент
      panel.classList.remove('collapsed');
      
      minimizeBtn.textContent = '—';
      minimizeBtn.title = 'Свернуть';
      console.log('📖 Panel expanded');
      
      try {
        await chrome.storage.local.set({ 'panel_collapsed': false });
      } catch (error) {
        console.error('Error saving collapse state:', error);
      }
    } else {
      // Сворачиваем - сначала скрываем контент, потом двигаем вниз
      
      // Сохраняем позицию
      if (panel.style.top && panel.style.top !== 'auto') {
        panel.dataset.savedTop = panel.style.top;
      }
      
      // Сначала скрываем контент
      panel.classList.add('collapsed');
      
      // Двойной RAF для гарантированного применения
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      
      // Теперь перемещаем вниз
      panel.style.top = 'auto';
      panel.style.bottom = '20px';
      
      minimizeBtn.textContent = '□';
      minimizeBtn.title = 'Развернуть';
      console.log('📕 Panel collapsed');
      
      try {
        await chrome.storage.local.set({ 'panel_collapsed': true });
      } catch (error) {
        console.error('Error saving collapse state:', error);
      }
    }
  }
  
  // Восстановление состояния сворачивания
  async restoreCollapsedState(panel) {
    try {
      const result = await chrome.storage.local.get('panel_collapsed');
      const isCollapsed = result.panel_collapsed || false;
      
      // НЕ восстанавливаем свёрнутое состояние - всегда показываем панель развёрнутой
      // Это предотвращает проблему с невидимой панелью после перезагрузки
      if (isCollapsed) {
        console.log('📖 Panel was collapsed, but showing expanded on page load');
        // Сбрасываем состояние на развёрнутое
        await chrome.storage.local.set({ 'panel_collapsed': false });
      }
    } catch (error) {
      console.error('Error restoring collapsed state:', error);
    }
  }

  // Загрузка заметок и статуса для текущей задачи
  async loadNotes() {
    // Проверяем валидность контекста расширения
    try {
      if (!chrome.runtime?.id) {
        console.log('🔄 Расширение было обновлено. Обновите страницу (F5) для продолжения работы.');
        return;
      }
    } catch (e) {
      console.log('🔄 Расширение было обновлено. Обновите страницу (F5) для продолжения работы.');
      return;
    }

    try {
      const notes = await this.getNote(this.currentIssueKey);
      const status = await this.getStatus(this.currentIssueKey);
      
      const textarea = document.querySelector('.jira-notes-textarea');
      if (textarea) {
        textarea.value = notes;
      }

      // Загружаем статус
      if (status) {
        this.displayCurrentStatus(status);
      }
      
      // Автоматически извлекаем и сохраняем адрес и код офиса при открытии задачи (только если включено)
      if (this.officeDetectionEnabled) {
        await this.extractAndSaveAddress();
        await this.extractAndSaveOfficeCode();
      }
      
      // НОВОЕ: Извлекаем и сохраняем ВСЕ данные из карточки
      await this.extractAndSaveAllIssueData();
      
      // Обновляем карточки на доске
      setTimeout(() => {
        this.updateAllCards();
      }, 500);
    } catch (error) {
      if (error.message?.includes('Extension context invalidated')) {
        console.log('🔄 Расширение было обновлено. Обновите страницу (F5) для продолжения работы.');
        return;
      }
      console.error('Error loading notes:', error);
    }
  }

  // Извлекаем и сохраняем адрес из открытой задачи - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ v3
  async extractAndSaveAddress() {
    // Ранний выход если адрес уже в кеше
    if (this.currentIssueKey && this.addressCache[this.currentIssueKey]) {
      console.log(`✓ Address in cache: ${this.currentIssueKey}`);
      // Обновляем карточку даже если адрес в кеше (для мгновенного отображения)
      this.updateSingleCard(this.currentIssueKey);
      return;
    }
    
    console.log('🔍 Starting address extraction...');
    
    // Уменьшаем количество попыток и задержку
    const maxAttempts = 2; // Уменьшили с 3 до 2
    const attemptDelay = 100; // Уменьшили с 200 до 100мс
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const addressField = document.querySelector('[data-testid="issue.views.field.single-line-text.read-view.customfield_11120"]');
      
      if (addressField) {
        const address = addressField.textContent.trim();
        
        if (address && this.currentIssueKey) {
          console.log(`✅ Found address on attempt ${attempt}: "${address.substring(0, 50)}..."`);

          // Проверяем, изменился ли адрес (избегаем лишних записей)
          const cachedAddress = this.addressCache[this.currentIssueKey];
          if (cachedAddress !== address) {
            this.addressCache[this.currentIssueKey] = address;
            await chrome.storage.local.set({
              [`address_${this.currentIssueKey}`]: address
            });
            console.log(`💾 Address saved: ${this.currentIssueKey} -> ${address.substring(0, 30)}...`);
            
            // МГНОВЕННО обновляем конкретную карточку
            this.updateSingleCard(this.currentIssueKey);
            
            // И планируем обновление всех карточек (для новых)
            this.updateAllCards();
          } else {
            console.log(`✓ Address unchanged, skip update`);
          }
          return;
        }
      }
      
      // Прерываемся раньше если адрес найден пустым
      if (addressField && !addressField.textContent.trim()) {
        console.log(`⚠️ Address field found but empty on attempt ${attempt}`);
        break;
      }
      
      // Ждем перед следующей попыткой
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attemptDelay));
      }
    }
    
    console.log('❌ Address field not found or empty');
  }

  // Нормализация текста для сравнения адресов (с memoization)
  normalizeAddress(text) {
    // Используем memoization для кеширования результатов
    if (!this._normalizeAddressMemoized) {
      this._normalizeAddressMemoized = this.memoizer.memoize((txt) => {
        if (!txt) return '';
        return txt
          .toLowerCase()
          .replace(/санкт-петербург|спб|с-пб/gi, '') // Убираем город
          .replace(/бизнес-центр|бц/gi, '') // Убираем БЦ
          .replace(/коворкинг/gi, '') // Убираем коворкинг
          .replace(/улица|ул\./gi, 'ул') // Нормализуем улица
          .replace(/проспект|пр-кт|пр\./gi, 'пр') // Нормализуем проспект
          .replace(/дом|д\./gi, '') // Убираем "дом"
          .replace(/корпус|к\./gi, 'к') // Нормализуем корпус
          .replace(/строение|стр\./gi, 'стр') // Нормализуем строение
          .replace(/[.,\s"«»]+/g, '') // Убираем пробелы, точки, запятые, кавычки
          .replace(/-/g, ''); // Убираем дефисы
      });
    }
    return this._normalizeAddressMemoized(text);
  }

  // Извлекаем кодировку офиса из двух полей Jira - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ v3
  async extractAndSaveOfficeCode() {
    // Ранний выход если код уже в кеше
    if (this.currentIssueKey && this.codeCache[this.currentIssueKey]) {
      console.log(`✓ Office code in cache: ${this.currentIssueKey} -> ${this.codeCache[this.currentIssueKey]}`);
      // Обновляем карточку даже если код в кеше (для мгновенного отображения)
      this.updateSingleCard(this.currentIssueKey);
      return;
    }
    
    console.log('🏢 Starting office code extraction...');
    
    const maxAttempts = 2; // Уменьшили с 3 до 2
    const attemptDelay = 100; // Уменьшили с 200 до 100мс
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Поле 1: "Офис или Адрес" (customfield_11120)
      const officeField1 = document.querySelector('[data-testid="issue.views.field.single-line-text.read-view.customfield_11120"]');
      // Поле 2: "Адрес офиса" (customfield_10994)
      const officeField2 = document.querySelector('[data-testid="issue.views.field.single-line-text.read-view.customfield_10994"]');
      
      if (officeField1 || officeField2) {
        const text1 = officeField1 ? officeField1.textContent.trim() : '';
        const text2 = officeField2 ? officeField2.textContent.trim() : '';
        
        console.log(`🔎 Attempt ${attempt}: Field1="${text1.substring(0, 50)}...", Field2="${text2.substring(0, 50)}..."`);
        
        // ШАГ 1: Сначала ищем точное совпадение с кодом в обоих полях (БЫСТРО)
        let foundCode = null;
        
        if (text1) {
          for (const code of this.addressMapping.codes) {
            if (text1.includes(code)) {
              foundCode = code;
              console.log(`✅ Found exact code match in Field1: "${code}"`);
              break;
            }
          }
        }
        
        if (!foundCode && text2) {
          for (const code of this.addressMapping.codes) {
            if (text2.includes(code)) {
              foundCode = code;
              console.log(`✅ Found exact code match in Field2: "${code}"`);
              break;
            }
          }
        }
        
        // ШАГ 2: Если код не найден - ищем по адресу с нормализацией (МЕДЛЕННЕЕ)
        if (!foundCode) {
          console.log('🔍 No direct code match, searching by address...');
          
          // Нормализуем тексты один раз
          const normalized1 = this.normalizeAddress(text1);
          const normalized2 = this.normalizeAddress(text2);
          
          console.log(`🔤 Normalized: Field1="${normalized1}", Field2="${normalized2}"`);
          
          // ОПТИМИЗАЦИЯ: Используем предвычисленный кеш вместо нормализации на каждую итерацию
          for (let i = 0; i < this.addressMapping.addresses.length; i++) {
            const normalizedAddress = this.addressMapping.normalizedAddresses[i];
            
            // Проверяем вхождение (частичное совпадение)
            if ((normalized1 && normalized1.includes(normalizedAddress)) || 
                (normalized2 && normalized2.includes(normalizedAddress))) {
              foundCode = this.addressMapping.codes[i];
              console.log(`✅ Found normalized address match: "${this.addressMapping.addresses[i]}" -> "${foundCode}"`);
              break;
            }
          }
        }
        
        // ШАГ 3: Если ничего не нашли - ставим "ХЗ"
        if (!foundCode) {
          foundCode = 'ХЗ';
          console.log('❌ No matches found, using "ХЗ"');
        }
        
        // Сохраняем результат
        if (this.currentIssueKey) {
          const cachedCode = this.codeCache[this.currentIssueKey];
          if (cachedCode !== foundCode) {
            this.codeCache[this.currentIssueKey] = foundCode;
            await chrome.storage.local.set({
              [`code_${this.currentIssueKey}`]: foundCode
            });
            console.log(`💾 Office code saved: ${this.currentIssueKey} -> ${foundCode}`);
            
            // МГНОВЕННО обновляем конкретную карточку
            this.updateSingleCard(this.currentIssueKey);
            
            // И планируем обновление всех карточек (для новых)
            this.updateAllCards();
          } else {
            console.log(`✓ Office code unchanged, skip update`);
          }
        }
        
        return;
      }
      
      // Ждем перед следующей попыткой
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, attemptDelay));
      }
    }
    
    console.log('❌ Office fields not found');
  }

  // Извлечение ВСЕХ полей из карточки Jira и сохранение в localStorage
  async extractAndSaveAllIssueData() {
    if (!this.currentIssueKey) {
      console.log('⚠️ No issue key - skipping full data extraction');
      return;
    }

    // Проверяем валидность контекста
    try {
      if (!chrome.runtime?.id) {
        return; // Тихо выходим - данные будут извлечены после обновления страницы
      }
    } catch (e) {
      return; // Тихо выходим
    }

    console.log(`📊 Extracting full issue data for ${this.currentIssueKey}...`);

    const issueData = {
      issueKey: this.currentIssueKey,
      extractedAt: new Date().toISOString(),
      fields: {}
    };

    try {
      // === ИЗВЛЕЧЕНИЕ ОСНОВНЫХ ПОЛЕЙ ===
      
      // 1. Код элемента (Issue Key)
      issueData.fields.issueKey = {
        label: 'Код элемента',
        value: this.currentIssueKey
      };
      
      // 2. Название заявки (Summary)
      const summaryElement = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"]');
      if (summaryElement) {
        const summaryText = summaryElement.textContent.trim();
        if (summaryText) {
          issueData.fields.summary = {
            label: 'Название заявки',
            value: summaryText
          };
          console.log(`  ✓ Summary: ${summaryText.substring(0, 50)}${summaryText.length > 50 ? '...' : ''}`);
        }
      }
      
      // === ДИНАМИЧЕСКОЕ ИЗВЛЕЧЕНИЕ ВСЕХ КАСТОМНЫХ ПОЛЕЙ ===
      
      // Находим все элементы с data-testid содержащими customfield_
      const allElements = document.querySelectorAll('[data-testid*="customfield_"]');
      const customFields = new Map(); // Используем Map для избежания дубликатов
      
      console.log(`🔍 Found ${allElements.length} elements with customfield in testid`);
      
      allElements.forEach(element => {
        const testId = element.getAttribute('data-testid');
        
        // Извлекаем номер customfield из testid
        const match = testId.match(/customfield_(\d+)/);
        if (!match) return;
        
        const fieldId = `customfield_${match[1]}`;
        
        // Пропускаем, если уже обработали это поле
        if (customFields.has(fieldId)) return;
        
        // Получаем название поля из заголовка
        let fieldName = '';
        
        // Сначала ищем в "Основных сведениях" (с .common.)
        let headingElement = document.querySelector(`[data-testid="issue.views.issue-base.common.${fieldId}.label"]`);
        if (headingElement) {
          const h2 = headingElement.querySelector('h2');
          if (h2) {
            fieldName = h2.textContent.trim();
          }
        }
        
        // Если не нашли, ищем обычный заголовок
        if (!fieldName) {
          headingElement = document.querySelector(`[data-testid="issue-field-heading-styled-field-heading.${fieldId}"]`);
          if (headingElement) {
            const h3 = headingElement.querySelector('h3');
            if (h3) {
              fieldName = h3.textContent.trim();
            }
          }
        }
        
        // Если все еще нет названия, ищем в другом варианте заголовка
        if (!fieldName) {
          const h2Element = document.querySelector(`h2[data-component-selector="jira-issue-field-heading-multiline-field-heading-title"]`);
          if (h2Element && h2Element.closest(`[data-testid*="${fieldId}"]`)) {
            fieldName = h2Element.textContent.trim();
          }
        }
        
        // Извлекаем значение поля
        let fieldValue = '';
        
        // 1. Для полей из "Основных сведений" - rich text поля
        const richTextField = document.querySelector(`[data-testid="issue.views.field.rich-text.${fieldId}"]`);
        if (richTextField) {
          const readViewContainer = richTextField.querySelector('[data-component-selector="jira-issue-view-rich-text-inline-edit-view-container"]');
          if (readViewContainer) {
            fieldValue = readViewContainer.textContent.trim();
          }
        }
        
        // 2. Для дат (из "Основных сведений" и др.)
        if (!fieldValue) {
          const dateField = document.querySelector(`[data-testid="issue.views.field.date-inline-edit.${fieldId}"]`);
          if (dateField) {
            const readView = dateField.querySelector('[data-testid="issue-field-inline-edit-read-view-container.ui.container"]');
            if (readView) {
              // Текст даты находится после кнопки
              const buttonElement = readView.querySelector('button');
              if (buttonElement) {
                // Берем весь текст контейнера и удаляем текст кнопки
                fieldValue = readView.textContent.replace(buttonElement.textContent, '').trim();
              } else {
                fieldValue = readView.textContent.trim();
              }
            }
          }
        }
        
        // 3. Для select полей (одиночный выбор)
        if (!fieldValue) {
          const selectWrapper = document.querySelector(`[data-testid="issue.issue-view-layout.issue-view-single-select-field.${fieldId}"]`);
          if (selectWrapper) {
            const readView = selectWrapper.querySelector('[data-testid="issue-field-inline-edit-read-view-container.ui.container"]');
            if (readView) {
              // Для select с тегами
              const optionTag = readView.querySelector('[data-testid*="option-tag"]');
              if (optionTag) {
                fieldValue = optionTag.textContent.trim();
              } else {
                // Для обычного текста (может быть плейсхолдер)
                const buttonElement = readView.querySelector('button');
                if (buttonElement) {
                  fieldValue = readView.textContent.replace(buttonElement.textContent, '').trim();
                } else {
                  fieldValue = readView.textContent.trim();
                }
              }
            }
          }
        }
        
        // 4. Для multi-select полей
        if (!fieldValue) {
          const multiSelectWrapper = document.querySelector(`[data-testid="issue.views.field.select.common.select-inline-edit.${fieldId}"]`);
          if (multiSelectWrapper) {
            const readViewContainer = multiSelectWrapper.querySelector('[data-component-selector="jira-issue-view-select-inline-edit-read-view-container"]');
            if (readViewContainer) {
              fieldValue = readViewContainer.textContent.trim();
            }
          }
        }
        
        // 5. Для single-line-text полей (важно!)
        if (!fieldValue) {
          const singleLineTextField = document.querySelector(`[data-testid="issue.views.field.single-line-text.read-view.${fieldId}"]`);
          if (singleLineTextField) {
            // Для single-line-text может быть ссылка внутри
            const linkElement = singleLineTextField.querySelector('a');
            if (linkElement) {
              fieldValue = linkElement.textContent.trim();
            } else {
              fieldValue = singleLineTextField.textContent.trim();
            }
          }
        }
        
        // 6. Попробуем найти read-view для текстовых полей (общий случай)
        if (!fieldValue) {
          const readView = document.querySelector(`[data-testid*="read-view.${fieldId}"]`);
          if (readView) {
            fieldValue = readView.textContent.trim();
          }
        }
        
        // 7. Если не нашли, попробуем найти inline-edit контейнер
        if (!fieldValue) {
          const inlineEdit = document.querySelector(`[data-testid*="${fieldId}--container"]`);
          if (inlineEdit) {
            fieldValue = inlineEdit.textContent.trim();
          }
        }
        
        // 8. Для user полей
        if (!fieldValue) {
          const userField = document.querySelector(`[data-testid*="user-field.${fieldId}"]`);
          if (userField) {
            const userName = userField.querySelector('span[class*="_1reo15vq"]');
            if (userName) {
              fieldValue = userName.textContent.trim();
            }
          }
        }
        
        // Фильтруем пустые и placeholder значения
        const placeholders = ['Нет', 'Введите текст', 'Добавьте варианты', 'Добавьте дату', 'Выбрать', 'Редактировать', 'Закрепить вверху'];
        
        // Также удаляем aria-label и системный текст из значения
        if (fieldValue) {
          // Удаляем текст кнопок редактирования, который может попасть в значение
          fieldValue = fieldValue.replace(/Редактировать поле «.*?»/g, '').trim();
          fieldValue = fieldValue.replace(/Добавить.*?, edit/g, '').trim();
          fieldValue = fieldValue.replace(/Изменить.*?, edit/g, '').trim();
          fieldValue = fieldValue.replace(/Отредактировать поле.*?edit/g, '').trim();
          // Удаляем текст из тултипов кнопок закрепления
          fieldValue = fieldValue.replace(/Закрепить вверху.*?$/g, '').trim();
          fieldValue = fieldValue.replace(/Открепить сверху.*?$/g, '').trim();
          // Удаляем другие системные тексты
          fieldValue = fieldValue.replace(/Закрепленные поля видны только вам\.?/g, '').trim();
        }
        
        if (fieldValue && !placeholders.includes(fieldValue) && fieldName) {
          customFields.set(fieldId, {
            name: fieldName,
            value: fieldValue
          });
          console.log(`  ✓ ${fieldId} (${fieldName}): ${fieldValue.substring(0, 50)}${fieldValue.length > 50 ? '...' : ''}`);
        }
      });
      
      // Сохраняем все найденные поля
      customFields.forEach((data, fieldId) => {
        issueData.fields[fieldId] = {
          label: data.name,
          value: data.value
        };
      });

      // Определяем тип устройства (Apple или Windows)
      const deviceType = this.detectDeviceType(issueData.fields);
      console.log(`  🖥️ Device type detected: ${deviceType}`);

      // Сохраняем в localStorage (и данные карточки, и тип устройства отдельно)
      const dataKey = `issuedata_${this.currentIssueKey}`;
      const deviceTypeKey = `devicetype_${this.currentIssueKey}`;
      
      await chrome.storage.local.set({
        [dataKey]: issueData,
        [deviceTypeKey]: deviceType
      });

      console.log(`✅ Full issue data saved for ${this.currentIssueKey}:`, customFields.size, 'custom fields');
      return issueData;

    } catch (error) {
      console.error('❌ Error extracting issue data:', error);
      return null;
    }
  }

  // Определение типа устройства (Apple или Windows)
  detectDeviceType(fields) {
    // Ищем поле с типом оборудования (customfield_11122)
    const equipmentField = fields.customfield_11122;
    
    if (!equipmentField || !equipmentField.value) {
      return 'other'; // Если нет поля - это "другое"
    }
    
    const value = equipmentField.value.toLowerCase();
    
    // Проверяем на Apple/Mac
    if (value.includes('macbook') || value.includes('mac') || value.includes('apple')) {
      return 'apple';
    }
    
    // Проверяем на Windows ноутбуки
    if (value.includes('windows') || value.includes('ноутбук') || value.includes('laptop')) {
      return 'windows';
    }
    
    // Все остальное (периферия, телефоны, другое оборудование) - other
    return 'other';
  }

  // Сохранение заметок
  async saveNotes(showNotification = false) {
    const textarea = document.querySelector('.jira-notes-textarea');
    if (!textarea) return;

    // Проверяем валидность контекста
    try {
      if (!chrome.runtime?.id) {
        return; // Тихо выходим - заметки сохранятся после обновления
      }
    } catch (e) {
      return; // Тихо выходим
    }

    const notes = textarea.value;

    try {
      await this.saveNote(this.currentIssueKey, notes);
      console.log('📝 Notes saved for', this.currentIssueKey);
    } catch (error) {
      if (error.message?.includes('Extension context invalidated')) {
        return; // Тихо выходим
      }
      console.error('Error saving notes:', error);
    }
  }

  // Установка статуса
  async setStatus(status) {
    const statusKey = `status_${this.currentIssueKey}`;

    try {
      if (status) {
        // Если включена синхронизация - сохраняем через sync service
        if (this.syncMode === 'team' && syncService && this.syncInitialized) {
          const currentNote = await chrome.storage.local.get(`note_${this.currentIssueKey}`);
          const currentAddress = await chrome.storage.local.get(`address_${this.currentIssueKey}`);
          
          await syncService.saveNote(this.currentIssueKey, {
            text: currentNote[`note_${this.currentIssueKey}`] || '',
            status: status,
            address: currentAddress[`address_${this.currentIssueKey}`] || null
          });
          
          console.log(`✅ Status "${status}" synced for ${this.currentIssueKey}`);
        } else {
          // Локальное сохранение
          await chrome.storage.local.set({
            [statusKey]: status
          });
          console.log(`✅ Status "${status}" saved locally for ${this.currentIssueKey}`);
        }
      } else {
        await chrome.storage.local.remove(statusKey);
        console.log(`🗑️ Status cleared for ${this.currentIssueKey}`);
      }

      // Обновляем отображение в панели
      this.displayCurrentStatus(status);
      
      // Обновляем кеш и мгновенно обновляем карточку
      if (status) {
        this.statusCache[this.currentIssueKey] = status;
      } else {
        delete this.statusCache[this.currentIssueKey];
      }
      
      // МГНОВЕННО обновляем конкретную карточку
      this.updateSingleCard(this.currentIssueKey);
      
      // Обновляем все карточки на доске
      this.updateAllCards();
    } catch (error) {
      console.error('Error saving status:', error);
    }
  }

  // Отображение текущего статуса
  displayCurrentStatus(status) {
    // Подсвечиваем активную кнопку
    document.querySelectorAll('.jira-status-btn').forEach(btn => {
      if (btn.getAttribute('data-status') === status) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  // Обновляем ВСЕ карточки на доске (ОПТИМИЗИРОВАННАЯ v5 - с RAF batching)
  async updateAllCards() {
    // Создаем debounced версию при первом вызове
    if (!this._updateAllCardsDebounced) {
      this._updateAllCardsDebounced = debounceLeading(
        () => this._updateAllCardsImpl(),
        1000, // Увеличен для уменьшения дергания при скролле
        { leading: false, trailing: true, maxWait: 2000 } // leading: false важно!
      );
    }
    return this._updateAllCardsDebounced();
  }

  // НОВЫЙ МЕТОД: Мгновенное обновление одной конкретной карточки (без debounce)
  updateSingleCard(issueKey, retryCount = 0) {
    if (!issueKey) return;
    
    // Внутренняя функция для попытки обновления
    const tryUpdate = () => {
      const allCards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
      
      for (const card of allCards) {
        const link = card.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
        if (!link) continue;
        
        const href = link.href || '';
        const issueMatch = href.match(/([A-Z]+-\d+)/);
        if (!issueMatch || issueMatch[1] !== issueKey) continue;
        
        // Найдена нужная карточка - обновляем её немедленно
        console.log(`⚡ Instant update card: ${issueKey} (attempt ${retryCount + 1})`);
        
        // Используем RAF для плавного обновления
        this.rafBatcher.scheduleWrite(() => {
          this._applyCardModifications(card, link, issueKey);
        });
        
        return true; // Успешно обновлена
      }
      return false; // Не найдена
    };
    
    // Первая попытка обновления
    if (tryUpdate()) {
      return; // Успешно - выходим
    }
    
    // Карточка не найдена - пробуем еще раз через короткую задержку
    if (retryCount < 2) { // Максимум 2 retry (итого 3 попытки)
      const delay = retryCount === 0 ? 50 : 150; // 0ms → 50ms → 200ms
      console.log(`⏳ Card not found, retrying in ${delay}ms: ${issueKey}`);
      
      setTimeout(() => {
        this.updateSingleCard(issueKey, retryCount + 1);
      }, delay);
    } else {
      console.log(`⚠️ Card not found after ${retryCount + 1} attempts, will update via updateAllCards: ${issueKey}`);
    }
  }
  
  async _updateAllCardsImpl() {
    // Проверяем, что контекст расширения еще валиден
    if (!chrome.runtime?.id) {
      // Показываем уведомление пользователю один раз
      if (!this.contextInvalidatedShown) {
        this.contextInvalidatedShown = true;
        this.showReloadNotification();
      }
      return;
    }
    
    // Защита от race conditions
    if (this._updateInProgress) {
      console.log('⏳ Update already in progress, skipping');
      return;
    }
    this._updateInProgress = true;
    
    const now = Date.now();
    this.lastUpdateTime = now;
    
    try {
      // Получаем все сохраненные данные ОДИН РАЗ
      const allData = await chrome.storage.local.get(null);
      
      // Обновляем кеш только если данные изменились
      const newStatusCache = {};
      const newAddressCache = {};
      const newCodeCache = {};
      const newDeviceTypeCache = {};
      
      for (const key in allData) {
        if (key.startsWith('status_')) {
          newStatusCache[key.replace('status_', '')] = allData[key];
        } else if (key.startsWith('address_')) {
          newAddressCache[key.replace('address_', '')] = allData[key];
        } else if (key.startsWith('code_')) {
          newCodeCache[key.replace('code_', '')] = allData[key];
        } else if (key.startsWith('devicetype_')) {
          newDeviceTypeCache[key.replace('devicetype_', '')] = allData[key];
        }
      }
      
      // ОПТИМИЗАЦИЯ: Быстрое сравнение по размеру вместо JSON.stringify
      const statusChanged = Object.keys(this.statusCache).length !== Object.keys(newStatusCache).length ||
                            !this.compareObjects(this.statusCache, newStatusCache);
      const addressChanged = Object.keys(this.addressCache).length !== Object.keys(newAddressCache).length ||
                              !this.compareObjects(this.addressCache, newAddressCache);
      const codeChanged = Object.keys(this.codeCache).length !== Object.keys(newCodeCache).length ||
                          !this.compareObjects(this.codeCache, newCodeCache);
      const deviceTypeChanged = Object.keys(this.deviceTypeCache).length !== Object.keys(newDeviceTypeCache).length ||
                                !this.compareObjects(this.deviceTypeCache, newDeviceTypeCache);
      
      if (statusChanged || addressChanged || codeChanged || deviceTypeChanged) {
        this.statusCache = newStatusCache;
        this.addressCache = newAddressCache;
        this.codeCache = newCodeCache;
        this.deviceTypeCache = newDeviceTypeCache;
        
        console.log(`📊 Device types cached: ${Object.keys(newDeviceTypeCache).length}`, newDeviceTypeCache);
        
        // НЕ удаляем все элементы - processCard обновит их при необходимости
        
        console.log(`📦 Cache updated: ${Object.keys(this.statusCache).length} statuses, ${Object.keys(this.addressCache).length} addresses, ${Object.keys(this.codeCache).length} codes`);
        
        // ОПТИМИЗАЦИЯ: обрабатываем только ВИДИМЫЕ карточки при скролле
        const allCards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
        
        if (allCards.length === 0) {
          console.log('⚠️ No cards found on board');
          return;
        }
        
        console.log(`🎴 Found ${allCards.length} cards, processing only visible ones`);
        
        let processedCount = 0;
        allCards.forEach(cardContainer => {
          // Проверяем видимость карточки
          const rect = cardContainer.getBoundingClientRect();
          const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
          
          if (isVisible) {
            // НЕ сбрасываем флаг - просто обновляем данные без перерисовки
            const link = cardContainer.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
            if (link) {
              const href = link.href || '';
              const issueMatch = href.match(/([A-Z]+-\d+)/);
              if (issueMatch) {
                const issueKey = issueMatch[1];
                this._applyCardModifications(cardContainer, link, issueKey);
                processedCount++;
              }
            }
          }
        });
        
        console.log(`✅ Processed ${processedCount} visible cards out of ${allCards.length}`);
      } else {
        console.log('✅ Cache unchanged, skipping update');
      }
    } catch (error) {
      // Игнорируем ошибку Extension context invalidated
      if (error.message?.includes('Extension context invalidated')) {
        return; // Тихо выходим
      } else {
        console.error('❌ Error updating cards:', error);
      }
    } finally {
      this._updateInProgress = false;
    }
  }

  // Показываем статус операции
  showStatus(message, type = 'info') {
    console.log('Status:', message, type);
  }

  // Показываем уведомление о необходимости перезагрузки страницы
  showReloadNotification() {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #FFA500;
      color: white;
      padding: 16px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      max-width: 300px;
      cursor: pointer;
    `;
    notification.innerHTML = `
      <div style="font-weight: bold; margin-bottom: 8px;">⚠️ Расширение обновлено</div>
      <div style="font-size: 13px;">Обновите страницу (F5) для корректной работы</div>
    `;
    
    notification.addEventListener('click', () => {
      location.reload();
    });
    
    document.body.appendChild(notification);
    
    // Автоматически скрываем через 10 секунд
    setTimeout(() => {
      notification.style.opacity = '0';
      notification.style.transition = 'opacity 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 10000);
  }

  // Наблюдатель за изменениями в DOM (для SPA) - МОМЕНТАЛЬНАЯ ВЕРСИЯ v3
  setupObserver() {
    let lastIssueKey = this.currentIssueKey;

    // Set для отслеживания уже наблюдаемых карточек (предотвращает дубликаты)
    const observedCards = new WeakSet();

    // МГНОВЕННАЯ ОБРАБОТКА: IntersectionObserver для видимых карточек
    const intersectionObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Карточка появилась в области видимости - обрабатываем МГНОВЕННО
          const cardContainer = entry.target;
          this.processCard(cardContainer);
        }
      });
    }, {
      root: null, // viewport
      rootMargin: '50px', // Начинаем обрабатывать за 50px до появления
      threshold: 0.01 // Минимальная видимость
    });

    // Функция для обработки одной карточки с RAF batching
    this.processCard = (cardContainer) => {
      // Измерения выполняем в read фазе
      this.rafBatcher.scheduleRead(() => {
        const link = cardContainer.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
        if (!link) return;
        
        const href = link.href || '';
        const issueMatch = href.match(/([A-Z]+-\d+)/);
        if (!issueMatch) return;
        
        const issueKey = issueMatch[1];
        const isProcessed = cardContainer.hasAttribute('data-jira-processed');
        
        // Все DOM манипуляции в write фазе
        this.rafBatcher.scheduleWrite(() => {
          // Отмечаем как обработанную только при первой обработке
          if (!isProcessed) {
            cardContainer.setAttribute('data-jira-processed', 'true');
            cardContainer.style.position = 'relative';
          }
          this._applyCardModifications(cardContainer, link, issueKey);
        });
      });
    };
    
    // Вспомогательный метод для применения модификаций карточки
    this._applyCardModifications = (cardContainer, link, issueKey) => {
      // Статус - обновляем существующий или создаем новый
      let statusDot = cardContainer.querySelector('.jira-personal-status');
      if (this.statusCache[issueKey]) {
        const statusData = this.statusesMetadata[this.statusCache[issueKey]] || { 
          name: 'Неизвестно', 
          color: '#9ca3af', 
          emoji: '' 
        };
        
        if (!statusDot) {
          statusDot = document.createElement('div');
          statusDot.className = 'jira-personal-status';
          statusDot.setAttribute('data-issue-key', issueKey);
          cardContainer.appendChild(statusDot);
        }
        
        // Обновляем только если изменилось
        if (statusDot.style.background !== statusData.color) {
          statusDot.style.background = statusData.color;
          statusDot.title = `Статус: ${statusData.name}`;
        }
      } else if (statusDot) {
        // Удаляем если статус был удален
        statusDot.remove();
      }

      // Иконка устройства - обновляем существующую или создаем новую
      let deviceIcon = cardContainer.querySelector('.jira-device-icon');
      if (this.deviceTypeCache[issueKey]) {
        const deviceType = this.deviceTypeCache[issueKey];
        
        if (!deviceIcon) {
          deviceIcon = document.createElement('img');
          deviceIcon.className = 'jira-device-icon';
          deviceIcon.setAttribute('loading', 'lazy');
          deviceIcon.setAttribute('data-issue-key', issueKey);
          cardContainer.appendChild(deviceIcon);
        }
        
        // Определяем URL иконки
        let iconUrl;
        let title;
        if (deviceType === 'apple') {
          iconUrl = chrome.runtime.getURL('icons/mac_OS_128px.svg');
          title = 'Apple/MacBook';
        } else if (deviceType === 'windows') {
          iconUrl = chrome.runtime.getURL('icons/win_128.svg');
          title = 'Windows';
        } else {
          iconUrl = chrome.runtime.getURL('icons/other.svg');
          title = 'Другое оборудование';
        }
        
        // Обновляем только если изменилось
        if (deviceIcon.dataset.src !== iconUrl && deviceIcon.src !== iconUrl) {
          deviceIcon.dataset.src = iconUrl;
          deviceIcon.title = title;
          this.lazyLoadImage(deviceIcon);
        }
      } else if (deviceIcon) {
        // Удаляем если тип устройства был удален
        deviceIcon.remove();
      }
      
      // Код офиса - обновляем существующий или создаем новый
      let codeSpan = link.querySelector('.jira-personal-code-inline');
      if (this.officeDetectionEnabled && this.codeCache[issueKey]) {
        if (!codeSpan) {
          // Скрываем стандартный текст с issue key
          const childDivs = link.querySelectorAll('div');
          childDivs.forEach(div => {
            if (div.textContent.includes(issueKey) && 
                !div.classList.contains('jira-personal-code-inline') &&
                !div.classList.contains('jira-personal-address-inline')) {
              div.style.display = 'none';
            }
          });
          
          codeSpan = document.createElement('div');
          codeSpan.className = 'jira-personal-code-inline';
          link.appendChild(codeSpan);
        }
        
        // Обновляем только если изменилось
        if (codeSpan.textContent !== this.codeCache[issueKey]) {
          codeSpan.textContent = this.codeCache[issueKey];
          codeSpan.title = `Офис: ${this.codeCache[issueKey]} (${issueKey})`;
          
          if (this.codeCache[issueKey] === 'ХЗ') {
            codeSpan.style.color = '#9ca3af';
            codeSpan.style.fontStyle = 'italic';
          } else {
            codeSpan.style.color = '';
            codeSpan.style.fontStyle = '';
          }
        }
      }
      // Адрес (если нет кода) - обновляем существующий или создаем новый
      else if (this.officeDetectionEnabled && this.addressCache[issueKey]) {
        let addressSpan = link.querySelector('.jira-personal-address-inline');
        
        if (!addressSpan) {
          // Скрываем стандартный текст с issue key
          const childDivs = link.querySelectorAll('div');
          childDivs.forEach(div => {
            if (div.textContent.includes(issueKey) && !div.classList.contains('jira-personal-address-inline')) {
              div.style.display = 'none';
            }
          });
          
          addressSpan = document.createElement('div');
          addressSpan.className = 'jira-personal-address-inline';
          link.appendChild(addressSpan);
        }
        
        // Обновляем только если изменилось
        const newText = ` ${this.addressCache[issueKey]}`;
        if (addressSpan.textContent !== newText) {
          addressSpan.textContent = newText;
          addressSpan.title = `Адрес: ${this.addressCache[issueKey]} (${issueKey})`;
        }
      } else {
        // Удаляем код/адрес если были удалены
        if (codeSpan) codeSpan.remove();
        const addressSpan = link.querySelector('.jira-personal-address-inline');
        if (addressSpan) addressSpan.remove();
      }
    };

    // MutationObserver для отслеживания НОВЫХ карточек в DOM
    const mutationObserver = new MutationObserver((mutations) => {
      // Проверяем, изменился ли URL или содержимое
      const newIssueKey = this.extractIssueKeyFromUrl();
      
      if (newIssueKey && newIssueKey !== lastIssueKey) {
        console.log('Issue changed:', lastIssueKey, '->', newIssueKey);
        lastIssueKey = newIssueKey;
        this.currentIssueKey = newIssueKey;
        
        // Обновляем существующую панель
        const panel = document.querySelector('.jira-notes-panel');
        if (panel) {
          const title = panel.querySelector('.jira-notes-title');
          if (title) {
            title.textContent = newIssueKey;
          }
          panel.style.display = 'block';
        }
        
        // Загружаем новые данные
        setTimeout(() => this.loadNotes(), 300);
      }

      // Отслеживаем НОВЫЕ карточки и добавляем их в IntersectionObserver
      for (const mutation of mutations) {
        if (mutation.type !== 'childList') continue;
        if (mutation.addedNodes.length === 0) continue;
        
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          
          // Новая карточка появилась в DOM
          if (node.matches && node.matches('[data-testid="software-board.board-container.board.card-container.card-with-icc"]')) {
            // Проверяем, не наблюдаем ли уже за этой карточкой
            if (!observedCards.has(node)) {
              observedCards.add(node);
              intersectionObserver.observe(node);
              
              // Если карточка УЖЕ видима - обрабатываем мгновенно
              const rect = node.getBoundingClientRect();
              if (rect.top < window.innerHeight && rect.bottom > 0) {
                this.processCard(node);
              }
            }
          }
          // Или внутри добавленного узла есть карточки
          else if (node.querySelectorAll) {
            const cards = node.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
            cards.forEach(card => {
              // Проверяем, не наблюдаем ли уже за этой карточкой
              if (!observedCards.has(card)) {
                observedCards.add(card);
                intersectionObserver.observe(card);
                
                // Если карточка УЖЕ видима - обрабатываем мгновенно
                const rect = card.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                  this.processCard(card);
                }
              }
            });
          }
        }
      }
    });

    // Оптимизация: наблюдаем только за board container
    const observeBoard = () => {
      const boardContainer = document.querySelector('[data-testid="software-board.board-container.board"]') || 
                            document.querySelector('[data-test-id="platform-board-kit.ui.board.scroll.board-scroll"]') ||
                            document.body;
      
      if (boardContainer && boardContainer !== document.body) {
        console.log('📍 Observing board container (instant mode)');
      } else {
        console.log('📍 Observing body (board container not found)');
      }

      // Mutation observer для новых карточек
      mutationObserver.observe(boardContainer, {
        childList: true,
        subtree: true,
        attributes: false,
        characterData: false
      });
      
      // Intersection observer для всех СУЩЕСТВУЮЩИХ карточек
      const existingCards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
      console.log(`👀 Setting up instant observation for ${existingCards.length} existing cards`);
      
      existingCards.forEach(card => {
        // Добавляем в WeakSet перед наблюдением
        if (!observedCards.has(card)) {
          observedCards.add(card);
          intersectionObserver.observe(card);
          
          // Если карточка УЖЕ видима - обрабатываем мгновенно
          const rect = card.getBoundingClientRect();
          if (rect.top < window.innerHeight && rect.bottom > 0) {
            this.processCard(card);
          }
        }
      });
    };

    // Запускаем наблюдение с небольшой задержкой для загрузки DOM
    setTimeout(observeBoard, 300);

    // Дополнительно следим за изменениями URL
    this.watchUrlChanges();

    // НОВОЕ: Слушатель сообщений от других частей расширения
    this.setupMessageListener();
  }

  // НОВОЕ: Обработчик сообщений
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "getIssueDataForTemplate") {
        console.log("Received request for template data from settings page.");
        
        // Собираем данные для шаблона из текущей задачи
        const issueData = this.collectDataForTemplate();
        
        // Отправляем данные обратно на страницу настроек
        sendResponse({ data: issueData });
        
        // Возвращаем true, чтобы указать, что ответ будет асинхронным
        return true; 
      }
    });
  }

  // НОВОЕ: Сбор данных для шаблона
  collectDataForTemplate() {
    if (!this.currentIssueKey) {
      return null;
    }

    const data = {
      TASK_ID: this.currentIssueKey
    };

    // Используем данные, которые мы уже собрали в extractAndSaveAllIssueData
    const allFieldsData = this.extractAndSaveAllIssueData();
    if (allFieldsData && allFieldsData.fields) {
        for (const [fieldId, fieldData] of Object.entries(allFieldsData.fields)) {
            // Для обратной совместимости и удобства, дублируем некоторые поля
            if (fieldId === 'summary') data['SUMMARY'] = fieldData.value;
            if (fieldId === 'customfield_10989') data['USER_NAME'] = fieldData.value;
            if (fieldId === 'customfield_11122') data['EQUIPMENT'] = fieldData.value;
            if (fieldId === 'customfield_11120') data['ADDRESS'] = fieldData.value;
            
            // Добавляем все поля как есть
            data[fieldId] = fieldData.value;
        }
    }

    console.log("Collected data for template:", data);
    return data;
  }

  // Отслеживаем изменения URL (для selectedIssue параметра)
  watchUrlChanges() {
    let lastUrl = location.href;
    
    const checkUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        console.log('URL changed:', lastUrl, '->', currentUrl);
        lastUrl = currentUrl;
        
        const newIssueKey = this.extractIssueKeyFromUrl();
        if (newIssueKey && newIssueKey !== this.currentIssueKey) {
          this.currentIssueKey = newIssueKey;
          
          // Обновляем существующую панель
          const panel = document.querySelector('.jira-notes-panel');
          if (panel) {
            const title = panel.querySelector('.jira-notes-title');
            if (title) {
              title.textContent = newIssueKey;
            }
            panel.style.display = 'block';
            this.loadNotes();
          } else {
            this.injectNotesPanel();
          }
        } else if (!newIssueKey) {
          // Если задача закрыта, скрываем панель
          const panel = document.querySelector('.jira-notes-panel');
          if (panel) {
            panel.style.display = 'none';
          }
        }
      }
    };

    // Проверяем каждые 500ms
    setInterval(checkUrlChange, 500);
  }

  // Извлекаем ключ задачи из URL
  extractIssueKeyFromUrl() {
    // Сначала проверяем параметр selectedIssue
    const urlParams = new URLSearchParams(window.location.search);
    const selectedIssue = urlParams.get('selectedIssue');
    if (selectedIssue && selectedIssue.match(/^[A-Z]+-\d+$/)) {
      return selectedIssue;
    }

    // Затем проверяем path для старого формата
    const match = window.location.href.match(/\/browse\/([A-Z]+-\d+)/);
    return match ? match[1] : null;
  }

  // НОВОЕ: Генерация и копирование копипасты
  async generateAndCopyCopypaste() {
    try {
      console.log('📋 Generating copypaste for', this.currentIssueKey);

      // 1. Загружаем шаблон из storage
      const { copypasteTemplate } = await chrome.storage.local.get('copypasteTemplate');
      
      if (!copypasteTemplate || copypasteTemplate.trim() === '') {
        this.showCopypasteNotification('⚠️ Шаблон не настроен. Перейдите в Настройки → Шаблоны', 'warning');
        return;
      }

      // 2. Загружаем данные текущей задачи
      const issueDataKey = `issuedata_${this.currentIssueKey}`;
      const result = await chrome.storage.local.get(issueDataKey);
      const issueData = result[issueDataKey];

      if (!issueData || !issueData.fields) {
        this.showCopypasteNotification('⚠️ Нет данных по этой задаче. Перезагрузите страницу (F5)', 'warning');
        return;
      }

      // 3. Заполняем шаблон данными
      let filledTemplate = copypasteTemplate;

      // Заменяем плейсхолдеры полями из issueData
      for (const [fieldId, fieldData] of Object.entries(issueData.fields)) {
        const placeholder = new RegExp(`{{${fieldId}}}`, 'g');
        const value = fieldData.value || '';
        filledTemplate = filledTemplate.replace(placeholder, value);
      }

      // Заменяем стандартные плейсхолдеры для обратной совместимости
      filledTemplate = filledTemplate
        .replace(/{{TASK_ID}}/g, this.currentIssueKey || '')
        .replace(/{{issueKey}}/g, this.currentIssueKey || '')
        .replace(/{{USER_NAME}}/g, issueData.fields?.customfield_10989?.value || '')
        .replace(/{{EQUIPMENT}}/g, issueData.fields?.customfield_11122?.value || '')
        .replace(/{{ADDRESS}}/g, issueData.fields?.customfield_11120?.value || '')
        .replace(/{{SUMMARY}}/g, issueData.fields?.summary?.value || '');

      // 4. Показываем окно предпросмотра
      this.showCopypastePreview(filledTemplate);
      
      console.log('✅ Copypaste preview opened');

    } catch (error) {
      console.error('❌ Error generating copypaste:', error);
      this.showCopypasteNotification('❌ Ошибка: ' + error.message, 'error');
    }
  }

  // Показать окно предпросмотра копипасты
  async showCopypastePreview(content) {
    // Удаляем предыдущее окно предпросмотра, если есть
    const existingPreview = document.querySelector('.jira-copypaste-preview-modal');
    if (existingPreview) {
      existingPreview.remove();
    }

    // Загружаем данные текущей задачи для конструктора
    const issueDataKey = `issuedata_${this.currentIssueKey}`;
    const result = await chrome.storage.local.get(issueDataKey);
    const issueData = result[issueDataKey];

    // Создаём HTML для полей конструктора
    let fieldsHTML = '<p class="jira-preview-no-fields">Нет данных</p>';
    
    if (issueData && issueData.fields) {
      // Список полей, которые НИКОГДА не нужны (фильтруем полностью)
      const excludedFields = [
        'customfield_17754', // Схема безопасности
        'customfield_14246', // Задача с портала
        'customfield_11174', // ГЕО
        'customfield_11119', // Дата и время получения оборудования
        'customfield_11124'  // Наличие аппрува от руководителя
      ];
      
      // Список ID важных полей для группы "Основные"
      const mainFields = [
        'summary',           // Название заявки
        'customfield_11062', // Телеграм сотрудника
        'customfield_11087', // Ваш телеграм/Your Telegram
        'customfield_11122', // Выберите тип оборудования
        'customfield_11123', // Периферия
        'customfield_11120', // Офис или Адрес
        'customfield_11121'  // Номер телефона для курьера
      ];
      
      // Группируем поля по категориям
      const groups = {
        'Основные': [],
        'Дополнительно': []
      };

      // Сначала добавляем важные поля в "Основные"
      mainFields.forEach(fieldId => {
        const fieldData = issueData.fields[fieldId];
        if (fieldData && fieldData.value) {
          groups['Основные'].push({ 
            id: fieldId, 
            label: fieldData.label, 
            value: fieldData.value 
          });
        }
      });

      // Остальные поля добавляем в "Дополнительно" (кроме исключенных)
      for (const [fieldId, fieldData] of Object.entries(issueData.fields)) {
        // Пропускаем если это поле уже в основных или в исключенных
        if (mainFields.includes(fieldId) || excludedFields.includes(fieldId)) {
          continue;
        }
        
        // Добавляем в дополнительные
        if (fieldData.value) {
          groups['Дополнительно'].push({ 
            id: fieldId, 
            label: fieldData.label, 
            value: fieldData.value 
          });
        }
      }

      // Создаём HTML
      let groupsHTML = '';
      for (const groupName in groups) {
        const groupFields = groups[groupName];
        if (groupFields.length > 0) {
          groupsHTML += `<div class="jira-preview-field-group-header">${groupName}</div>`;
          groupFields.forEach(field => {
            const shortValue = field.value ? (field.value.length > 30 ? field.value.substring(0, 30) + '...' : field.value) : '—';
            groupsHTML += `
              <div class="jira-preview-field-pill" draggable="true" data-placeholder="{{${field.id}}}" title="${field.label}: ${field.value || 'пусто'}">
                <span class="jira-preview-field-label">${field.label}</span>
                <span class="jira-preview-field-value">${shortValue}</span>
              </div>
            `;
          });
        }
      }
      
      fieldsHTML = groupsHTML;
    }

    // Создаём модальное окно
    const modal = document.createElement('div');
    modal.className = 'jira-copypaste-preview-modal';
    modal.innerHTML = `
      <div class="jira-copypaste-preview-backdrop"></div>
      <div class="jira-copypaste-preview-content">
        <div class="jira-copypaste-preview-header">
          <h3>Предпросмотр копипасты - ${this.currentIssueKey}</h3>
          <button class="jira-copypaste-preview-close" title="Закрыть">×</button>
        </div>
        <div class="jira-copypaste-preview-body">
          <div class="jira-copypaste-preview-left">
            <div class="jira-copypaste-preview-editor-section">
              <div class="jira-preview-section-label">✏️ Редактирование (с плейсхолдерами)</div>
              <textarea class="jira-copypaste-preview-textarea" spellcheck="false">${content}</textarea>
            </div>
            <div class="jira-copypaste-preview-result-section">
              <div class="jira-preview-section-label">👁️ Результат (что будет скопировано)</div>
              <div class="jira-copypaste-preview-result"></div>
            </div>
          </div>
          <div class="jira-copypaste-preview-right">
            <div class="jira-preview-fields-header">
              <strong>Поля задачи</strong>
              <small>Перетащите в текст</small>
            </div>
            <div class="jira-preview-fields-container">
              ${fieldsHTML}
            </div>
          </div>
        </div>
        <div class="jira-copypaste-preview-footer">
          <button class="jira-copypaste-preview-cancel">Отмена</button>
          <button class="jira-copypaste-preview-copy">📋 Копировать</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Обработчики событий
    const closeBtn = modal.querySelector('.jira-copypaste-preview-close');
    const cancelBtn = modal.querySelector('.jira-copypaste-preview-cancel');
    const copyBtn = modal.querySelector('.jira-copypaste-preview-copy');
    const backdrop = modal.querySelector('.jira-copypaste-preview-backdrop');
    const textarea = modal.querySelector('.jira-copypaste-preview-textarea');
    const resultDiv = modal.querySelector('.jira-copypaste-preview-result');
    const fieldPills = modal.querySelectorAll('.jira-preview-field-pill');

    // Функция замены плейсхолдеров на реальные значения
    const replacePlaceholders = (text) => {
      if (!issueData || !issueData.fields) return text;
      
      let result = text;
      
      // Заменяем плейсхолдеры полями из issueData
      for (const [fieldId, fieldData] of Object.entries(issueData.fields)) {
        const placeholder = new RegExp(`{{${fieldId}}}`, 'g');
        const value = fieldData.value || '';
        result = result.replace(placeholder, value);
      }
      
      // Заменяем стандартные плейсхолдеры
      result = result
        .replace(/{{TASK_ID}}/g, this.currentIssueKey || '')
        .replace(/{{issueKey}}/g, this.currentIssueKey || '')
        .replace(/{{USER_NAME}}/g, issueData.fields?.customfield_10989?.value || '')
        .replace(/{{EQUIPMENT}}/g, issueData.fields?.customfield_11122?.value || '')
        .replace(/{{ADDRESS}}/g, issueData.fields?.customfield_11120?.value || '')
        .replace(/{{SUMMARY}}/g, issueData.fields?.summary?.value || '');
      
      return result;
    };

    // Обновление панели результата
    const updateResultPreview = () => {
      const replacedText = replacePlaceholders(textarea.value);
      resultDiv.textContent = replacedText;
    };

    // Первоначальное обновление результата
    updateResultPreview();

    // Автофокус на текстовую область и выделение всего текста
    setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 100);

    // Обновление результата при изменении текста
    textarea.addEventListener('input', updateResultPreview);

    // Закрытие окна
    const closeModal = () => {
      modal.style.animation = 'fadeOut 0.2s ease-out';
      setTimeout(() => modal.remove(), 200);
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', closeModal);

    // Копирование - копируем ЗАМЕНЕННЫЙ текст
    copyBtn.addEventListener('click', async () => {
      const textToCopy = replacePlaceholders(textarea.value);
      try {
        await navigator.clipboard.writeText(textToCopy);
        this.showCopypasteNotification('✅ Скопировано в буфер обмена!', 'success');
        closeModal();
      } catch (error) {
        console.error('Copy error:', error);
        this.showCopypasteNotification('❌ Ошибка копирования', 'error');
      }
    });

    // Горячие клавиши
    modal.addEventListener('keydown', (e) => {
      // Escape - закрыть
      if (e.key === 'Escape') {
        closeModal();
      }
      // Ctrl+Enter - скопировать
      if (e.ctrlKey && e.key === 'Enter') {
        copyBtn.click();
      }
    });

    // Drag & Drop для полей
    fieldPills.forEach(pill => {
      pill.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', pill.dataset.placeholder);
        pill.style.opacity = '0.5';
      });

      pill.addEventListener('dragend', (e) => {
        pill.style.opacity = '1';
      });
    });

    // Drop на textarea
    textarea.addEventListener('dragover', (e) => {
      e.preventDefault();
      textarea.classList.add('drag-over');
    });

    textarea.addEventListener('dragleave', () => {
      textarea.classList.remove('drag-over');
    });

    textarea.addEventListener('drop', (e) => {
      e.preventDefault();
      textarea.classList.remove('drag-over');
      
      const placeholder = e.dataTransfer.getData('text/plain');
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = textarea.value;
      
      textarea.value = text.substring(0, start) + placeholder + text.substring(end);
      textarea.focus();
      textarea.selectionEnd = start + placeholder.length;
      
      // Обновляем результат после drop
      updateResultPreview();
    });
  }

  // Показать уведомление о копипасте
  showCopypasteNotification(message, type = 'info') {
    // Удаляем предыдущее уведомление, если есть
    const existingNotification = document.querySelector('.jira-copypaste-notification');
    if (existingNotification) {
      existingNotification.remove();
    }

    const notification = document.createElement('div');
    notification.className = 'jira-copypaste-notification';
    notification.textContent = message;
    
    // Цвет в зависимости от типа
    const colors = {
      success: '#22C55E',
      warning: '#EAB308',
      error: '#EF4444',
      info: '#3B82F6'
    };
    
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${colors[type] || colors.info};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      font-weight: 500;
      animation: slideDown 0.3s ease-out;
    `;

    document.body.appendChild(notification);

    // Автоматически скрываем через 3 секунды
    setTimeout(() => {
      notification.style.animation = 'slideUp 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
}

// Запускаем расширение
const extension = new JiraNotesExtension();
extension.init();
