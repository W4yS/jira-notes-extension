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
    this.debugEnabled = false; // включаем подробный лог если true
    this.issueProcessingQueue = Promise.resolve(); // очередь последовательной обработки открытия задач
    
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
    this.extractionLocks = {}; // { issueKey: Promise } - блокировка параллельного извлечения одной задачи
    this.extractionAttempts = {}; // { issueKey: number } - количество попыток извлечения
    this.pendingIssues = {}; // { issueKey: true } - пометка что извлечение ещё не завершено успешно
    this.maxExtractionAttempts = 8; // максимум повторных попыток при 0 найденных полях
    
    // НОВОЕ: Умная конфигурация категорий полей с приоритетами
    this.smartFieldConfig = {
      fullname: {
        label: '👤 ФИО',
        placeholder: 'ФИО',
        priority: [
          'customfield_10212',  // Прямое поле ФИО
          'composite:10587+10588+10589',  // Фамилия + Имя + Отчество
          'regex:summary'  // Парсинг из названия
        ],
        validator: (value) => value && value.length > 2,
        formatter: (value) => value.trim()
      },
      address: {
        label: '📍 Адрес',
        placeholder: 'АДРЕС',
        priority: [
          'customfield_11120',  // Офис или Адрес
          'customfield_10994',  // Адрес офиса
          'composite:11138+10560'  // ГЕО + Город
        ],
        validator: (value) => value && value.length > 2,
        formatter: (value) => value.trim()
      },
      telegram: {
        label: '📱 Телеграм',
        placeholder: 'TELEGRAM',
        priority: [
          'customfield_11062',  // Телеграм сотрудника
          'customfield_11087'   // Ваш телеграм
        ],
        validator: (value) => {
          if (!value) return false;
          const normalized = value.trim();
          return normalized.includes('@') || /^[a-zA-Z0-9_]{5,}$/.test(normalized);
        },
        formatter: (value) => value.trim(),
        warning: (value) => {
          if (value && !value.includes('@') && !/^[a-zA-Z0-9_]{5,}$/.test(value)) {
            return 'Не похоже на telegram handle';
          }
          return null;
        }
      },
      phone: {
        label: '☎️ Телефон',
        placeholder: 'ТЕЛЕФОН',
        priority: [
          'customfield_11121',  // Номер телефона для курьера
          'customfield_11087'   // Ваш телеграм (может содержать телефон)
        ],
        validator: (value) => {
          if (!value) return false;
          const normalized = value.replace(/[\s()-]/g, '');
          const patterns = [
            /^\+7\d{10}$/,     // +79123456789
            /^8\d{10}$/,       // 89123456789
            /^\+375\d{9}$/,    // +375291234567
            /^\+\d{10,15}$/    // Международный
          ];
          return patterns.some(p => p.test(normalized));
        },
        formatter: (value) => value.trim(),
        warning: (value) => {
          if (value && !value.match(/^[+\d\s()-]+$/)) {
            return 'Не похоже на номер телефона';
          }
          const invalidValues = ['Нет', '–', 'ОМ заберет', 'Добавьте варианты'];
          if (invalidValues.some(inv => value.includes(inv))) {
            return 'Placeholder-значение, не настоящий телефон';
          }
          return null;
        }
      },
      equipment: {
        label: '💻 Оборудование',
        placeholder: 'ОБОРУДОВАНИЕ',
        priority: [
          'customfield_11122',  // Выберите тип оборудования
          'summary'  // Может быть в названии заявки
        ],
        validator: (value) => value && value.length > 2,
        formatter: (value) => value.trim(),
        warning: (value) => {
          const invalidValues = ['Добавьте вариант', 'Другое оборудование / Other equipment'];
          if (invalidValues.some(inv => value.includes(inv))) {
            return '⚠️ Нет конкретного оборудования';
          }
          return null;
        }
      },
      peripherals: {
        label: '🖱️ Периферия',
        placeholder: 'ПЕРИФЕРИЯ',
        priority: [
          'customfield_11123'  // Периферия
        ],
        validator: (value) => value && value.length > 2,
        formatter: (value) => value.trim(),
        warning: (value) => {
          const invalidValues = ['Добавьте вариант', 'Другая периферия / Other peripherals'];
          if (invalidValues.some(inv => value.includes(inv))) {
            return '⚠️ Не указана конкретная периферия';
          }
          return null;
        }
      },
      description: {
        label: '📝 Содержание заявки',
        placeholder: 'СОДЕРЖАНИЕ',
        priority: [
          'summary'  // Название заявки
        ],
        validator: (value) => value && value.length > 3,
        formatter: (value) => value.trim()
      }
    };
    
    // Таблица соответствий адресов и кодов (загружается из code.json)
    this.addressMapping = {
      codes: [],
      addresses: [],
      mappingList: [] // Список объектов { code, rawCode, patterns }
    };
    
    // Загружаем маппинг и настройки при инициализации
    this.loadSettings();
    this.loadAddressMapping();
  }
  
  // Загрузка настроек расширения
  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['officeDetectionEnabled', 'smartFieldConfig', 'debugEnabled']);
      this.officeDetectionEnabled = result.officeDetectionEnabled !== false; // по умолчанию true
      this.debugEnabled = result.debugEnabled === true; // выключено по умолчанию
      
      // Загружаем пользовательскую конфигурацию приоритетов полей
      if (result.smartFieldConfig) {
        // Мержим с дефолтной конфигурацией (пользовательская перезаписывает дефолтную)
        Object.keys(result.smartFieldConfig).forEach(category => {
          if (this.smartFieldConfig[category]) {
            this.smartFieldConfig[category].priority = result.smartFieldConfig[category].priority || this.smartFieldConfig[category].priority;
          }
        });
        console.log('⚙️ Custom field priorities loaded');
      }
      
      console.log('⚙️ Office detection:', this.officeDetectionEnabled ? 'enabled' : 'disabled');
      if (this.debugEnabled) {
        console.log('🐞 Debug logging enabled');
      }
    } catch (error) {
      console.error('❌ Failed to load settings:', error);
      this.officeDetectionEnabled = true; // fallback на включенное состояние
    }
  }

  // Унифицированный логгер
  log(...args) {
    if (this.debugEnabled) {
      console.log('[JPN]', ...args);
    }
  }

  // Добавление задачи в очередь (гарантия последовательности)
  enqueueIssueProcessing(fn) {
    const wrapped = async () => {
      try {
        return await fn();
      } catch (e) {
        console.error('❌ Issue processing error:', e);
      }
    };
    this.issueProcessingQueue = this.issueProcessingQueue.then(() => wrapped());
    return this.issueProcessingQueue;
  }
  
  // Загрузка таблицы соответствий из code.json
  async loadAddressMapping() {
    try {
      const response = await fetch(chrome.runtime.getURL('code.json'));
      const data = await response.json();
      // Используем вынесенный модуль парсинга JiraParser
      this.addressMapping = (window.JiraParser && typeof window.JiraParser.buildAddressMapping === 'function')
        ? window.JiraParser.buildAddressMapping(data)
        : { codes: [], addresses: [], entries: [], mappingList: [] };
      console.log('📋 Address mapping loaded via parser module:', this.addressMapping.entries?.length || 0, 'codes');
    } catch (error) {
      console.error('❌ Failed to load address mapping:', error);
      // Fallback на пустую структуру
      this.addressMapping = { codes: [], addresses: [], entries: [], mappingList: [] };
    }
  }

  // Новый надёжный поиск кода офиса по адресу (поддержка нескольких исходных строк)
  getOfficeCode(rawAddress) {
    try {
      if (window.JiraParser && typeof window.JiraParser.getOfficeCode === 'function') {
        return window.JiraParser.getOfficeCode(this.addressMapping, rawAddress);
      }
      if (!rawAddress || !this.addressMapping?.mappingList?.length) return 'ХЗ';

      // Если передан массив адресов - объединяем. (На случай будущего расширения)
      const joinedRaw = Array.isArray(rawAddress) ? rawAddress.filter(Boolean).join(' | ') : rawAddress;
      const address = this.normalizeAddress(joinedRaw);
      
      console.log(`  🔍 Searching office code in: "${joinedRaw}" -> normalized: "${address}"`);

      // ЭТАП 1: Прямой поиск точного упоминания кода (как раньше) в исходной строке(ах)
      for (const code of this.addressMapping.codes) {
        if (joinedRaw.toLowerCase().includes(code.toLowerCase())) {
          console.log(`  🏢 Exact code match: ${code}`);
          return code;
        }
      }

      let best = null;
      for (const entry of this.addressMapping.mappingList) {
        for (const pattern of entry.patterns) {
          // Пропускаем слишком короткие паттерны (во избежание ложных совпадений типа "ой", "ов")
          if (!pattern || pattern.length < 4) continue;
          
          // Проверяем точное вхождение паттерна как подстроки
          // Добавляем проверку границ слова (не внутри другого слова)
          const idx = address.indexOf(pattern);
          if (idx !== -1) {
            // Проверяем, что это начало строки или после разделителя
            const beforeOk = idx === 0 || /[^а-яё]/i.test(address[idx - 1]);
            // Проверяем, что это конец строки или перед разделителем
            const afterOk = idx + pattern.length === address.length || /[^а-яё]/i.test(address[idx + pattern.length]);
            
            if (beforeOk && afterOk) {
              // Оцениваем по длине совпавшего паттерна (чем длиннее, тем надёжнее)
              const score = pattern.length;
              if (!best || score > best.score) {
                best = { code: entry.code, score, pattern };
              }
            }
          }
        }
      }
      if (best) {
        console.log(`  🏢 Office code matched (pattern scoring): ${best.code} | pattern: '${best.pattern}' | score: ${best.score}`);
        return best.code;
      }

      // ЭТАП 3 (ОБНОВЛЁН): Нормализованный адресный поиск по pair-структуре (фикс смещения индексов)
      if (this.addressMapping.entries?.length) {
        for (const entry of this.addressMapping.entries) {
          const normalizedAddr = entry.normalizedAddress;
          if (!normalizedAddr || normalizedAddr.length < 6) continue;
          if (address.includes(normalizedAddr)) {
            console.log(`  🏢 Normalized address match: '${entry.addressRaw}' -> ${entry.code}`);
            return entry.code;
          }
        }
      }

      console.log('  ❌ No office code match found, returning fallback "ХЗ"');
    } catch (e) {
      console.warn('⚠️ Office code detection error:', e);
    }
    return 'ХЗ';
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
  
  // НОВОЕ: Экранирование HTML для безопасного вывода
  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
    console.log('💡 Для включения детальных логов выполните: chrome.storage.local.set({debugEnabled: true})');
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
      if (area === 'local') {
        // Изменение настройки определения офиса
        if (changes.officeDetectionEnabled) {
          const newValue = changes.officeDetectionEnabled.newValue;
          console.log('⚙️ Office detection setting changed:', newValue);
          this.officeDetectionEnabled = newValue;
          
          // Перерисовываем все карточки
          this.updateAllCards();
        }
        
        // Изменение данных конкретных задач (code, address, devicetype)
        const changedIssues = new Set();
        
        for (const key in changes) {
          if (key.startsWith('code_') || key.startsWith('address_') || key.startsWith('devicetype_')) {
            const issueKey = key.replace(/^(code_|address_|devicetype_)/, '');
            
            // Обновляем кеш
            if (key.startsWith('code_')) {
              if (changes[key].newValue) {
                this.codeCache[issueKey] = changes[key].newValue;
              } else {
                delete this.codeCache[issueKey];
              }
            } else if (key.startsWith('address_')) {
              if (changes[key].newValue) {
                this.addressCache[issueKey] = changes[key].newValue;
              } else {
                delete this.addressCache[issueKey];
              }
            } else if (key.startsWith('devicetype_')) {
              if (changes[key].newValue) {
                this.deviceTypeCache[issueKey] = changes[key].newValue;
              } else {
                delete this.deviceTypeCache[issueKey];
              }
            }
            
            // Добавляем в список измененных (обновим все разом)
            changedIssues.add(issueKey);
          }
        }
        
        // Обновляем все измененные карточки одним пакетом
        if (changedIssues.size > 0) {
          console.log(`📝 Storage changed: updating ${changedIssues.size} card(s)`);
          this.log(`[STORAGE_CHANGED] Changed issues: ${Array.from(changedIssues).join(', ')}`);
          changedIssues.forEach(issueKey => {
            this.log(`[STORAGE_CHANGED] Triggering updateSingleCard for ${issueKey}`);
            this.updateSingleCard(issueKey);
          });
        }
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
  waitForJiraModal(expectedIssueKey = null) {
    return new Promise((resolve) => {
      let attempts = 0;
      const maxAttempts = 50; // 10 секунд максимум
      
      const checkModal = () => {
        attempts++;
        
        // Проверяем что задача не изменилась
        if (expectedIssueKey && this.currentIssueKey !== expectedIssueKey) {
          console.warn(`⚠️ Issue changed during modal wait! Expected ${expectedIssueKey}, now on ${this.currentIssueKey}`);
          resolve(false); // Возвращаем false чтобы прервать обработку
          return;
        }
        
        // Ищем признаки того, что боковая панель загрузилась
        const modal = document.querySelector('[role="dialog"]') || 
                     document.querySelector('[data-testid*="issue"]') ||
                     document.querySelector('.issue-view');
        
        // Проверяем наличие НЕСКОЛЬКИХ customfield элементов с реальным контентом
        const fieldElements = document.querySelectorAll('[data-testid*="customfield_"]');
        const genericFieldElements = document.querySelectorAll('[data-testid*="issue-field"]');
        
        const allFields = new Set([...fieldElements, ...genericFieldElements]);
        
        const fieldsWithContent = Array.from(allFields).filter(el => {
          const text = el.textContent.trim();
          return text && text.length > 0 && !text.includes('Добавьте вариант');
        });
        
        // Также проверяем наличие заголовка
        const summaryElement = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"]') || 
                               document.querySelector('h1[data-testid*="summary.heading"]');
        
        // Если есть заголовок и хотя бы одно поле (или просто заголовок) - считаем что готово
        if (modal && (fieldsWithContent.length >= 1 || summaryElement)) {
          console.log(`✅ Jira modal ready: ${fieldsWithContent.length} fields detected, waiting 500ms...`);
          setTimeout(() => resolve(true), 500);
        } else if (attempts >= maxAttempts) {
          console.warn('⚠️ Modal load timeout, proceeding anyway...');
          resolve(true);
        } else {
          if (modal) {
            console.log(`⏳ Modal found, but only ${fieldsWithContent.length} fields loaded (attempt ${attempts})...`);
          } else {
            console.log(`⏳ Waiting for Jira modal (attempt ${attempts})...`);
          }
          setTimeout(checkModal, 200);
        }
      };
      checkModal();
    });
  }

  // Вставляем панель с заметками
  async injectNotesPanel() {
    return this.enqueueIssueProcessing(async () => {
      if (!this.currentIssueKey) {
        this.log('❌ No issue key detected, retrying...');
        setTimeout(() => this.injectNotesPanel(), 1000);
        return;
      }

      const targetIssueKey = this.currentIssueKey;
      const existingPanel = document.querySelector('[data-jira-notes-panel="true"]');
      if (existingPanel) {
        this.log('♻️ Removing old panel before creating new one...');
        existingPanel.remove();
      }
      this.log('⏳ Waiting for Jira modal to fully load...');
      const modalReady = await this.waitForJiraModal(targetIssueKey);
      if (!modalReady || this.currentIssueKey !== targetIssueKey) {
        console.warn(`⚠️ Issue changed during panel injection. Expected ${targetIssueKey}, now on ${this.currentIssueKey}. Aborting.`);
        return;
      }
      this.log('🎨 Creating panel for', targetIssueKey);
      
      // НОВОЕ: Обновляем маппинг адресов перед экстракцией (чтобы подхватить изменения в code.json)
      await this.loadAddressMapping();
      
      this.log('📊 Pre-extracting issue data for copypaste...');
      const extractedData = await this.extractAndSaveAllIssueData(targetIssueKey);
      if (this.currentIssueKey !== targetIssueKey) {
        console.warn(`⚠️ Issue changed during data extraction. Expected ${targetIssueKey}, now on ${this.currentIssueKey}. Aborting panel creation.`);
        return;
      }
      if (!extractedData || !extractedData.fields || Object.keys(extractedData.fields).length < 3) {
        console.error('❌ Failed to extract sufficient data on first try, retrying in 1s...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.currentIssueKey !== targetIssueKey) {
          console.warn(`⚠️ Issue changed during retry wait. Aborting.`);
          return;
        }
        await this.extractAndSaveAllIssueData(targetIssueKey);
      } else {
        this.log('✅ Issue data ready:', Object.keys(extractedData.fields).length, 'fields');
      }
      const panel = await this.createNotesPanel();
      document.body.appendChild(panel);
      const rect = panel.getBoundingClientRect();
      this.log(' Panel position:', { top: rect.top, left: rect.left, display: window.getComputedStyle(panel).display, visibility: window.getComputedStyle(panel).visibility, zIndex: window.getComputedStyle(panel).zIndex });
      await this.loadNotes();
    });
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
  
  // Сворачивание/разворачивание панели (ОПТИМИЗИРОВАННАЯ ВЕРСИЯ с transform)
  async togglePanelCollapse(panel) {
    const minimizeBtn = panel.querySelector('.jira-notes-minimize');
    const isCollapsed = panel.classList.contains('collapsed');
    
    // Функция для одноразового слушателя окончания анимации
    const onTransitionEnd = (callback) => {
      const handler = (e) => {
        if (e.propertyName === 'transform') {
          panel.removeEventListener('transitionend', handler);
          callback();
        }
      };
      panel.addEventListener('transitionend', handler);
      // Fallback на случай если событие не сработает (например, вкладка не активна)
      setTimeout(() => {
        panel.removeEventListener('transitionend', handler);
        callback();
      }, 450);
    };

    if (isCollapsed) {
      // === РАЗВОРАЧИВАЕМ ===
      
      // 1. Определяем целевую позицию (восстанавливаем сохраненную)
      const currentTop = parseFloat(panel.style.top) || panel.getBoundingClientRect().top;
      let targetTop;
      
      const savedTop = panel.dataset.savedTop;
      if (savedTop && savedTop !== '' && savedTop !== 'undefined') {
        targetTop = parseFloat(savedTop);
        delete panel.dataset.savedTop;
      } else {
        // Если не сохранена, просто поднимаем на разумную высоту (например, 100px от верха)
        targetTop = 100;
      }
      
      // 2. Вычисляем дельту для анимации
      const deltaY = targetTop - currentTop;
      
      // 3. Запускаем анимацию через transform
      panel.style.transform = `translateY(${deltaY}px)`;
      panel.classList.remove('collapsed'); // Показываем контент
      
      minimizeBtn.textContent = '—';
      minimizeBtn.title = 'Свернуть';
      
      // 4. После анимации фиксируем новую позицию top и убираем transform
      onTransitionEnd(() => {
        panel.style.transition = 'none'; // Отключаем анимацию для мгновенной подмены
        panel.style.transform = '';
        panel.style.top = targetTop + 'px';
        panel.style.bottom = 'auto';
        
        // Force reflow
        panel.offsetHeight;
        
        panel.style.transition = ''; // Включаем анимацию обратно
      });
      
      console.log('📖 Panel expanded');
      try { await chrome.storage.local.set({ 'panel_collapsed': false }); } catch (e) {}

    } else {
      // === СВОРАЧИВАЕМ ===
      
      // 1. Сохраняем текущую позицию
      const rect = panel.getBoundingClientRect();
      const currentTop = rect.top;
      panel.dataset.savedTop = panel.style.top && panel.style.top !== 'auto' ? panel.style.top : currentTop + 'px';
      
      // 2. Вычисляем целевую позицию (внизу экрана)
      const headerHeight = panel.querySelector('.jira-notes-header').offsetHeight || 40;
      const targetTop = window.innerHeight - headerHeight - 20;
      
      // 3. Вычисляем дельту
      const deltaY = targetTop - currentTop;
      
      // 4. Запускаем анимацию через transform
      panel.style.transform = `translateY(${deltaY}px)`;
      panel.classList.add('collapsed'); // Скрываем контент
      
      minimizeBtn.textContent = '□';
      minimizeBtn.title = 'Развернуть';
      
      // 5. После анимации фиксируем новую позицию top и убираем transform
      onTransitionEnd(() => {
        panel.style.transition = 'none';
        panel.style.transform = '';
        panel.style.top = targetTop + 'px';
        panel.style.bottom = 'auto';
        
        panel.offsetHeight; // Force reflow
        
        panel.style.transition = '';
      });
      
      console.log('📕 Panel collapsed');
      try { await chrome.storage.local.set({ 'panel_collapsed': true }); } catch (e) {}
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
      
      // УДАЛЕНО: Больше не извлекаем данные здесь - они уже извлечены в injectNotesPanel()
      // Автоматическое извлечение адреса и офиса происходит внутри extractAndSaveAllIssueData()
      
      // ФОРСИРУЕМ немедленное обновление ВСЕХ карточек на доске (без debounce)
      // Это нужно чтобы новые данные (офис, адрес) сразу отобразились на всех карточках
      // forceAll=true обновляет ВСЕ карточки, не только видимые
      this._updateAllCardsImpl(true);
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

  // Извлечение ВСЕХ полей из карточки Jira и сохранение в localStorage
  async extractAndSaveAllIssueData(explicitIssueKey = null) {
    // КРИТИЧНО: Используем явно переданный ключ или текущий
    const targetIssueKey = explicitIssueKey || this.currentIssueKey;
    
    if (!targetIssueKey) {
      console.log('⚠️ No issue key - skipping full data extraction');
      return;
    }

    console.log(`🎯 Target issue: ${targetIssueKey}`);

    // Инициализация счётчика
    if (this.extractionAttempts[targetIssueKey] == null) {
      this.extractionAttempts[targetIssueKey] = 0;
    }
    this.pendingIssues[targetIssueKey] = true;

    // ЗАЩИТА: Если уже идёт извлечение этой задачи - ждём его завершения
    if (this.extractionLocks[targetIssueKey]) {
      console.log(`⏳ Waiting for ongoing extraction of ${targetIssueKey}`);
      return await this.extractionLocks[targetIssueKey];
    }

    // Проверяем валидность контекста
    try {
      if (!chrome.runtime?.id) {
        return; // Тихо выходим - данные будут извлечены после обновления страницы
      }
    } catch (e) {
      return; // Тихо выходим
    }

    console.log(`📊 Extracting full issue data for ${targetIssueKey} (attempt ${this.extractionAttempts[targetIssueKey] + 1}/${this.maxExtractionAttempts})...`);

    const runner = async () => {
      const data = await this._doExtractionReal(targetIssueKey);
      if (data && data._notReady) {
        const waited = this.modalWaitTimes?.[targetIssueKey] || 0;
        // Инициализация свойств ожидания при первом использовании
        if (!this.modalReadinessMaxWait) this.modalReadinessMaxWait = 6000;
        if (!this.modalWaitTimes) this.modalWaitTimes = {};
        if (waited < this.modalReadinessMaxWait && this.currentIssueKey === targetIssueKey) {
          const delay = Math.min(300 + waited, 1200);
          this.modalWaitTimes[targetIssueKey] = waited + delay;
          console.warn(`[WAIT_MODAL] ${targetIssueKey} not ready (elements=${data.elementCount || 0}), recheck in ${delay}ms (accumulated ${this.modalWaitTimes[targetIssueKey]}ms)`);
          setTimeout(() => {
            if (this.currentIssueKey === targetIssueKey) {
              this.extractAndSaveAllIssueData(targetIssueKey);
            }
          }, delay);
          return null;
        } else {
          console.warn(`[WAIT_MODAL_TIMEOUT] ${targetIssueKey} exceeded readiness wait (${waited}ms). Proceeding with FORCE extraction.`);
          // Force extraction ignoring readiness check
          return await this._doExtractionReal(targetIssueKey, true);
        }
      }
      if (!data) {
        // Не удалось извлечь (0 полей или ошибка)
        this.extractionAttempts[targetIssueKey]++;
        const attempt = this.extractionAttempts[targetIssueKey];
        if (attempt < this.maxExtractionAttempts && this.currentIssueKey === targetIssueKey) {
          const delay = Math.min(200 * Math.pow(1.8, attempt), 3000);
          console.warn(`[EXTRACT_ATTEMPT] ${targetIssueKey} empty result. Retry ${attempt}/${this.maxExtractionAttempts} in ${delay}ms`);
          // Планируем повторную попытку
          setTimeout(() => {
            // Проверяем что задача всё ещё актуальна
            if (this.currentIssueKey === targetIssueKey) {
              this.extractAndSaveAllIssueData(targetIssueKey);
            } else {
              console.log(`[EXTRACT_ABORT] Issue changed before retry for ${targetIssueKey}`);
              delete this.pendingIssues[targetIssueKey];
            }
          }, delay);
        } else {
          console.error(`[EXTRACT_DONE] Giving up on ${targetIssueKey} after ${attempt} attempts`);
          delete this.pendingIssues[targetIssueKey];
        }
        return null;
      } else {
        console.log(`[EXTRACT_DONE] ${targetIssueKey} success with ${Object.keys(data.fields).length} fields after attempt ${this.extractionAttempts[targetIssueKey] + 1}`);
        delete this.pendingIssues[targetIssueKey];
        return data;
      }
    };

    const extractionPromise = runner();
    this.extractionLocks[targetIssueKey] = extractionPromise;
    const result = await extractionPromise;
    delete this.extractionLocks[targetIssueKey];
    return result;
  }

  // Реальная функция извлечения (без повторных попыток)
  async _doExtractionReal(targetIssueKey, force = false) {
    const issueData = {
      issueKey: targetIssueKey,
      extractedAt: new Date().toISOString(),
      fields: {}
    };

    try {
      // === ИЗВЛЕЧЕНИЕ ОСНОВНЫХ ПОЛЕЙ ===
      
      // 1. Код элемента (Issue Key)
      issueData.fields.issueKey = {
        label: 'Код элемента',
        value: targetIssueKey
      };
      
      // 2. Название заявки (Summary)
      const summaryElement = document.querySelector('[data-testid="issue.views.issue-base.foundation.summary.heading"]') || 
                             document.querySelector('h1[data-testid*="summary.heading"]');
      
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
      
      // ОПТИМИЗАЦИЯ: Находим все элементы заранее
      const customFieldElements = document.querySelectorAll('[data-testid*="customfield_"]');
      const systemFieldElements = document.querySelectorAll('[data-testid^="issue.views.field."]'); // Системные поля
      // Добавляем более широкий поиск для проверки готовности (на случай изменений в Jira)
      const genericFieldElements = document.querySelectorAll('[data-testid*="issue-field"], [data-testid*="field.value"]');
      
      // Используем Set для уникальности элементов (если селекторы пересекаются)
      const allFoundElements = new Set([
        ...customFieldElements, 
        ...systemFieldElements,
        ...genericFieldElements
      ]);
      
      const totalElements = allFoundElements.size;

      // ПРОВЕРКА ГОТОВНОСТИ МОДАЛА:
      // 1. Если нет summary - точно не готово (или это не задача)
      if (!force && !summaryElement) {
        return { _notReady: true, elementCount: totalElements };
      }
      
      // 2. Если есть summary, но совсем нет полей - подождем, если не force
      if (!force && totalElements === 0) {
         return { _notReady: true, elementCount: totalElements };
      }
      
      const customFields = new Map();
      
      console.log(`🔍 Found ${customFieldElements.length} custom fields and ${systemFieldElements.length} system fields`);
      
      // Предварительно собираем все нужные селекторы для batch-запроса
      const fieldIds = new Set();
      customFieldElements.forEach(element => {
        const testId = element.getAttribute('data-testid');
        const match = testId.match(/customfield_(\d+)/);
        if (match) {
          fieldIds.add(`customfield_${match[1]}`);
        }
      });
      
      console.log(`📋 Processing ${fieldIds.size} unique fields...`);
      
      // Обрабатываем каждое уникальное поле
      fieldIds.forEach(fieldId => {
        // Пропускаем если уже обработали
        if (customFields.has(fieldId)) return;
        
        // === ИЗВЛЕЧЕНИЕ НАЗВАНИЯ ПОЛЯ ===
        let fieldName = '';
        
        // Вариант 1: "Основные сведения"
        const commonLabel = document.querySelector(`[data-testid="issue.views.issue-base.common.${fieldId}.label"] h2`);
        if (commonLabel) {
          fieldName = commonLabel.textContent.trim();
        }
        
        // Вариант 2: Обычный заголовок
        if (!fieldName) {
          const heading = document.querySelector(`[data-testid="issue-field-heading-styled-field-heading.${fieldId}"] h3`);
          if (heading) fieldName = heading.textContent.trim();
        }
        
        // Вариант 3: Multiline заголовок
        if (!fieldName) {
          const multilineHeading = document.querySelector(`h2[data-component-selector="jira-issue-field-heading-multiline-field-heading-title"]`);
          if (multilineHeading && multilineHeading.closest(`[data-testid*="${fieldId}"]`)) {
            fieldName = multilineHeading.textContent.trim();
          }
        }
        
        // === ИЗВЛЕЧЕНИЕ ЗНАЧЕНИЯ ПОЛЯ ===
        let fieldValue = '';
        
        // Пробуем все возможные варианты в порядке частоты использования
        const valueSelectors = [
          // 1. Single-line text (самый частый)
          { selector: `[data-testid="issue.views.field.single-line-text.read-view.${fieldId}"]`, extractor: (el) => el.querySelector('a')?.textContent || el.textContent },
          // 2. Rich text
          { selector: `[data-testid="issue.views.field.rich-text.${fieldId}"] [data-component-selector="jira-issue-view-rich-text-inline-edit-view-container"]`, extractor: (el) => el.textContent },
          // 3. Date
          { selector: `[data-testid="issue.views.field.date-inline-edit.${fieldId}"] [data-testid="issue-field-inline-edit-read-view-container.ui.container"]`, extractor: (el) => {
            const btn = el.querySelector('button');
            return btn ? el.textContent.replace(btn.textContent, '') : el.textContent;
          }},
          // 4. Single select
          { selector: `[data-testid="issue.issue-view-layout.issue-view-single-select-field.${fieldId}"] [data-testid="issue-field-inline-edit-read-view-container.ui.container"]`, extractor: (el) => {
            const tag = el.querySelector('[data-testid*="option-tag"]');
            if (tag) return tag.textContent;
            const btn = el.querySelector('button');
            return btn ? el.textContent.replace(btn.textContent, '') : el.textContent;
          }},
          // 5. Multi-select
          { selector: `[data-testid="issue.views.field.select.common.select-inline-edit.${fieldId}"] [data-component-selector="jira-issue-view-select-inline-edit-read-view-container"]`, extractor: (el) => el.textContent },
          // 6. User field
          { selector: `[data-testid*="user-field.${fieldId}"] span[class*="_1reo15vq"]`, extractor: (el) => el.textContent },
          // 7. Generic read-view
          { selector: `[data-testid*="read-view.${fieldId}"]`, extractor: (el) => el.textContent },
          // 8. Generic inline-edit
          { selector: `[data-testid*="${fieldId}--container"]`, extractor: (el) => el.textContent }
        ];
        
        for (const {selector, extractor} of valueSelectors) {
          const element = document.querySelector(selector);
          if (element) {
            try {
              const extracted = extractor(element);
              if (extracted) {
                fieldValue = extracted.trim();
                break;
              }
            } catch (e) {
              // Игнорируем ошибки экстрактора и пробуем следующий
            }
          }
        }
        
        // === ОЧИСТКА ЗНАЧЕНИЯ ===
        if (fieldValue) {
          // Удаляем системный текст одним регулярным выражением
          fieldValue = fieldValue
            .replace(/Редактировать поле «.*?»|Добавить.*?, edit|Изменить.*?, edit|Отредактировать поле.*?edit|Закрепить вверху.*?$|Открепить сверху.*?$|Закрепленные поля видны только вам\.?/g, '')
            .trim();

          // === СПЕЦИФИЧНАЯ ОЧИСТКА ДЛЯ ОБОРУДОВАНИЯ И ПЕРИФЕРИИ ===
          if (fieldId === 'customfield_11123') { // Периферия
             // Пример: "Мышка / Mouse; Монитор (Стандарт) / Monitor (Standard)" -> "Мышка; Монитор"
             // Пытаемся определить разделитель (обычно это запятая или точка с запятой в Jira)
             // Если разделителя нет, но есть несколько элементов, это сложнее, но будем надеяться на наличие разделителей в тексте
             const separator = fieldValue.includes(';') ? ';' : (fieldValue.includes(',') ? ',' : null);
             
             if (separator) {
               fieldValue = fieldValue.split(separator)
                 .map(item => {
                   // Берем часть до слэша и убираем скобки (...)
                   return item.split('/')[0].replace(/\([^)]*\)/g, '').trim();
                 })
                 .filter(Boolean)
                 .join('; ');
             } else {
               // Если разделителя нет, просто чистим от английской части и скобок
               fieldValue = fieldValue.split('/')[0].replace(/\([^)]*\)/g, '').trim();
             }
          }
           
          if (fieldId === 'customfield_11122') { // Оборудование
             // Пример: "Ноутбук средней мощности / Medium per" -> "Ноутбук"
             // Сначала берем русскую часть до слэша и убираем скобки
             let clean = fieldValue.split('/')[0].replace(/\([^)]*\)/g, '').trim();
             
             // Если это ноутбук - оставляем просто "Ноутбук"
             if (clean.toLowerCase().includes('ноутбук')) {
               clean = 'Ноутбук';
             }
             fieldValue = clean;
          }
        }
        
        // === ВАЛИДАЦИЯ И СОХРАНЕНИЕ ===
        const placeholders = ['Нет', 'Введите текст', 'Добавьте варианты', 'Добавьте дату', 'Выбрать', 'Редактировать', 'Закрепить вверху'];
        
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

      // КРИТИЧНАЯ ПРОВЕРКА: Убедимся что задача не изменилась
      if (this.currentIssueKey !== targetIssueKey) {
        console.warn(`⚠️ Issue changed during extraction! Was extracting ${targetIssueKey}, now on ${this.currentIssueKey}. Discarding data.`);
        return null;
      }

      // Проверяем что извлечены осмысленные данные
      const totalFields = Object.keys(issueData.fields).length;
      if (totalFields === 0) {
        console.error(`❌ No fields extracted for ${targetIssueKey}! Modal may not be fully loaded.`);
        return null; // Сигнал для повторной попытки
      }
      
      if (totalFields < 3) {
        console.warn(`⚠️ Only ${totalFields} fields extracted, data may be incomplete`);
      }

      // Интегрированное извлечение адреса(ов) и офиса (за один проход)
      let address = null;
      let officeCode = null;
      if (this.officeDetectionEnabled) {
        const address1 = issueData.fields.customfield_11120?.value;
        const address2 = issueData.fields.customfield_10994?.value; // второй адрес из старой версии
        const combined = [address1, address2].filter(v => v && v.trim()).join(' | ');
        address = combined || address1 || address2 || null;
        if (address) {
          // Передаем массив для многоисточникового поиска
          const officeSourceArray = [address1, address2].filter(Boolean);
          officeCode = this.getOfficeCode(officeSourceArray);
        }
      }

      // Сохраняем в localStorage (все данные одним вызовом!)
      const saveData = {
        [`issuedata_${targetIssueKey}`]: issueData,
        [`devicetype_${targetIssueKey}`]: deviceType
      };
      
      if (address) {
        saveData[`address_${targetIssueKey}`] = address;
      }
      
      const attemptIdx = this.extractionAttempts[targetIssueKey] || 0;
      let savedOfficeCode = false;
      if (officeCode) {
        const isProvisionalUnknown = officeCode === 'ХЗ' && attemptIdx < this.maxExtractionAttempts - 1;
        if (!isProvisionalUnknown) {
          saveData[`code_${targetIssueKey}`] = officeCode;
          savedOfficeCode = true;
          console.log(`💾 Saving office code for ${targetIssueKey}: "${officeCode}" (attempt ${attemptIdx + 1})`);
        } else {
          // НЕ сохраняем и НЕ кладём в codeCache, чтобы renderer показывал адрес (если есть) или ничего

          console.log(`⏳ Provisional office code "${officeCode}" for ${targetIssueKey} (attempt ${attemptIdx + 1}) - will retry before saving`);
        }
      } else {
        console.log(`⚠️ No office code to save for ${targetIssueKey} (address: "${address || 'none'}")`);
      }
      
      // КРИТИЧНО: Сначала сохраняем в storage, ПОТОМ обновляем кеш
      await chrome.storage.local.set(saveData);

      console.log(`✅ Full issue data saved for ${targetIssueKey}:`, customFields.size, 'custom fields');
      
      // Обновляем кеши ПОСЛЕ успешного сохранения в storage
      this.deviceTypeCache[targetIssueKey] = deviceType;
      if (address) this.addressCache[targetIssueKey] = address;
      if (savedOfficeCode) {
        this.codeCache[targetIssueKey] = officeCode;
      } else if (officeCode === 'ХЗ') {
        // Удаляем возможный старый код из предыдущей задачи, чтобы не показать преждевременно
        delete this.codeCache[targetIssueKey];
      }
      
      this.log(`[EXTRACTION] ✅ Caches updated for ${targetIssueKey}:`);
      this.log(`[EXTRACTION]   - officeCode: "${officeCode || 'none'}"`);
      this.log(`[EXTRACTION]   - address: "${address || 'none'}"`);
      this.log(`[EXTRACTION]   - deviceType: "${deviceType}"`);
      
      // Карточка обновится автоматически через chrome.storage.onChanged listener
      
      return issueData;

    } catch (error) {
      console.error('❌ Error extracting issue data:', error);
      return null;
    }
  }

  // Инвалидация кешей для задачи (перед началом новой экстракции)
  invalidateIssueCaches(issueKey) {
    delete this.codeCache[issueKey];
    delete this.addressCache[issueKey];
    delete this.deviceTypeCache[issueKey];
    // Удаляем из chrome.storage (не критично если не существует)
    try {
      chrome.storage.local.remove([`code_${issueKey}`, `address_${issueKey}`, `devicetype_${issueKey}`]);
      console.log(`[INVALIDATE] Cleared caches for ${issueKey}`);
    } catch (e) {
      console.warn(`[INVALIDATE] Failed to remove storage keys for ${issueKey}:`, e);
    }
  }

  // Определение типа устройства (Apple или Windows)
  detectDeviceType(fields) {
    // Ищем поле с типом оборудования (customfield_11122)
    const equipmentField = fields.customfield_11122;
    
    // Если поля нет или значения нет - не показываем иконку
    if (!equipmentField || !equipmentField.value) {
      return null;
    }
    
    const value = equipmentField.value.toLowerCase();
    
    // Игнорируем плейсхолдеры "Добавьте вариант" и т.д.
    const ignoreValues = ['добавьте вариант', 'выберите', 'none', 'нет'];
    if (ignoreValues.some(v => value.includes(v))) {
      return null;
    }
    
    // Проверяем на Apple/Mac
    if (value.includes('macbook') || value.includes('mac') || value.includes('apple') || value.includes('macos')) {
      return 'apple';
    }
    
    // Проверяем на Windows ноутбуки
    if (value.includes('windows') || value.includes('ноутбук') || value.includes('laptop') || value.includes('win')) {
      return 'windows';
    }
    
    // Все остальное (периферия, телефоны, другое оборудование) - other
    return 'other';
  }

  // НОВОЕ: Умное извлечение ФИО из summary через regex
  extractFullNameFromSummary(summaryText) {
    if (!summaryText) return null;
    
    // Паттерны для поиска ФИО в названии задачи
    const patterns = [
      // "Трудоустройство кандидата / Королев Лев Игоревич / 2025-11-17"
      /\/\s*([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?\s*\//,
      // "Новый сотрудник / Домиенко Арина  /  Техника"
      /Новый сотрудник.*?\/\s*([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?\s/,
      // "Увольнение  Неборака Валерия КДП"
      /Увольнение\s+([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?\s/,
      // "Кравченко Егор     Платежки" (в начале строки)
      /^([А-ЯЁ][а-яё]+)\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+))?\s+/,
      // Общий паттерн: Фамилия Имя [Отчество]
      /\b([А-ЯЁ][а-яё]{2,})\s+([А-ЯЁ][а-яё]{2,})(?:\s+([А-ЯЁ][а-яё]{2,}))?\b/
    ];
    
    for (const pattern of patterns) {
      const match = summaryText.match(pattern);
      if (match) {
        const lastName = match[1];
        const firstName = match[2];
        const patronymic = match[3] || '';
        
        // Исключаем ложные срабатывания (известные названия отделов/должностей)
        const excludeWords = ['Платежки', 'Техника', 'Разработка', 'Development', 'Payment', 'Support'];
        if (excludeWords.some(word => [lastName, firstName, patronymic].includes(word))) {
          continue;
        }
        
        return {
          fullName: `${lastName} ${firstName} ${patronymic}`.trim(),
          lastName,
          firstName,
          patronymic,
          source: 'summary (regex)'
        };
      }
    }
    
    return null;
  }

  // НОВОЕ: Умное извлечение всех вариантов для категории поля
  async extractSmartFieldVariants(category, issueData) {
    if (!this.smartFieldConfig[category]) {
      console.warn(`Unknown smart field category: ${category}`);
      return [];
    }
    
    const config = this.smartFieldConfig[category];
    const variants = [];
    
    for (const priorityItem of config.priority) {
      // Обработка композитных полей (например, "composite:10587+10588+10589")
      if (priorityItem.startsWith('composite:')) {
        const fieldIds = priorityItem.replace('composite:', '').split('+');
        const values = fieldIds.map(id => {
          const fullId = id.startsWith('customfield_') ? id : `customfield_${id}`;
          return issueData.fields[fullId]?.value || '';
        }).filter(v => v);
        
        if (values.length > 0) {
          const compositeValue = values.join(' ').trim();
          if (config.validator(compositeValue)) {
            variants.push({
              value: config.formatter(compositeValue),
              source: `Композит (${fieldIds.join('+')})`,
              fieldIds: fieldIds,
              priority: config.priority.indexOf(priorityItem) + 1,
              warning: config.warning ? config.warning(compositeValue) : null,
              isComposite: true
            });
          }
        }
      }
      // Обработка regex-полей (например, "regex:summary")
      else if (priorityItem.startsWith('regex:')) {
        const sourceField = priorityItem.replace('regex:', '');
        const sourceValue = issueData.fields[sourceField]?.value;
        
        if (sourceValue && category === 'fullname') {
          const extracted = this.extractFullNameFromSummary(sourceValue);
          if (extracted) {
            variants.push({
              value: extracted.fullName,
              source: extracted.source,
              fieldIds: [sourceField],
              priority: config.priority.indexOf(priorityItem) + 1,
              warning: '⚠️ Извлечено через regex, может быть неточным',
              isRegex: true,
              details: extracted
            });
          }
        }
      }
      // Обработка обычных полей
      else {
        const fieldId = priorityItem;
        const fieldData = issueData.fields[fieldId];
        
        if (fieldData && fieldData.value) {
          const value = fieldData.value;
          
          // Специальная обработка для телефона: проверяем что это действительно телефон, а не telegram
          if (category === 'phone' && fieldId === 'customfield_11087') {
            // Если содержит @ - это telegram, пропускаем
            if (value.includes('@')) {
              continue;
            }
          }
          
          // Специальная обработка для telegram: проверяем что это действительно telegram, а не телефон
          if (category === 'telegram' && fieldId === 'customfield_11087') {
            // Если похоже на номер телефона - пропускаем
            if (value.match(/^[+\d\s()-]+$/) && !value.includes('@')) {
              continue;
            }
          }
          
          if (config.validator(value)) {
            variants.push({
              value: config.formatter(value),
              source: fieldData.label || fieldId,
              fieldIds: [fieldId],
              priority: config.priority.indexOf(priorityItem) + 1,
              warning: config.warning ? config.warning(value) : null,
              isRegular: true
            });
          } else {
            // Добавляем невалидные значения с предупреждением
            variants.push({
              value: value,
              source: fieldData.label || fieldId,
              fieldIds: [fieldId],
              priority: config.priority.indexOf(priorityItem) + 1,
              warning: config.warning ? config.warning(value) : '⚠️ Значение не прошло валидацию',
              isInvalid: true
            });
          }
        }
      }
    }
    
    // Сортируем по приоритету (меньше = выше приоритет)
    variants.sort((a, b) => a.priority - b.priority);
    
    return variants;
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
      
      // НЕ вызываем updateAllCards - достаточно обновить одну карточку
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
    // Защита от параллельных вызовов
    if (this._updateInProgress) {
      console.log('⏸️ Update already in progress, skipping duplicate call');
      return;
    }
    
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
  async updateSingleCard(issueKey, retryCount = 0) {
    if (!issueKey) return;
    
    this.log(`[UPDATE_CARD] 🔄 updateSingleCard called for ${issueKey} (retry ${retryCount})`);
    this.log(`[UPDATE_CARD]   - codeCache[${issueKey}]: ${this.codeCache[issueKey] || 'undefined'}`);
    
    // КРИТИЧНО: Синхронизируем кеш с chrome.storage перед обновлением
    try {
      const result = await chrome.storage.local.get([`code_${issueKey}`, `address_${issueKey}`]);
      const storedCode = result[`code_${issueKey}`];
      const storedAddress = result[`address_${issueKey}`];
      
      this.log(`[UPDATE_CARD]   - storedCode: ${storedCode || 'undefined'}`);
      this.log(`[UPDATE_CARD]   - storedAddress: ${storedAddress || 'undefined'}`);
      
      // Синхронизируем кеш с реальными данными
      if (storedCode !== undefined) {
        this.codeCache[issueKey] = storedCode;
      } else {
        delete this.codeCache[issueKey];
      }
      
      if (storedAddress !== undefined) {
        this.addressCache[issueKey] = storedAddress;
      } else {
        delete this.addressCache[issueKey];
      }
    } catch (err) {
      console.error(`[UPDATE_CARD] Error syncing cache for ${issueKey}:`, err);
    }
    
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
  
  async _updateAllCardsImpl(forceAll = false) {
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
      
      if (forceAll || statusChanged || addressChanged || codeChanged || deviceTypeChanged) {
        this.statusCache = newStatusCache;
        this.addressCache = newAddressCache;
        this.codeCache = newCodeCache;
        this.deviceTypeCache = newDeviceTypeCache;
        
        console.log(`📊 Device types cached: ${Object.keys(newDeviceTypeCache).length}`, newDeviceTypeCache);
        
        // НЕ удаляем все элементы - processCard обновит их при необходимости
        
        console.log(`📦 Cache updated: ${Object.keys(this.statusCache).length} statuses, ${Object.keys(this.addressCache).length} addresses, ${Object.keys(this.codeCache).length} codes`);
        
        // ОПТИМИЗАЦИЯ: обрабатываем только ВИДИМЫЕ карточки при скролле
        // Но если forceAll=true - обрабатываем ВСЕ
        const allCards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
        
        if (allCards.length === 0) {
          console.log('⚠️ No cards found on board');
          return;
        }
        
        if (forceAll) {
          console.log(`🎴 Found ${allCards.length} cards, processing ALL (forced update)`);
        } else {
          console.log(`🎴 Found ${allCards.length} cards, processing only visible ones`);
        }
        
        let processedCount = 0;
        allCards.forEach(cardContainer => {
          // Проверяем видимость карточки только если НЕ forceAll
          const rect = cardContainer.getBoundingClientRect();
          const isVisible = rect.top < window.innerHeight + 200 && rect.bottom > -200;
          
          if (forceAll || isVisible) {
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
        
        console.log(`✅ Processed ${processedCount} ${forceAll ? 'cards (ALL)' : 'visible cards'} out of ${allCards.length}`);
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
      if (window.JiraRenderer && typeof window.JiraRenderer.applyCardModifications === 'function') {
        window.JiraRenderer.applyCardModifications(this, cardContainer, link, issueKey);
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
        
        // УБРАНО: Не сбрасываем кеш, чтобы не было мигания (показываем старые данные пока грузятся новые)
        // this.invalidateIssueCaches(newIssueKey);
        
        this.extractionAttempts[newIssueKey] = 0; // обнуляем счётчик попыток
        
        // Ставим флаг ожидания только если данных вообще нет в кеше
        if (!this.codeCache[newIssueKey] && !this.addressCache[newIssueKey]) {
          this.pendingIssues[newIssueKey] = true;
        }
        
        // Обновляем существующую панель
        const panel = document.querySelector('.jira-notes-panel');
        if (panel) {
          const title = panel.querySelector('.jira-notes-title');
          if (title) {
            title.textContent = newIssueKey;
          }
          panel.style.display = 'block';
        }
        
        // КРИТИЧНО: Извлекаем данные новой задачи
        console.log('📊 Extracting data for issue change:', newIssueKey);
        // Сначала обновляем маппинг, потом экстрактим
        this.loadAddressMapping().then(() => {
          return this.extractAndSaveAllIssueData(newIssueKey);
        }).catch(err => {
          console.error(`Failed to extract data for ${newIssueKey}:`, err);
        });
        
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
        // Собираем асинхронно данные для шаблона (фикс: раньше Promise не ожидался)
        this.collectDataForTemplate().then(issueData => {
          sendResponse({ data: issueData });
        }).catch(err => {
          console.error('❌ Failed to collect template data:', err);
          sendResponse({ data: null, error: err?.message || 'unknown error' });
        });
        // Сообщаем что ответ будет асинхронным
        return true;
      }
    });
  }

  // НОВОЕ: Сбор данных для шаблона
  async collectDataForTemplate() {
    if (!this.currentIssueKey) {
      return null;
    }

    const data = {
      TASK_ID: this.currentIssueKey
    };

    // Используем данные, которые мы уже собрали в extractAndSaveAllIssueData
    const allFieldsData = await this.extractAndSaveAllIssueData(this.currentIssueKey);
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
            
            // НОВОЕ: Извлекаем данные новой задачи для копипасты (асинхронно, не блокируем UI)
            console.log('📊 Extracting data for new issue:', newIssueKey);
            // КРИТИЧНО: Передаём issueKey явно чтобы избежать race condition
            this.loadAddressMapping().then(() => {
              return this.extractAndSaveAllIssueData(newIssueKey);
            }).catch(err => {
              console.error(`Failed to extract data for ${newIssueKey}:`, err);
            });
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

      // 2. Загружаем данные текущей задачи (уже должны быть извлечены при открытии)
      const issueDataKey = `issuedata_${this.currentIssueKey}`;
      const result = await chrome.storage.local.get(issueDataKey);
      let issueData = result[issueDataKey];

      // Если данных нет или они старые (> 1 минуты), переизвлекаем
      if (!issueData || !issueData.fields || !issueData.extractedAt) {
        console.log('⚠️ No cached data, extracting fresh data...');
        issueData = await this.extractAndSaveAllIssueData(this.currentIssueKey);
      } else {
        const age = Date.now() - new Date(issueData.extractedAt).getTime();
        if (age > 60000) { // > 1 минуты
          console.log(`⚠️ Data is old (${Math.round(age/1000)}s), re-extracting...`);
          issueData = await this.extractAndSaveAllIssueData(this.currentIssueKey);
        } else {
          console.log(`✅ Using cached data (age: ${Math.round(age/1000)}s)`);
        }
      }

      if (!issueData || !issueData.fields) {
        this.showCopypasteNotification('⚠️ Не удалось извлечь данные задачи. Подождите загрузки страницы', 'warning');
        return;
      }
      console.log('✅ Issue data ready:', Object.keys(issueData.fields).length, 'fields');

      // 3. Заполняем шаблон данными
      let filledTemplate = copypasteTemplate;

      // === УМНАЯ ЛОГИКА: Удаление вопроса про мышку/коврик, если они уже есть ===
      const peripheralsVal = issueData.fields.customfield_11123?.value || '';
      if (peripheralsVal) {
        const pLower = peripheralsVal.toLowerCase();
        // Проверяем наличие мышки или коврика в периферии
        if (pLower.includes('мышка') || pLower.includes('коврик') || pLower.includes('mouse') || pLower.includes('pad')) {
          const phraseToRemove = "Не требуется ли что-то еще помимо указанного в списке, например мышка или коврик?";
          // Regex для удаления (case-insensitive, гибкие пробелы)
          const escapedPhrase = phraseToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
          const regex = new RegExp(escapedPhrase, 'gi');
          
          // Удаляем фразу
          filledTemplate = filledTemplate.replace(regex, '');
        }
      }

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
      this.showCopypastePreview(filledTemplate, issueData);
      
      console.log('✅ Copypaste preview opened');

    } catch (error) {
      console.error('❌ Error generating copypaste:', error);
      this.showCopypasteNotification('❌ Ошибка: ' + error.message, 'error');
    }
  }

  // Показать окно предпросмотра копипасты
  async showCopypastePreview(content, issueData) {
    // Удаляем предыдущее окно предпросмотра, если есть
    const existingPreview = document.querySelector('.jira-copypaste-preview-modal');
    if (existingPreview) {
      existingPreview.remove();
    }

    // Данные уже переданы как параметр
    console.log(`📂 Loaded issueData for preview:`, issueData);
    console.log(`📂 Fields count:`, issueData?.fields ? Object.keys(issueData.fields).length : 0);
    
    // НОВОЕ: Извлекаем умные варианты для каждой категории
    const smartFields = {};
    if (issueData && issueData.fields) {
      console.log('🔍 Extracting smart fields, issueData has', Object.keys(issueData.fields).length, 'fields');
      for (const category of ['fullname', 'address', 'telegram', 'phone', 'equipment', 'peripherals', 'description']) {
        smartFields[category] = await this.extractSmartFieldVariants(category, issueData);
        console.log(`📊 Smart field variants for ${category}:`, smartFields[category].length, 'variants');
      }
    } else {
      console.error('❌ No issueData or issueData.fields available!');
    }

    // Создаём HTML для умных полей (радио-группы)
    let smartFieldsHTML = '';
    
    if (Object.keys(smartFields).length > 0) {
      smartFieldsHTML = '<div class="jira-smart-fields-section">'; 
      smartFieldsHTML += '<div class="jira-preview-field-group-header">━━━ Основные данные ━━━</div>';
      
      for (const [category, variants] of Object.entries(smartFields)) {
        const config = this.smartFieldConfig[category];
        if (!variants || variants.length === 0) continue;
        
        smartFieldsHTML += ` 
          <div class="jira-smart-field-group" data-category="${category}">
            <div class="jira-smart-field-header">
              <strong>${config.label}</strong>
              <button class="jira-smart-field-insert-btn" data-placeholder="{{${config.placeholder}}}" title="Вставить плейсхолдер {{${config.placeholder}}} в текст">
                ↓ Вставить
              </button>
            </div>
        `;
        
        variants.forEach((variant, index) => {
          const isRecommended = index === 0 && !variant.isInvalid;
          const warningIcon = variant.warning ? '⚠️' : '';
          const recommendedBadge = isRecommended ? '<span class="jira-field-recommended-badge" title="Рекомендуется">⭐</span>' : '';
          const invalidClass = variant.isInvalid ? 'jira-smart-field-invalid' : '';
          
          smartFieldsHTML += `
            <div class="jira-smart-field-option ${invalidClass}">
              <label class="jira-smart-field-radio-label">
                <input type="radio" name="smart-field-${category}" value="${this.escapeHtml(variant.value)}" ${index === 0 ? 'checked' : ''}>
                <div class="jira-smart-field-content">
                  <div class="jira-smart-field-value">
                    ${warningIcon} ${this.escapeHtml(variant.value)} ${recommendedBadge}
                    <button class="jira-field-copy-btn" data-copy-value="${this.escapeHtml(variant.value)}" title="Копировать">
                      <svg viewBox="0 0 16 16" version="1.1" aria-hidden="true"><path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"></path><path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"></path></svg>
                    </button>
                  </div>
                  <div class="jira-smart-field-source">${variant.source}</div>
                  ${variant.warning ? `<div class="jira-smart-field-warning">${variant.warning}</div>` : ''} 
                </div>
              </label>
            </div>
          `;
        });
        
        smartFieldsHTML += '</div>';
      }
      
      smartFieldsHTML += '</div>';
    }

    // Создаём HTML для дополнительных полей (как раньше)
    let additionalFieldsHTML = '<p class="jira-preview-no-fields">Нет данных</p>';
    let importantFieldsHTML = '';
    
    if (issueData && issueData.fields) {
      // Список полей, которые НИКОГДА не нужны (фильтруем полностью)
      const excludedFields = [
        'customfield_17754', 'customfield_14246', 'customfield_11174',
        'customfield_11119', 'customfield_11124',
        // Также исключаем поля, которые уже в умном селекторе
        'customfield_10212', 'customfield_10587', 'customfield_10588', 'customfield_10589',
        'customfield_11120', 'customfield_10994', 'customfield_11138', 'customfield_10560',
        'customfield_11062', 'customfield_11087', 'customfield_11121',
        'customfield_11122', 'customfield_11123', 'summary'
      ];

      // Паттерны для исключения по названию
      const excludedLabelPatterns = [
        'Приоритет', 'Priority',
        'Наблюдатели', 'Watchers',
        'Телеграм HR', 'Recruiter\'s Telegrams',
        'Телеграм руководителя', 'Telegram handle of the employee',
        'Страна', 'Country',
        'Наличие аппрува', 'Approval', 'Аппрув',
        'Город', 'City',
        'Гео локал', 'ГЕО', 'Geo',
        'Задача из отдела КДП', 'ЗадачА',
        'Ping Date', 'Ping',
        'Tags', 'Метки',
        'Channel of communication', 'Channel',
        'Схема безопасности', 'Security',
        'От кого задача', 'Автор', 'Author', 'Reporter',
        'Соисполнитель', 'Исполнитель', 'Assignee'
      ];

      // Паттерны для важных полей (пресеты)
      const importantFieldPatterns = [
        { id: 'summary', label: 'Название заявки' },
        { id: 'customfield_11062', label: 'Телеграм сотрудника' },
        { label: 'Должность' },
        { label: 'Position' },
        { label: 'Проект' },
        { label: 'Project' },
        { label: 'Отдел' },
        { label: 'Подотдел' },
        { label: 'Subdepartment' },
        { id: 'customfield_11120', label: 'Офис или Адрес' },
        { id: 'customfield_11121', label: 'Номер телефона для курьера' }
      ];
      
      const mainFields = [
        'customfield_11009', 'customfield_10229', 'customfield_11118'
      ];
      
      const groups = {
        '📋 Основные': [],
        '➕ Дополнительно': []
      };

      const importantFields = [];
      const processedFieldIds = new Set();

      // 1. Сначала ищем важные поля
      for (const [fieldId, fieldData] of Object.entries(issueData.fields)) {
        if (!fieldData.value) continue;

        // Проверяем на соответствие паттернам важных полей
        const isImportant = importantFieldPatterns.some(pattern => {
          if (pattern.id && pattern.id === fieldId) return true;
          if (pattern.label && fieldData.label.toLowerCase().includes(pattern.label.toLowerCase())) return true;
          return false;
        });

        if (isImportant) {
          importantFields.push({
            id: fieldId,
            label: fieldData.label,
            value: fieldData.value
          });
          processedFieldIds.add(fieldId);
        }
      }

      // 2. Затем распределяем остальные поля
      for (const [fieldId, fieldData] of Object.entries(issueData.fields)) {
        if (processedFieldIds.has(fieldId)) continue; // Уже добавлено в важные
        if (excludedFields.includes(fieldId) || !fieldData.value) continue;
        
        // Проверка на исключение по названию
        const isExcludedByName = excludedLabelPatterns.some(pattern => 
          fieldData.label.toLowerCase().includes(pattern.toLowerCase())
        );
        if (isExcludedByName) continue;
        
        let category = '➕ Дополнительно';
        
        if (mainFields.includes(fieldId)) {
          category = '📋 Основные';
        }
        
        groups[category].push({ 
          id: fieldId, 
          label: fieldData.label, 
          value: fieldData.value 
        });
      }

      // Создаём HTML для важных полей
      if (importantFields.length > 0) {
        importantFields.forEach(field => {
          // Не обрезаем значения для важной информации, так как это сводка
          importantFieldsHTML += `
            <div class="jira-info-field-card">
              <div class="jira-info-field-header">
                <span class="jira-info-field-label">${this.escapeHtml(field.label)}</span>
                <button class="jira-field-copy-btn" data-copy-value="${this.escapeHtml(field.value)}" title="Копировать">
                  <svg viewBox="0 0 16 16" version="1.1" aria-hidden="true"><path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"></path><path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"></path></svg>
                </button>
              </div>
              <div class="jira-info-field-value">${this.escapeHtml(field.value)}</div>
            </div>
          `;
        });
      }

      // Создаём HTML для остальных групп
      let groupsHTML = '';
      groupsHTML += '<div class="jira-preview-field-group-header">━━━ Все остальные поля ━━━</div>';
      
      for (const groupName in groups) {
        const groupFields = groups[groupName];
        if (groupFields.length > 0) {
          groupsHTML += `<div class="jira-preview-field-subgroup-header">${groupName}</div>`;
          groupFields.forEach(field => {
            const shortValue = field.value.length > 30 ? field.value.substring(0, 30) + '...' : field.value;
            groupsHTML += `
              <div class="jira-preview-field-pill" draggable="true" data-placeholder="{{${field.id}}}" title="${this.escapeHtml(field.label)}: ${this.escapeHtml(field.value)}">
                <span class="jira-preview-field-label">${this.escapeHtml(field.label)}</span>
                <span class="jira-preview-field-value">${this.escapeHtml(shortValue)}</span>
                <button class="jira-field-copy-btn" data-copy-value="${this.escapeHtml(field.value)}" title="Копировать">
                  <svg viewBox="0 0 16 16" version="1.1" aria-hidden="true"><path fill-rule="evenodd" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 010 1.5h-1.5a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-1.5a.75.75 0 011.5 0v1.5A1.75 1.75 0 019.25 16h-7.5A1.75 1.75 0 010 14.25v-7.5z"></path><path fill-rule="evenodd" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0114.25 11h-7.5A1.75 1.75 0 015 9.25v-7.5zm1.75-.25a.25.25 0 00-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 00.25-.25v-7.5a.25.25 0 00-.25-.25h-7.5z"></path></svg>
                </button>
              </div>
            `;
          });
        }
      }
      
      additionalFieldsHTML = groupsHTML;
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
          <div class="jira-copypaste-preview-presets">
            <div class="jira-preview-fields-header">
              <strong> Важная информация</strong>
              <small>Пресеты</small>
            </div>
            <div class="jira-preview-fields-container">
              ${importantFieldsHTML}
            </div>
          </div>
          <div class="jira-copypaste-preview-center">
            <div class="jira-copypaste-preview-editor-section">
              <div class="jira-preview-section-label">✏️ Редактирование (с плейсхолдерами)</div>
              <textarea class="jira-copypaste-preview-textarea" spellcheck="false">${content}</textarea>
            </div>
            <div class="jira-copypaste-preview-result-section">
              <div class="jira-preview-section-label">👁️ Результат (что будет скопировано)</div>
              <textarea class="jira-copypaste-preview-result" spellcheck="false"></textarea>
            </div>
          </div>
          <div class="jira-copypaste-preview-right">
            <div class="jira-preview-fields-header">
              <strong>Поля задачи</strong>
              <small>Выберите и вставьте</small>
            </div>
            <div class="jira-preview-fields-container">
              ${smartFieldsHTML}
              ${additionalFieldsHTML}
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
    const resultTextarea = modal.querySelector('.jira-copypaste-preview-result');
    const fieldPills = modal.querySelectorAll('.jira-preview-field-pill');
    const smartFieldInsertBtns = modal.querySelectorAll('.jira-smart-field-insert-btn');

    // НОВОЕ: Обработчики кнопок копирования полей
    modal.querySelectorAll('.jira-field-copy-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent triggering radio/pill click
        let value = btn.dataset.copyValue;
        if (value) {
          // Нормализуем пробелы: заменяем любые последовательности пробельных символов на один пробел
          value = value.replace(/\s+/g, ' ').trim();
          
          try {
            await navigator.clipboard.writeText(value);
            
            // Visual feedback
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<span style="font-size: 14px; color: #22C55E;">✓</span>';
            
            setTimeout(() => {
              btn.innerHTML = originalHTML;
            }, 1000);
            
          } catch (err) {
            console.error('Failed to copy:', err);
          }
        }
      });
    });

    // НОВОЕ: Функция получения выбранных значений из умных полей
    const getSmartFieldValues = () => {
      const values = {};
      for (const category of ['fullname', 'address', 'telegram', 'phone', 'equipment', 'peripherals', 'description']) {
        const radio = modal.querySelector(`input[name="smart-field-${category}"]:checked`);
        if (radio) {
          values[category] = radio.value;
        }
      }
      return values;
    };

    // Функция замены плейсхолдеров на реальные значения
    const replacePlaceholders = (text) => {
      if (!issueData || !issueData.fields) return text;
      
      let result = text;
      
      // НОВОЕ: Заменяем умные плейсхолдеры на выбранные значения
      const smartValues = getSmartFieldValues();
      for (const [category, value] of Object.entries(smartValues)) {
        const config = this.smartFieldConfig[category];
        if (config && value) {
          const placeholder = new RegExp(`{{${config.placeholder}}}`, 'g');
          result = result.replace(placeholder, value);
        }
      }
      
      // НОВОЕ: Аккуратно обрабатываем незамещённые умные плейсхолдеры.
      // Вместо удаления всей строки – удаляем ТОЛЬКО сам токен. Строка остаётся,
      // и если после удаления она пуста (только пробелы/точки), будет очищена позже.
      const smartPlaceholders = Object.values(this.smartFieldConfig).map(c => c.placeholder);
      result = result
        .split('\n')
        .map(line => {
          let processed = line;
          smartPlaceholders.forEach(ph => {
            if (processed.includes(`{{${ph}}}`)) {
              // Заменяем незаполненный плейсхолдер на '' (без пробела чтобы не оставлять хвосты)
              processed = processed.replace(new RegExp(`{{${ph}}}`, 'g'), '');
            }
          });
          // Убираем лишние двойные пробелы, ведущие/концевые пробелы
          processed = processed.replace(/\s{2,}/g, ' ').replace(/^\s+$/,'');

          return processed;
        })
        .filter(line => line.trim() !== '')
        .join('\n');
      
      // Заменяем плейсхолдеры полями из issueData
      for (const [fieldId, fieldData] of Object.entries(issueData.fields)) {
        const placeholder = new RegExp(`{{${fieldId}}}`, 'g');
        const value = fieldData.value || '';
        result = result.replace(placeholder, value);
      }
      
      // Заменяем стандартные плейсхолдеры (legacy)
      result = result
        .replace(/{{TASK_ID}}/g, this.currentIssueKey || '')
        .replace(/{{issueKey}}/g, this.currentIssueKey || '')
        .replace(/{{USER_NAME}}/g, issueData.fields?.customfield_10989?.value || '')
        .replace(/{{EQUIPMENT}}/g, issueData.fields?.customfield_11122?.value || '')
        .replace(/{{ADDRESS}}/g, issueData.fields?.customfield_11120?.value || '')
        .replace(/{{SUMMARY}}/g, issueData.fields?.summary?.value || '');

      //  Убираем пустые строки, оставшиеся после удаления
      result = result.replace(/\n{3,}/g, '\n\n'); // Максимум 2 переноса подряд
      
      return result;
    };

    // Обновление панели результата
    const updateResultPreview = () => {
      const replacedText = replacePlaceholders(textarea.value);
      resultTextarea.value = replacedText;
    };

    // Первоначальное обновление результата
    updateResultPreview();

    // Автофокус на текстовую область и выделение всего текста
    setTimeout(() => {
      textarea.focus();
      textarea.select();
    }, 100);

    // НОВОЕ: Обновление результата при изменении выбранных полей
    modal.querySelectorAll('input[type="radio"]').forEach(radio => {
      radio.addEventListener('change', updateResultPreview);
    });

    // Обновление результата при изменении текста
    textarea.addEventListener('input', updateResultPreview);
    
    // НОВОЕ: Обработчики кнопок "Вставить" для умных полей
    smartFieldInsertBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const placeholder = btn.dataset.placeholder;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        
        textarea.value = text.substring(0, start) + placeholder + text.substring(end);
        textarea.focus();
        textarea.selectionEnd = start + placeholder.length;
        
        updateResultPreview();
      });
    });

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
      const textToCopy = resultTextarea.value;
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
