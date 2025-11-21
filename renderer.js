// renderer.js
// Модуль для отрисовки/обновления карточек на доске Jira
// Подключается ДО content.js (добавьте в manifest.json при необходимости)
(function(){
  'use strict';
  /**
   * Модуль отрисовки карточек:
   *  - статус (цветная точка)
   *  - иконка типа устройства
   *  - замена Issue Key на код офиса или адрес
   * Вызывается из content.js через JiraRenderer.applyCardModifications.
   */

  function safeGetUrl(path){
    try { if (chrome.runtime?.id && typeof chrome.runtime.getURL === 'function') return chrome.runtime.getURL(path); } catch(e){ return null; }
    return null;
  }

  function lazyLoadImage(observer, img){
    try {
      if(observer && img.dataset.src){ observer.observe(img); }
      else if(img.dataset.src){ img.src = img.dataset.src; img.removeAttribute('data-src'); }
    } catch(e){ /* ignore */ }
  }

  /**
   * Применяет модификации к карточке.
   * @param {JiraNotesExtension} ext - инстанс основного класса (ожидаем публичные кеши / настройки)
   * @param {HTMLElement} cardContainer - контейнер карточки
   * @param {HTMLAnchorElement} link - ссылка внутри карточки
   * @param {string} issueKey - ключ задачи
   */
  /**
   * Применяет модификации визуализации к карточке.
   * @param {Object} ext - экземпляр основного класса (ожидаем кеши и настройки)
   * @param {HTMLElement} cardContainer - контейнер карточки
   * @param {HTMLAnchorElement} link - ссылка внутри карточки
   * @param {string} issueKey - ключ задачи
   */
  function applyCardModifications(ext, cardContainer, link, issueKey){
    if (!chrome.runtime?.id) return; // контекст расширения потерян

    // DEBUG: Логируем вызов рендерера
    const debugEnabled = ext.debugEnabled || false;
    if (debugEnabled) {
      console.log(`[RENDERER] 🎨 Rendering card ${issueKey}`);
      console.log(`[RENDERER]   - codeCache[${issueKey}]: ${ext.codeCache[issueKey] || 'undefined'}`);
      console.log(`[RENDERER]   - addressCache[${issueKey}]: ${ext.addressCache[issueKey] || 'undefined'}`);
      console.log(`[RENDERER]   - deviceTypeCache[${issueKey}]: ${ext.deviceTypeCache[issueKey] || 'undefined'}`);
    }

    // STATUS DOT
    let statusDot = cardContainer.querySelector('.jira-personal-status');
    if (ext.statusCache[issueKey]) {
      const statusData = ext.statusesMetadata[ext.statusCache[issueKey]] || { name:'Неизвестно', color:'#9ca3af', emoji:'' };
      if(!statusDot){
        statusDot = document.createElement('div');
        statusDot.className = 'jira-personal-status';
        statusDot.setAttribute('data-issue-key', issueKey);
        cardContainer.appendChild(statusDot);
      }
      if(statusDot.style.background !== statusData.color){
        statusDot.style.background = statusData.color;
        statusDot.title = `Статус: ${statusData.name}`;
      }
    } else if(statusDot){ statusDot.remove(); }

    // DEVICE ICON
    let deviceIcon = cardContainer.querySelector('.jira-device-icon');
    if (ext.deviceTypeCache[issueKey]) {
      const deviceType = ext.deviceTypeCache[issueKey];
      if(!deviceIcon){
        deviceIcon = document.createElement('img');
        deviceIcon.className = 'jira-device-icon';
        deviceIcon.setAttribute('loading','lazy');
        deviceIcon.setAttribute('data-issue-key', issueKey);
        cardContainer.appendChild(deviceIcon);
      }
      let iconUrl; let title;
      if(deviceType==='apple'){ iconUrl = safeGetUrl('icons/mac_OS_128px.svg'); title='Apple/MacBook'; }
      else if(deviceType==='windows'){ iconUrl = safeGetUrl('icons/win_128.svg'); title='Windows'; }
      else { iconUrl = safeGetUrl('icons/other.svg'); title='Другое оборудование'; }
      if(iconUrl && deviceIcon.dataset.src !== iconUrl && deviceIcon.src !== iconUrl){
        deviceIcon.dataset.src = iconUrl;
        deviceIcon.title = title;
        lazyLoadImage(ext.lazyImageObserver, deviceIcon);
      }
    } else if(deviceIcon){ deviceIcon.remove(); }

    // OFFICE CODE OR ADDRESS
    // КРИТИЧНО: Сначала удаляем ВСЕ старые элементы с другим issueKey
    const allCodeSpans = link.querySelectorAll('.jira-personal-code-inline');
    const allAddressSpans = link.querySelectorAll('.jira-personal-address-inline');
    
    allCodeSpans.forEach(span => {
      if (span.dataset.issueKey !== issueKey) {
        span.remove();
      }
    });
    
    allAddressSpans.forEach(span => {
      if (span.dataset.issueKey !== issueKey) {
        span.remove();
      }
    });
    
    // Теперь находим актуальные элементы
    let codeSpan = link.querySelector(`.jira-personal-code-inline[data-issue-key="${issueKey}"]`);
    let addressSpan = link.querySelector(`.jira-personal-address-inline[data-issue-key="${issueKey}"]`);

    // Если экстракция ещё в процессе (pending) — НЕ показываем код/адрес и восстанавливаем оригинальный Issue Key
    if (ext.pendingIssues && ext.pendingIssues[issueKey]) {
      if (debugEnabled) console.log(`[RENDERER] ⏳ Pending extraction for ${issueKey}, skip rendering office/address`);
      if (codeSpan) { codeSpan.remove(); codeSpan = null; }
      if (addressSpan) { addressSpan.remove(); addressSpan = null; }
      // Попробуем восстановить скрытые div-ы с issueKey
      const childDivs = link.querySelectorAll('div');
      childDivs.forEach(div => {
        if (div.textContent.includes(issueKey) && div.style.display === 'none') {
          div.style.display = '';
        }
      });
      return; // Ранний выход
    }

    if (ext.officeDetectionEnabled && ext.codeCache[issueKey]) {
      if(debugEnabled) console.log(`[RENDERER] ✅ Setting office code: "${ext.codeCache[issueKey]}" for ${issueKey}`);
      if(addressSpan){ addressSpan.remove(); addressSpan=null; }
      if(!codeSpan){
        const childDivs = link.querySelectorAll('div');
        childDivs.forEach(div => {
          if(div.textContent.includes(issueKey) && !div.classList.contains('jira-personal-code-inline') && !div.classList.contains('jira-personal-address-inline')){
            div.style.display='none';
          }
        });
        codeSpan = document.createElement('div');
        codeSpan.className='jira-personal-code-inline';
        codeSpan.dataset.issueKey = issueKey;
        link.appendChild(codeSpan);
        if(debugEnabled) console.log(`[RENDERER] 🆕 Created new code span for ${issueKey}`);
      }
      if(codeSpan.textContent !== ext.codeCache[issueKey]){
        if(debugEnabled) console.log(`[RENDERER] 📝 Updating code span text: "${codeSpan.textContent}" → "${ext.codeCache[issueKey]}"`);
        codeSpan.textContent = ext.codeCache[issueKey];
        codeSpan.title = `Офис: ${ext.codeCache[issueKey]} (${issueKey})`;
        if(ext.codeCache[issueKey] === 'ХЗ'){ codeSpan.style.color='#9ca3af'; codeSpan.style.fontStyle='italic'; } else { codeSpan.style.color=''; codeSpan.style.fontStyle=''; }
      }
    } else if (ext.officeDetectionEnabled && ext.addressCache[issueKey]) {
      if(codeSpan){ codeSpan.remove(); codeSpan=null; }
      if(!addressSpan){
        const childDivs = link.querySelectorAll('div');
        childDivs.forEach(div => {
          if(div.textContent.includes(issueKey) && !div.classList.contains('jira-personal-code-inline') && !div.classList.contains('jira-personal-address-inline')){
            div.style.display='none';
          }
        });
        addressSpan = document.createElement('div');
        addressSpan.className='jira-personal-address-inline';
        addressSpan.dataset.issueKey = issueKey;
        link.appendChild(addressSpan);
      }
      const newText = ` ${ext.addressCache[issueKey]}`;
      if(addressSpan.textContent !== newText){
        addressSpan.textContent = newText;
        addressSpan.title = `Адрес: ${ext.addressCache[issueKey]} (${issueKey})`;
      }
    } else {
      if(codeSpan) codeSpan.remove();
      if(addressSpan) addressSpan.remove();
    }
  }

  window.JiraRenderer = { applyCardModifications };
})();
