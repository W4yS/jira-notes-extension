// Скрипт для страницы аутентификации

let supabaseClient = null;

// Загрузка конфигурации
async function loadConfig() {
  try {
    const response = await fetch(chrome.runtime.getURL('config.json'));
    const config = await response.json();
    
    if (!config.supabaseUrl || !config.supabaseKey) {
      showMessage('Ошибка: не настроены Supabase URL и ключ в config.json', 'error');
      return null;
    }

    // Показываем конфигурацию (только для отладки)
    document.getElementById('supabase-url').value = config.supabaseUrl;
    document.getElementById('supabase-key').value = config.supabaseKey.substring(0, 20) + '...';

    return config;
  } catch (error) {
    showMessage('Ошибка: не найден файл config.json. Создайте его по инструкции.', 'error');
    console.error(error);
    return null;
  }
}

// Инициализация Supabase
async function initSupabase() {
  const config = await loadConfig();
  if (!config) return false;

  try {
    supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
      }
    });

    // Проверяем, есть ли активная сессия
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (session) {
      showMessage('Вы уже авторизованы! Перенаправление...', 'success');
      setTimeout(() => {
        window.close();
      }, 1500);
      return true;
    }

    return true;
  } catch (error) {
    showMessage('Ошибка подключения к Supabase: ' + error.message, 'error');
    console.error(error);
    return false;
  }
}

// Показать сообщение
function showMessage(text, type = 'info') {
  const messageEl = document.getElementById('message');
  messageEl.textContent = text;
  messageEl.className = 'message ' + type;
  messageEl.style.display = 'block';
}

// Скрыть сообщение
function hideMessage() {
  const messageEl = document.getElementById('message');
  messageEl.style.display = 'none';
}

// Переключение вкладок
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const signinForm = document.getElementById('signin-form');
  const signupForm = document.getElementById('signup-form');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Убираем active у всех вкладок
      tabs.forEach(t => t.classList.remove('active'));
      
      // Добавляем active к текущей
      tab.classList.add('active');
      
      // Показываем нужную форму
      const tabName = tab.getAttribute('data-tab');
      if (tabName === 'signin') {
        signinForm.style.display = 'block';
        signupForm.style.display = 'none';
      } else {
        signinForm.style.display = 'none';
        signupForm.style.display = 'block';
      }
      
      hideMessage();
    });
  });
}

// Обработка формы входа
function setupSignInForm() {
  const form = document.getElementById('signin-form');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!supabaseClient) {
      showMessage('Supabase не инициализирован', 'error');
      return;
    }

    const email = document.getElementById('signin-email').value;
    const password = document.getElementById('signin-password').value;
    const btn = form.querySelector('.btn');

    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>Вход...';
    hideMessage();

    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      showMessage('Успешный вход! Загрузка...', 'success');
      
      // Сохраняем сессию в chrome.storage
      await chrome.storage.local.set({
        supabase_session: data.session,
        user_email: data.user.email
      });

      // Отправляем сообщение в content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'USER_SIGNED_IN',
            user: data.user
          });
        }
      });

      setTimeout(() => {
        window.close();
      }, 1500);

    } catch (error) {
      console.error('Sign in error:', error);
      showMessage('Ошибка входа: ' + error.message, 'error');
      btn.disabled = false;
      btn.innerHTML = 'Войти';
    }
  });
}

// Обработка формы регистрации
function setupSignUpForm() {
  const form = document.getElementById('signup-form');
  
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!supabaseClient) {
      showMessage('Supabase не инициализирован', 'error');
      return;
    }

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const passwordConfirm = document.getElementById('signup-password-confirm').value;
    const btn = form.querySelector('.btn');

    // Валидация
    if (password !== passwordConfirm) {
      showMessage('Пароли не совпадают', 'error');
      return;
    }

    if (password.length < 6) {
      showMessage('Пароль должен быть не менее 6 символов', 'error');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="loading"></span>Регистрация...';
    hideMessage();

    try {
      const { data, error } = await supabaseClient.auth.signUp({
        email,
        password
      });

      if (error) throw error;

      if (data.user) {
        if (data.user.identities && data.user.identities.length === 0) {
          showMessage('Этот email уже зарегистрирован. Попробуйте войти.', 'error');
          btn.disabled = false;
          btn.innerHTML = 'Зарегистрироваться';
          return;
        }

        showMessage(
          'Регистрация успешна! Проверьте email для подтверждения аккаунта.',
          'success'
        );

        // Если требуется подтверждение email
        if (data.session === null) {
          setTimeout(() => {
            // Переключаемся на вход
            document.querySelector('.tab[data-tab="signin"]').click();
          }, 3000);
        } else {
          // Если подтверждение не требуется, сразу входим
          await chrome.storage.local.set({
            supabase_session: data.session,
            user_email: data.user.email
          });

          setTimeout(() => {
            window.close();
          }, 1500);
        }
      }

    } catch (error) {
      console.error('Sign up error:', error);
      showMessage('Ошибка регистрации: ' + error.message, 'error');
      btn.disabled = false;
      btn.innerHTML = 'Зарегистрироваться';
    }
  });
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
  setupTabs();
  setupSignInForm();
  setupSignUpForm();
  
  const initialized = await initSupabase();
  
  if (!initialized) {
    showMessage(
      'Не удалось инициализировать Supabase. Проверьте config.json',
      'error'
    );
  }
});
