// Virtual Scrolling для эффективного отображения больших списков
// Рендерит только видимые элементы, экономя память и CPU

class VirtualScroller {
  constructor(container, options = {}) {
    this.container = container;
    this.items = [];
    this.itemHeight = options.itemHeight || 50;
    this.renderItem = options.renderItem || ((item) => this.defaultRender(item));
    this.overscan = options.overscan || 3; // Дополнительные элементы сверху/снизу
    
    this.viewport = null;
    this.content = null;
    this.startIndex = 0;
    this.endIndex = 0;
    this.visibleCount = 0;
    
    this.init();
  }

  init() {
    // Создаем структуру: viewport (с overflow) -> content (с позиционированием)
    this.container.style.position = 'relative';
    this.container.style.overflow = 'auto';
    
    this.content = document.createElement('div');
    this.content.style.position = 'relative';
    this.content.className = 'virtual-scroll-content';
    
    this.container.appendChild(this.content);
    
    // Обработчик скролла
    this.container.addEventListener('scroll', () => this.handleScroll(), { passive: true });
    
    // Обработчик изменения размера
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  // Установить данные для отображения
  setData(items) {
    this.items = items;
    this.updateContentHeight();
    this.calculateVisibleRange();
    this.render();
  }

  // Обновить высоту контента (для корректного скролла)
  updateContentHeight() {
    const totalHeight = this.items.length * this.itemHeight;
    this.content.style.height = `${totalHeight}px`;
  }

  // Рассчитать диапазон видимых элементов
  calculateVisibleRange() {
    const scrollTop = this.container.scrollTop;
    const containerHeight = this.container.clientHeight;
    
    this.visibleCount = Math.ceil(containerHeight / this.itemHeight);
    
    // Добавляем overscan для плавности
    this.startIndex = Math.max(0, Math.floor(scrollTop / this.itemHeight) - this.overscan);
    this.endIndex = Math.min(
      this.items.length,
      this.startIndex + this.visibleCount + this.overscan * 2
    );
  }

  // Отрендерить видимые элементы
  render() {
    // Очищаем контент
    this.content.innerHTML = '';
    
    // Создаем fragment для батчинга
    const fragment = document.createDocumentFragment();
    
    for (let i = this.startIndex; i < this.endIndex; i++) {
      const item = this.items[i];
      const element = this.renderItem(item, i);
      
      // Позиционируем элемент
      element.style.position = 'absolute';
      element.style.top = `${i * this.itemHeight}px`;
      element.style.left = '0';
      element.style.right = '0';
      element.style.height = `${this.itemHeight}px`;
      
      // Добавляем data-атрибуты для отладки
      element.dataset.virtualIndex = i;
      
      fragment.appendChild(element);
    }
    
    this.content.appendChild(fragment);
  }

  // Обработчик скролла (с debounce через RAF)
  handleScroll() {
    if (this.scrollTimeout) return;
    
    this.scrollTimeout = requestAnimationFrame(() => {
      this.calculateVisibleRange();
      this.render();
      this.scrollTimeout = null;
    });
  }

  // Обработчик изменения размера
  handleResize() {
    this.calculateVisibleRange();
    this.render();
  }

  // Дефолтный рендерер элемента
  defaultRender(item) {
    const div = document.createElement('div');
    div.className = 'virtual-scroll-item';
    div.textContent = JSON.stringify(item);
    return div;
  }

  // Скроллить к элементу
  scrollToIndex(index) {
    const targetTop = index * this.itemHeight;
    this.container.scrollTop = targetTop;
  }

  // Обновить один элемент
  updateItem(index, newData) {
    if (index < 0 || index >= this.items.length) return;
    
    this.items[index] = newData;
    
    // Если элемент видим - перерисовываем
    if (index >= this.startIndex && index < this.endIndex) {
      this.render();
    }
  }

  // Добавить элемент
  addItem(item) {
    this.items.push(item);
    this.updateContentHeight();
    
    // Если мы в конце списка - обновляем
    if (this.endIndex === this.items.length - 1) {
      this.calculateVisibleRange();
      this.render();
    }
  }

  // Удалить элемент
  removeItem(index) {
    if (index < 0 || index >= this.items.length) return;
    
    this.items.splice(index, 1);
    this.updateContentHeight();
    this.calculateVisibleRange();
    this.render();
  }

  // Очистить все
  clear() {
    this.items = [];
    this.updateContentHeight();
    this.content.innerHTML = '';
  }

  // Получить текущие видимые индексы
  getVisibleRange() {
    return {
      start: this.startIndex,
      end: this.endIndex,
      count: this.endIndex - this.startIndex
    };
  }

  // Получить статистику
  getStats() {
    return {
      totalItems: this.items.length,
      visibleItems: this.endIndex - this.startIndex,
      renderedItems: this.content.children.length,
      scrollTop: this.container.scrollTop,
      containerHeight: this.container.clientHeight
    };
  }

  // Уничтожить скроллер
  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    
    this.container.removeEventListener('scroll', this.handleScroll);
    this.content.remove();
  }
}

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VirtualScroller;
}
