// Главный скрипт расширения для добавления заметок к задачам Jira

class JiraNotesExtension {
  constructor() {
    this.currentIssueKey = null;
    this.notesContainer = null;
    this.initialized = false;
    this.isUpdating = false; // Флаг для предотвращения множественных обновлений
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
  start() {
    this.detectIssueKey();
    this.injectNotesPanel();
    this.setupObserver();
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
      console.log('♻️ Panel already exists, updating...');
      const title = existingPanel.querySelector('.jira-notes-title');
      if (title) {
        title.textContent = this.currentIssueKey;
      }
      existingPanel.style.display = 'block';
      await this.loadNotes();
      return;
    }

    // Ждем загрузки бокового окна Jira
    console.log('⏳ Waiting for Jira modal to fully load...');
    await this.waitForJiraModal();
    
    console.log('🎨 Creating panel for', this.currentIssueKey);
    
    // Создаем панель
    const panel = this.createNotesPanel();
    
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
  createNotesPanel() {
    const panel = document.createElement('div');
    panel.className = 'jira-notes-panel jira-notes-floating';
    panel.setAttribute('data-jira-notes-panel', 'true');
    panel.style.cssText = `
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      position: fixed !important;
      z-index: 999999 !important;
      pointer-events: auto !important;
    `;
    
    panel.innerHTML = `
      <div class="jira-notes-header" id="jira-notes-drag-handle">
        <div class="jira-notes-header-content">
          <span class="jira-notes-icon">�</span>
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
            <button class="jira-status-btn" data-status="red" title="Проблема / Срочно">
              <span class="status-dot status-red"></span>
              🔴 Проблема
            </button>
            <button class="jira-status-btn" data-status="yellow" title="В процессе / Ожидание">
              <span class="status-dot status-yellow"></span>
              🟡 В процессе
            </button>
            <button class="jira-status-btn" data-status="green" title="Готово / ОК">
              <span class="status-dot status-green"></span>
              🟢 Готово
            </button>
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

  // Защита панели от удаления
  protectPanel(panel) {
    // Устанавливаем максимальный z-index
    panel.style.zIndex = '999999';
    
    let removalCount = 0;
    let hideCount = 0;
    
    // Периодически проверяем, что панель на месте
    const protectionInterval = setInterval(() => {
      if (!document.body.contains(panel)) {
        removalCount++;
        console.log(`⚠️ [${removalCount}] Panel was REMOVED from DOM, re-adding...`);
        document.body.appendChild(panel);
        panel.style.zIndex = '999999';
        panel.style.display = 'block';
      }
      
      // Убеждаемся что панель видима если есть задача
      if (this.currentIssueKey) {
        const computedStyle = window.getComputedStyle(panel);
        if (computedStyle.display === 'none' || computedStyle.visibility === 'hidden' || computedStyle.opacity === '0') {
          hideCount++;
          console.log(`⚠️ [${hideCount}] Panel is HIDDEN (display: ${computedStyle.display}, visibility: ${computedStyle.visibility}, opacity: ${computedStyle.opacity})`);
          panel.style.display = 'block';
          panel.style.visibility = 'visible';
          panel.style.opacity = '1';
        }
      }
    }, 500); // Проверяем каждые 500мс
    
    // Наблюдаем за изменениями атрибутов панели
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
          const currentDisplay = panel.style.display;
          if (currentDisplay === 'none' || currentDisplay === '') {
            console.log('🔴 MutationObserver caught style change to hide panel!');
            panel.style.display = 'block';
            panel.style.visibility = 'visible';
            panel.style.opacity = '1';
          }
        }
      });
    });
    
    observer.observe(panel, {
      attributes: true,
      attributeFilter: ['style', 'class']
    });
    
    // Дополнительная защита - перехватываем попытки изменить display
    const originalSetAttribute = panel.setAttribute.bind(panel);
    panel.setAttribute = function(name, value) {
      if (name === 'style' && (value.includes('display: none') || value.includes('display:none'))) {
        console.log('🔴 Blocked setAttribute attempt to hide panel');
        return;
      }
      return originalSetAttribute(name, value);
    };
  }

  // Привязываем обработчики событий
  attachEventListeners(panel) {
    const textarea = panel.querySelector('.jira-notes-textarea');
    const closeButton = panel.querySelector('.jira-notes-close');
    const statusButtons = panel.querySelectorAll('.jira-status-btn');

    // Автосохранение при вводе (с задержкой)
    let saveTimeout;
    textarea.addEventListener('input', () => {
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => this.saveNotes(), 1000);
    });

    // Закрытие окна (не удаляем, просто скрываем)
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.style.display = 'none';
      console.log('Panel hidden by user');
    });

    // Обработчики статусов
    statusButtons.forEach(button => {
      button.addEventListener('click', () => {
        const status = button.getAttribute('data-status');
        this.setStatus(status);
        
        // Также пробуем извлечь адрес при установке статуса
        this.extractAndSaveAddress();
      });
    });

    // Горячие клавиши
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
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
      await chrome.storage.local.set({
        'panel_position': position
      });
    } catch (error) {
      console.error('Error saving position:', error);
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
      
      // Автоматически извлекаем и сохраняем адрес при открытии задачи
      await this.extractAndSaveAddress();
      
      // Обновляем карточки на доске
      setTimeout(() => {
        this.updateAllCards();
      }, 500);
    } catch (error) {
      console.error('Error loading notes:', error);
    }
  }

  // Извлекаем и сохраняем адрес из открытой задачи
  async extractAndSaveAddress() {
    console.log('🔍 Starting address extraction...');
    
    // Пытаемся найти поле адреса несколько раз
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      // Ищем поле "Офис или Адрес" в открытой задаче
      const addressField = document.querySelector('[data-testid="issue.views.field.single-line-text.read-view.customfield_11120"]');
      
      if (addressField) {
        const address = addressField.textContent.trim();
        
        if (address) {
          console.log(`✅ Found address on attempt ${attempts}: "${address}"`);

          // Сохраняем адрес для этой задачи
          if (this.currentIssueKey) {
            await chrome.storage.local.set({
              [`address_${this.currentIssueKey}`]: address
            });
            console.log(`💾 Address saved: ${this.currentIssueKey} -> ${address}`);
            
            // Обновляем карточки
            setTimeout(() => this.updateAllCards(), 500);
          }
          return; // Успешно нашли и сохранили
        } else {
          console.log(`⚠️ Attempt ${attempts}: Field found but empty`);
        }
      } else {
        console.log(`⚠️ Attempt ${attempts}: Address field not found yet`);
      }
      
      // Ждем перед следующей попыткой
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    console.log('❌ Address field not found after all attempts');
  }

  // Сохранение заметок
  async saveNotes(showNotification = false) {
    const textarea = document.querySelector('.jira-notes-textarea');
    if (!textarea) return;

    const notes = textarea.value;
    const noteKey = `note_${this.currentIssueKey}`;

    try {
      await chrome.storage.local.set({
        [noteKey]: notes
      });

      console.log('Notes saved for', this.currentIssueKey);
    } catch (error) {
      console.error('Error saving notes:', error);
    }
  }

  // Установка статуса
  async setStatus(status) {
    const statusKey = `status_${this.currentIssueKey}`;

    try {
      if (status) {
        await chrome.storage.local.set({
          [statusKey]: status
        });
        console.log(`✅ Status "${status}" saved for ${this.currentIssueKey}`);
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

  // Обновляем ВСЕ карточки на доске
  async updateAllCards() {
    // Если уже идет обновление, пропускаем
    if (this.isUpdating) {
      console.log('⏭️ Skipping update - already in progress');
      return;
    }
    
    this.isUpdating = true;
    
    try {
      // Сначала удаляем ВСЕ наши элементы со страницы
      document.querySelectorAll('.jira-personal-status').forEach(el => el.remove());
      document.querySelectorAll('.jira-personal-address-inline').forEach(el => el.remove());
      
      // Получаем все сохраненные данные
      const allData = await chrome.storage.local.get(null);
      
      // Собираем статусы и адреса
      const statuses = {};
      const addresses = {};
      
      Object.keys(allData).forEach(key => {
        if (key.startsWith('status_')) {
          const issueKey = key.replace('status_', '');
          statuses[issueKey] = allData[key];
        }
        if (key.startsWith('address_')) {
          const issueKey = key.replace('address_', '');
          addresses[issueKey] = allData[key];
        }
      });

      console.log(`🔄 Updating ${Object.keys(statuses).length} statuses and ${Object.keys(addresses).length} addresses`);
      if (Object.keys(addresses).length > 0) {
        console.log(' Addresses:', addresses);
      }

      // Ищем все карточки по разным селекторам
      const allCards = document.querySelectorAll('[data-testid*="platform-card"], [data-testid*="card"], div[draggable="true"]');
      
      console.log(`🎴 Found ${allCards.length} cards on board`);
      
      allCards.forEach(card => {
        // Ищем ссылку с номером задачи внутри карточки
        const link = card.querySelector('a[href*="/browse/"], a[href*="selectedIssue="]');
        if (!link) return;
        
        const href = link.href || '';
        const text = link.textContent.trim();
        const issueMatch = href.match(/([A-Z]+-\d+)/) || text.match(/^([A-Z]+-\d+)$/);
        
        if (!issueMatch) return;
        
        const issueKey = issueMatch[1];
        
        // Только для первой карточки с адресом выводим структуру
        if (addresses[issueKey] && !window._jiraDebugDone) {
          console.log(`🔍 DEBUG: Card structure for ${issueKey}:`, card);
          console.log(`🔍 Link element:`, link);
          console.log(`🔍 Link parent:`, link.parentElement);
          window._jiraDebugDone = true;
        }
        
        card.style.position = 'relative';

        // Добавляем статус (точка в правом верхнем углу) ОДИН РАЗ
        if (statuses[issueKey]) {
          // Проверяем, нет ли уже статуса на этой карточке
          if (!card.querySelector('.jira-personal-status')) {
            const statusDot = document.createElement('div');
            statusDot.className = `jira-personal-status status-${statuses[issueKey]}`;
            statusDot.title = `Статус: ${statuses[issueKey] === 'red' ? 'Проблема' : statuses[issueKey] === 'yellow' ? 'В процессе' : 'Готово'}`;
            statusDot.setAttribute('data-issue-key', issueKey);
            card.appendChild(statusDot);
          }
        }

        // Добавляем адрес ВМЕСТО/РЯДОМ с номером задачи
        if (addresses[issueKey]) {
          console.log(`✏️ Adding address to ${issueKey}: ${addresses[issueKey]}`);
          
          // Простой способ - добавляем адрес прямо к ссылке
          if (link && !link.querySelector('.jira-personal-address-inline')) {
            // Скрываем текст с номером задачи
            const childDivs = link.querySelectorAll('div');
            childDivs.forEach(div => {
              if (div.textContent.includes(issueKey)) {
                div.style.display = 'none';
              }
            });
            
            // Создаем адрес
            const addressSpan = document.createElement('div');
            addressSpan.className = 'jira-personal-address-inline';
            addressSpan.textContent = ` ${addresses[issueKey]}`;
            addressSpan.title = `Адрес: ${addresses[issueKey]} (${issueKey})`;
            addressSpan.style.cssText = `
              display: inline-block !important;
              background: linear-gradient(135deg, #0052CC 0%, #0747A6 100%) !important;
              color: white !important;
              padding: 4px 10px !important;
              border-radius: 6px !important;
              font-size: 13px !important;
              font-weight: 700 !important;
              white-space: nowrap !important;
              box-shadow: 0 2px 8px rgba(0, 82, 204, 0.3) !important;
              letter-spacing: 0.3px !important;
              max-width: 200px !important;
              overflow: hidden !important;
              text-overflow: ellipsis !important;
            `;
            
            // Добавляем адрес в ссылку
            link.appendChild(addressSpan);
            
            console.log(`✅ Address added successfully to ${issueKey}`);
          }
        }
      });
    
    } finally {
      // Снимаем флаг обновления
      this.isUpdating = false;
    }
  }

  // Показываем статус операции
  showStatus(message, type = 'info') {
    console.log('Status:', message, type);
  }

  // Наблюдатель за изменениями в DOM (для SPA)
  setupObserver() {
    let lastIssueKey = this.currentIssueKey;

    const observer = new MutationObserver((mutations) => {
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

      // Проверяем, добавились ли новые карточки на доску
      const hasNewCards = Array.from(mutations).some(mutation => {
        return Array.from(mutation.addedNodes).some(node => {
          if (node.nodeType === 1) {
            return node.matches && (
              node.matches('[data-testid*="card"]') ||
              node.matches('a[href*="browse"]') ||
              node.querySelector('a[href*="browse"]')
            );
          }
          return false;
        });
      });

      if (hasNewCards) {
        console.log('🔄 New cards detected, updating...');
        setTimeout(() => this.updateAllCards(), 300);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Дополнительно следим за изменениями URL
    this.watchUrlChanges();
    
    // Периодически обновляем карточки (каждые 5 секунд вместо 3)
    setInterval(() => {
      this.updateAllCards();
    }, 5000);
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
