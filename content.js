// Главный скрипт расширения для добавления заметок к задачам Jira

class JiraNotesExtension {
  constructor() {
    this.currentIssueKey = null;
    this.notesContainer = null;
    this.initialized = false;
    this.isUpdating = false; // Флаг для предотвращения множественных обновлений
    this.officeDetectionEnabled = true; // По умолчанию включено
    
    // Кеш для оптимизации производительности
    this.statusCache = {}; // { issueKey: status }
    this.addressCache = {}; // { issueKey: address }
    this.codeCache = {}; // { issueKey: code } - кодировки офисов (ХЗ, Гоголь, и т.д.)
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
      { id: 'red', name: 'Проблема', emoji: '🔴', color: '#EF4444' },
      { id: 'yellow', name: 'В процессе', emoji: '🟡', color: '#EAB308' },
      { id: 'purple', name: 'В фокусе', emoji: '🟣', color: '#A855F7' },
      { id: 'green', name: 'Готово', emoji: '🟢', color: '#22C55E' }
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
      { id: 'red', name: 'Проблема', emoji: '🔴', color: '#EF4444' },
      { id: 'yellow', name: 'В процессе', emoji: '🟡', color: '#EAB308' },
      { id: 'purple', name: 'В фокусе', emoji: '🟣', color: '#A855F7' },
      { id: 'green', name: 'Готово', emoji: '🟢', color: '#22C55E' }
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
    
    // Удаляем все старые статусы, адреса и коды
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
    
    // Сбрасываем флаги обработки
    document.querySelectorAll('[data-jira-processed]').forEach(card => {
      card.removeAttribute('data-jira-processed');
    });
    
    console.log('✅ Cleanup complete');
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
    // Загружаем кастомные статусы
    const result = await chrome.storage.local.get('customStatuses');
    const statuses = result.customStatuses || [
      { id: 'red', name: 'Проблема', emoji: '🔴', color: '#EF4444', isDefault: true },
      { id: 'yellow', name: 'В процессе', emoji: '🟡', color: '#EAB308', isDefault: true },
      { id: 'purple', name: 'В фокусе', emoji: '🟣', color: '#A855F7', isDefault: true },
      { id: 'green', name: 'Готово', emoji: '🟢', color: '#22C55E', isDefault: true }
    ];

    const panel = document.createElement('div');
    panel.className = 'jira-notes-panel jira-notes-floating';
    panel.setAttribute('data-jira-notes-panel', 'true');
    // Убираем излишние inline стили - они уже в CSS
    
    // Генерируем кнопки статусов динамически
    const statusButtons = statuses.map(status => `
      <button class="jira-status-btn" data-status="${status.id}" title="${status.name}">
        <span class="status-dot" style="background: ${status.color};"></span>
        ${status.emoji} ${status.name}
      </button>
    `).join('');
    
    panel.innerHTML = `
      <div class="jira-notes-header" id="jira-notes-drag-handle">
        <div class="jira-notes-header-content">
          <span class="jira-notes-icon">📝</span>
          <div class="jira-notes-header-text">
            <div class="jira-notes-header-title">Личные заметки</div>
            <h3 class="jira-notes-title">${this.currentIssueKey}</h3>
          </div>
        </div>
        <button class="jira-notes-close" title="Закрыть">×</button>
      </div>
      <div class="jira-notes-content">
        <div class="jira-notes-markers">
          <div class="jira-notes-markers-label">🎯 Статус задачи:</div>
          <div class="jira-notes-markers-container">
            ${statusButtons}
            <button class="jira-status-btn clear-status" data-status="" title="Очистить статус">
              <span class="status-dot status-gray"></span>
              Очистить
            </button>
          </div>
        </div>
        <div class="jira-notes-textarea-wrapper">
          <label class="jira-notes-textarea-label">💬 Ваши заметки:</label>
          <textarea 
            class="jira-notes-textarea" 
            placeholder="Добавьте личную заметку к этой задаче..."
            rows="4"
          ></textarea>
        </div>
        <div class="jira-notes-footer">
          <span class="jira-notes-info">💾 Автосохранение</span>
        </div>
      </div>
    `;

    // Добавляем обработчики событий
    this.attachEventListeners(panel);
    
    // Восстанавливаем позицию
    this.restorePosition(panel);
    
    // Делаем перетаскиваемым
    this.makeDraggable(panel);
    
    // Защита от удаления
    this.protectPanel(panel);

    console.log('✅ Panel created successfully');
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
    const statusButtons = panel.querySelectorAll('.jira-status-btn');

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

      if (position && position.left && position.top) {
        // Парсим значения (могут быть как числа, так и строки с 'px')
        const savedLeft = parseInt(position.left);
        const savedTop = parseInt(position.top);
        
        // Проверяем, что позиция в пределах экрана
        const maxLeft = window.innerWidth - 300; // 280px ширина панели + запас
        const maxTop = window.innerHeight - 200; // минимальная высота панели
        
        const safeLeft = Math.max(20, Math.min(savedLeft, maxLeft));
        const safeTop = Math.max(20, Math.min(savedTop, maxTop));
        
        console.log(` Restoring position: saved(${savedLeft}, ${savedTop}) -> safe(${safeLeft}, ${safeTop}), screen(${window.innerWidth}x${window.innerHeight})`);
        
        panel.style.left = safeLeft + 'px';
        panel.style.top = safeTop + 'px';
        panel.style.right = 'auto';
      } else {
        // Позиция по умолчанию - правый верхний угол
        const defaultLeft = window.innerWidth - 300;
        panel.style.left = defaultLeft + 'px';
        panel.style.top = '20px';
        panel.style.right = 'auto';
        console.log(` Using default position: (${defaultLeft}, 20), screen(${window.innerWidth}x${window.innerHeight})`);
      }
    } catch (error) {
      console.error('Error restoring position:', error);
      // Fallback на правый верхний угол
      panel.style.left = (window.innerWidth - 300) + 'px';
      panel.style.top = '20px';
      panel.style.right = 'auto';
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
      const noteKey = `note_${this.currentIssueKey}`;
      const statusKey = `status_${this.currentIssueKey}`;
      const result = await chrome.storage.local.get([noteKey, statusKey]);
      
      const notes = result[noteKey] || '';
      const status = result[statusKey] || '';
      
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

  // Извлекаем и сохраняем адрес из открытой задачи - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ v2
  async extractAndSaveAddress() {
    console.log('🔍 Starting address extraction...');
    
    // Уменьшаем количество попыток и задержку
    const maxAttempts = 3; // Уменьшили с 5 до 3
    const attemptDelay = 200; // Уменьшили с 300 до 200мс
    
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
            
            // Обновляем карточки только если адрес изменился
            setTimeout(() => this.updateAllCards(), 300); // Уменьшили с 500 до 300
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

  // Нормализация текста для сравнения адресов (улучшенная версия)
  normalizeAddress(text) {
    if (!text) return '';
    return text
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
  }

  // Извлекаем кодировку офиса из двух полей Jira - ОПТИМИЗИРОВАННАЯ ВЕРСИЯ v2
  async extractAndSaveOfficeCode() {
    console.log('🏢 Starting office code extraction...');
    
    const maxAttempts = 3; // Уменьшили с 5 до 3
    const attemptDelay = 200; // Уменьшили с 300 до 200мс
    
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
            
            // Обновляем карточки
            setTimeout(() => this.updateAllCards(), 300); // Уменьшили задержку с 500 до 300
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
        
        // 5. Попробуем найти read-view для текстовых полей (общий случай)
        if (!fieldValue) {
          const readView = document.querySelector(`[data-testid*="read-view.${fieldId}"]`);
          if (readView) {
            fieldValue = readView.textContent.trim();
          }
        }
        
        // 6. Если не нашли, попробуем найти inline-edit контейнер
        if (!fieldValue) {
          const inlineEdit = document.querySelector(`[data-testid*="${fieldId}--container"]`);
          if (inlineEdit) {
            fieldValue = inlineEdit.textContent.trim();
          }
        }
        
        // 7. Для user полей
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
        const placeholders = ['Нет', 'Введите текст', 'Добавьте варианты', 'Добавьте дату', 'Выбрать', 'Редактировать'];
        
        // Также удаляем aria-label из значения
        if (fieldValue) {
          // Удаляем текст кнопок редактирования, который может попасть в значение
          fieldValue = fieldValue.replace(/Редактировать поле «.*?»/g, '').trim();
          fieldValue = fieldValue.replace(/Добавить.*?, edit/g, '').trim();
          fieldValue = fieldValue.replace(/Изменить.*?, edit/g, '').trim();
          fieldValue = fieldValue.replace(/Отредактировать поле.*?edit/g, '').trim();
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

      // Сохраняем в localStorage
      const dataKey = `issuedata_${this.currentIssueKey}`;
      await chrome.storage.local.set({
        [dataKey]: issueData
      });

      console.log(`✅ Full issue data saved for ${this.currentIssueKey}:`, customFields.size, 'custom fields');
      return issueData;

    } catch (error) {
      console.error('❌ Error extracting issue data:', error);
      return null;
    }
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
    const noteKey = `note_${this.currentIssueKey}`;

    try {
      // Если включена синхронизация - сохраняем через sync service
      if (this.syncMode === 'team' && syncService && this.syncInitialized) {
        const currentStatus = await chrome.storage.local.get(`status_${this.currentIssueKey}`);
        const currentAddress = await chrome.storage.local.get(`address_${this.currentIssueKey}`);
        
        await syncService.saveNote(this.currentIssueKey, {
          text: notes,
          status: currentStatus[`status_${this.currentIssueKey}`] || null,
          address: currentAddress[`address_${this.currentIssueKey}`] || null
        });
        
        console.log('💾 Notes synced for', this.currentIssueKey);
      } else {
        // Локальное сохранение
        await chrome.storage.local.set({
          [noteKey]: notes
        });
        console.log('📝 Notes saved locally for', this.currentIssueKey);
      }
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

  // Обновляем ВСЕ карточки на доске (МОМЕНТАЛЬНАЯ ВЕРСИЯ v4 - без задержек)
  async updateAllCards() {
    // Проверяем, что контекст расширения еще валиден
    if (!chrome.runtime?.id) {
      // Показываем уведомление пользователю один раз
      if (!this.contextInvalidatedShown) {
        this.contextInvalidatedShown = true;
        this.showReloadNotification();
      }
      return;
    }
    
    // УБИРАЕМ debouncing и проверку isUpdating - обрабатываем мгновенно
    const now = Date.now();
    this.lastUpdateTime = now;
    
    try {
      // Получаем все сохраненные данные ОДИН РАЗ
      const allData = await chrome.storage.local.get(null);
      
      // Обновляем кеш только если данные изменились
      const newStatusCache = {};
      const newAddressCache = {};
      const newCodeCache = {};
      
      for (const key in allData) {
        if (key.startsWith('status_')) {
          newStatusCache[key.replace('status_', '')] = allData[key];
        } else if (key.startsWith('address_')) {
          newAddressCache[key.replace('address_', '')] = allData[key];
        } else if (key.startsWith('code_')) {
          newCodeCache[key.replace('code_', '')] = allData[key];
        }
      }
      
      // ОПТИМИЗАЦИЯ: Быстрое сравнение по размеру вместо JSON.stringify
      const statusChanged = Object.keys(this.statusCache).length !== Object.keys(newStatusCache).length ||
                            !this.compareObjects(this.statusCache, newStatusCache);
      const addressChanged = Object.keys(this.addressCache).length !== Object.keys(newAddressCache).length ||
                              !this.compareObjects(this.addressCache, newAddressCache);
      const codeChanged = Object.keys(this.codeCache).length !== Object.keys(newCodeCache).length ||
                          !this.compareObjects(this.codeCache, newCodeCache);
      
      if (statusChanged || addressChanged || codeChanged) {
        this.statusCache = newStatusCache;
        this.addressCache = newAddressCache;
        this.codeCache = newCodeCache;
        
        // Если данные изменились - убираем ВСЕ старые элементы и сбрасываем флаги обработки
        document.querySelectorAll('.jira-personal-status').forEach(el => el.remove());
        document.querySelectorAll('.jira-personal-address-inline').forEach(el => el.remove());
        document.querySelectorAll('.jira-personal-code-inline').forEach(el => el.remove());
        document.querySelectorAll('[data-jira-processed]').forEach(card => {
          card.removeAttribute('data-jira-processed');
        });
        
        console.log(`📦 Cache updated: ${Object.keys(this.statusCache).length} statuses, ${Object.keys(this.addressCache).length} addresses, ${Object.keys(this.codeCache).length} codes`);
      } else {
        console.log('✅ Cache unchanged, only processing new cards');
      }

      // Ищем все карточки - используем более специфичный селектор
      const allCards = document.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
      
      if (allCards.length === 0) {
        console.log('⚠️ No cards found on board');
        return;
      }
      
      console.log(`🎴 Processing ${allCards.length} cards (INSTANT MODE)`);
      
      let newCardsCount = 0;
      
      // МГНОВЕННАЯ ОБРАБОТКА: Обрабатываем ВСЕ карточки синхронно, без батчей
      allCards.forEach(cardContainer => {
        // Ищем ссылку с номером задачи ВНУТРИ
        const link = cardContainer.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
        if (!link) return;
        
        const href = link.href || '';
        const issueMatch = href.match(/([A-Z]+-\d+)/);
        
        if (!issueMatch) return;
        
        const issueKey = issueMatch[1];
        
        // ПРОВЕРКА: есть ли уже элементы на КОНТЕЙНЕРЕ карточки
        const hasStatus = cardContainer.querySelector('.jira-personal-status');
        const hasAddress = link.querySelector('.jira-personal-address-inline');
        const hasCode = link.querySelector('.jira-personal-code-inline');
        const isProcessed = cardContainer.hasAttribute('data-jira-processed');
        
        // Если карточка УЖЕ обработана И элементы есть - пропускаем
        // Учитываем, что если автоопределение отключено, то адрес и код не проверяем
        const requiredElementsPresent = this.officeDetectionEnabled 
          ? (hasStatus && (hasAddress || hasCode))
          : hasStatus;
        
        if (isProcessed && requiredElementsPresent) {
          return;
        }
        
        // Если частично обработана - докручиваем недостающее
        if (!isProcessed) {
          newCardsCount++;
          cardContainer.setAttribute('data-jira-processed', 'true');
          cardContainer.style.position = 'relative';
        }

        // Статус отображаем только на ВЕРХНЕМ КОНТЕЙНЕРЕ карточки (один раз!)
        if (this.statusCache[issueKey] && !hasStatus) {
          // Получаем метаданные статуса из кеша (синхронно)
          const statusData = this.statusesMetadata[this.statusCache[issueKey]] || { 
            name: 'Неизвестно', 
            color: '#9ca3af', 
            emoji: '' 
          };
          
          const statusDot = document.createElement('div');
          statusDot.className = `jira-personal-status`;
          statusDot.style.background = statusData.color;
          statusDot.title = `Статус: ${statusData.name}`;
          statusDot.setAttribute('data-issue-key', issueKey);
          cardContainer.appendChild(statusDot);
        }

        // Добавляем КОД ОФИСА (приоритетнее адреса) - только если автоопределение включено
        if (this.officeDetectionEnabled && this.codeCache[issueKey] && !hasCode) {
          // Скрываем номер задачи
          const childDivs = link.querySelectorAll('div');
          childDivs.forEach(div => {
            if (div.textContent.includes(issueKey) && 
                !div.classList.contains('jira-personal-code-inline') &&
                !div.classList.contains('jira-personal-address-inline')) {
              div.style.display = 'none';
            }
          });
          
          // Создаем элемент с кодом офиса
          const codeSpan = document.createElement('div');
          codeSpan.className = 'jira-personal-code-inline';
          codeSpan.textContent = this.codeCache[issueKey];
          codeSpan.title = `Офис: ${this.codeCache[issueKey]} (${issueKey})`;
          
          // Добавляем стиль для "ХЗ"
          if (this.codeCache[issueKey] === 'ХЗ') {
            codeSpan.style.color = '#9ca3af';
            codeSpan.style.fontStyle = 'italic';
          }
          
          link.appendChild(codeSpan);
        }
        // Если кода нет, добавляем адрес (как было раньше) - только если автоопределение включено
        else if (this.officeDetectionEnabled && this.addressCache[issueKey] && !hasAddress && !hasCode) {
          // Скрываем номер задачи
          const childDivs = link.querySelectorAll('div');
          childDivs.forEach(div => {
            if (div.textContent.includes(issueKey) && !div.classList.contains('jira-personal-address-inline')) {
              div.style.display = 'none';
            }
          });
          
          // Создаем адрес
          const addressSpan = document.createElement('div');
          addressSpan.className = 'jira-personal-address-inline';
          addressSpan.textContent = ` ${this.addressCache[issueKey]}`;
          addressSpan.title = `Адрес: ${this.addressCache[issueKey]} (${issueKey})`;
          
          link.appendChild(addressSpan);
        }
      });
      
      if (newCardsCount > 0) {
        console.log(`✅ Processed ${newCardsCount} NEW cards (${allCards.length - newCardsCount} already done)`);
      } else {
        console.log(`✅ All ${allCards.length} cards already processed`);
      }
    } catch (error) {
      // Игнорируем ошибку Extension context invalidated
      if (error.message?.includes('Extension context invalidated')) {
        return; // Тихо выходим
      } else {
        console.error('❌ Error updating cards:', error);
      }
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

    // Функция для обработки одной карточки синхронно
    this.processCard = (cardContainer) => {
      const link = cardContainer.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
      if (!link) return;
      
      const href = link.href || '';
      const issueMatch = href.match(/([A-Z]+-\d+)/);
      if (!issueMatch) return;
      
      const issueKey = issueMatch[1];
      
      // Проверяем что не обработано
      if (cardContainer.hasAttribute('data-jira-processed')) return;
      
      cardContainer.setAttribute('data-jira-processed', 'true');
      cardContainer.style.position = 'relative';
      
      // Статус
      if (this.statusCache[issueKey]) {
        const statusData = this.statusesMetadata[this.statusCache[issueKey]] || { 
          name: 'Неизвестно', 
          color: '#9ca3af', 
          emoji: '' 
        };
        
        const statusDot = document.createElement('div');
        statusDot.className = 'jira-personal-status';
        statusDot.style.background = statusData.color;
        statusDot.title = `Статус: ${statusData.name}`;
        statusDot.setAttribute('data-issue-key', issueKey);
        cardContainer.appendChild(statusDot);
      }
      
      // Код офиса
      if (this.officeDetectionEnabled && this.codeCache[issueKey]) {
        const childDivs = link.querySelectorAll('div');
        childDivs.forEach(div => {
          if (div.textContent.includes(issueKey) && 
              !div.classList.contains('jira-personal-code-inline') &&
              !div.classList.contains('jira-personal-address-inline')) {
            div.style.display = 'none';
          }
        });
        
        const codeSpan = document.createElement('div');
        codeSpan.className = 'jira-personal-code-inline';
        codeSpan.textContent = this.codeCache[issueKey];
        codeSpan.title = `Офис: ${this.codeCache[issueKey]} (${issueKey})`;
        
        if (this.codeCache[issueKey] === 'ХЗ') {
          codeSpan.style.color = '#9ca3af';
          codeSpan.style.fontStyle = 'italic';
        }
        
        link.appendChild(codeSpan);
      }
      // Адрес (если нет кода)
      else if (this.officeDetectionEnabled && this.addressCache[issueKey]) {
        const childDivs = link.querySelectorAll('div');
        childDivs.forEach(div => {
          if (div.textContent.includes(issueKey) && !div.classList.contains('jira-personal-address-inline')) {
            div.style.display = 'none';
          }
        });
        
        const addressSpan = document.createElement('div');
        addressSpan.className = 'jira-personal-address-inline';
        addressSpan.textContent = ` ${this.addressCache[issueKey]}`;
        addressSpan.title = `Адрес: ${this.addressCache[issueKey]} (${issueKey})`;
        
        link.appendChild(addressSpan);
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
            console.log('🆕 New card detected, observing:', node);
            intersectionObserver.observe(node);
            
            // Если карточка УЖЕ видима - обрабатываем мгновенно
            const rect = node.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
              this.processCard(node);
            }
          }
          // Или внутри добавленного узла есть карточки
          else if (node.querySelectorAll) {
            const cards = node.querySelectorAll('[data-testid="software-board.board-container.board.card-container.card-with-icc"]');
            cards.forEach(card => {
              console.log('🆕 New card detected (nested), observing:', card);
              intersectionObserver.observe(card);
              
              // Если карточка УЖЕ видима - обрабатываем мгновенно
              const rect = card.getBoundingClientRect();
              if (rect.top < window.innerHeight && rect.bottom > 0) {
                this.processCard(card);
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
        intersectionObserver.observe(card);
        
        // Если карточка УЖЕ видима - обрабатываем мгновенно
        const rect = card.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
          this.processCard(card);
        }
      });
    };

    // Запускаем наблюдение с небольшой задержкой для загрузки DOM
    setTimeout(observeBoard, 300);

    // Дополнительно следим за изменениями URL
    this.watchUrlChanges();
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
          } else {
            // Создаем панель если её нет
            this.injectNotesPanel();
          }
          
          // Загружаем новые данные
          setTimeout(() => this.loadNotes(), 300);
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
}

// Запускаем расширение
const extension = new JiraNotesExtension();
extension.init();
