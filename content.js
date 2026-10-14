/**
 * YouTube GIF Blocker — content.js
 *
 * Второй рубеж: JS полностью удаляет GIF-элементы из DOM,
 * освобождая память от декодированных анимаций.
 *
 * Архитектура:
 *  1. scanAndRemove()       — синхронная функция очистки одного набора узлов
 *  2. scheduleCleanup()     — дебаунс + requestAnimationFrame для троттлинга
 *  3. MutationObserver      — отслеживает появление новых узлов в SPA
 *  4. Защитные предикаты    — isGifElement() / isSafeElement() как whitelist/blacklist
 */

'use strict';

// ─── Константы ──────────────────────────────────────────────────────────────

/**
 * Паттерны URL, указывающие на анимированный GIF-контент.
 * @type {string[]}
 */
const GIF_URL_PATTERNS = [
  '.gif',
  'giphy.com', 'media.giphy',
  'tenor.com', 'media.tenor', 'c.tenor.com',
  // YouTube Shorts стикеры — хранятся на gstatic и yt3
  'sticker',          // URL содержит "sticker" — yt3.ggpht.com/.../sticker/...
  'gstatic.com/youtube/img/emojis', // WebP-эмодзи-стикеры
  '/stickers/',
  'lh3.googleusercontent.com/stickers',
  // YouTube Image Comments (фото/стикеры в комментариях, CDN-путь /c_exp/)
  '/c_exp/',          // i.ytimg.com/c_exp/<commentId>/...
];

/**
 * CSS-селекторы контейнеров, внутри которых ищем медиа-вставки.
 * Ограничиваем область поиска для производительности.
 * @type {string}
 */
const COMMENT_SCOPES = [
  'ytd-comment-thread-renderer',
  'ytd-comment-renderer',
  'ytd-backstage-post-renderer',
  '#chat',
  'yt-live-chat-renderer',
  'ytd-attachment-renderer',
  '#content-text',
].join(', ');

/**
 * Элементы, которые НЕЛЬЗЯ трогать ни при каких условиях.
 * @type {string[]}
 */
const SAFE_SELECTORS = [
  'yt-img-shadow[is-avatar]', // аватарки пользователей
  'yt-emoji',                 // встроенные эмодзи YouTube
  'ytd-thumbnail',            // превью видео
  '#logo',                    // логотип YouTube
  'yt-icon',                  // иконки интерфейса
];

/** Задержка дебаунса в мс — достаточно мала для отзывчивости, не создаёт jank */
const DEBOUNCE_DELAY_MS = 80;

// ─── Утилиты ────────────────────────────────────────────────────────────────

/**
 * Проверяет, содержит ли URL один из GIF-паттернов.
 * @param {string|null} url
 * @returns {boolean}
 */
function isGifUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return GIF_URL_PATTERNS.some(pattern => lower.includes(pattern));
}

/**
 * Проверяет, находится ли элемент внутри защищённого (safe) контейнера.
 * Используется для защиты аватарок и превью.
 * @param {Element} el
 * @returns {boolean}
 */
function isInsideSafeContainer(el) {
  return SAFE_SELECTORS.some(selector => el.closest(selector) !== null);
}

/**
 * Определяет, является ли элемент GIF-медиа, подлежащим удалению.
 * Работает как whitelist: проходит только явно опасный контент.
 * @param {Element} el
 * @returns {boolean}
 */
function isGifElement(el) {
  const tag = el.tagName;

  if (tag === 'IMG') {
    // Прямая проверка src
    if (isGifUrl(el.src)) return true;
    // Проверка data-атрибутов (ленивая загрузка)
    if (isGifUrl(el.dataset.src)) return true;
    if (isGifUrl(el.getAttribute('data-thumb'))) return true;
    return false;
  }

  if (tag === 'VIDEO' || tag === 'SOURCE') {
    return isGifUrl(el.src) || isGifUrl(el.getAttribute('src'));
  }

  // Кастомные теги YouTube для медиа-аттачментов
  if (tag === 'YTD-ATTACHMENT-RENDERER') return true;
  // YouTube Image Comments (стикеры и фото в комментариях) — новая фича 2024
  if (tag === 'YTW-COMMENT-IMAGE-ATTACHMENT-VIEW-MODEL') return true;
  if (tag === 'YT-IMAGE-BANNER-VIEW-MODEL' && el.querySelector('img[src*=".gif"]')) return true;

  // <a> или <div> с фоновым GIF через style
  if (el.style && el.style.backgroundImage && isGifUrl(el.style.backgroundImage)) return true;

  return false;
}

// ─── Ядро блокировки ────────────────────────────────────────────────────────

/**
 * Сканирует переданный список узлов и удаляет GIF-элементы из DOM.
 * Также рекурсивно ищет GIF внутри добавленных поддеревьев.
 *
 * Батчинг через requestAnimationFrame: не блокируем main thread,
 * даём браузеру завершить layout перед модификацией DOM.
 *
 * @param {NodeList|Element[]} nodes - узлы для проверки (от MutationObserver или начальный скан)
 */
function scanAndRemove(nodes) {
  // Собираем всех кандидатов в один массив перед RAF для атомарности
  const toRemove = [];

  for (const node of nodes) {
    if (node.nodeType !== Node.ELEMENT_NODE) continue;

    // Проверяем сам узел
    if (isGifElement(node) && !isInsideSafeContainer(node)) {
      toRemove.push(node);
      continue; // не нужно искать внутри — удалим всё поддерево
    }

    // Ищем GIF-потомков внутри добавленного поддерева
    // querySelectorAll быстрее обхода вручную для небольших деревьев
    const candidates = node.querySelectorAll(
      'img, video, source, ytd-attachment-renderer, [style*="background-image"]'
    );

    for (const candidate of candidates) {
      if (isGifElement(candidate) && !isInsideSafeContainer(candidate)) {
        // Пытаемся удалить наименьший смысловой контейнер вместо голого <img>
        const mediaContainer = findMediaContainer(candidate);
        toRemove.push(mediaContainer);
      }
    }
  }

  if (toRemove.length === 0) return;

  // Батч-удаление в одном кадре — минимизируем reflow
  requestAnimationFrame(() => {
    const BATCH_SIZE = 20;
    let i = 0;

    function removeBatch() {
      const end = Math.min(i + BATCH_SIZE, toRemove.length);
      for (; i < end; i++) {
        const el = toRemove[i];
        if (el && el.isConnected) {
          el.remove(); // убираем из DOM, GC освободит анимацию
        }
      }
      if (i < toRemove.length) {
        // Продолжаем в следующем кадре, не блокируя браузер
        requestAnimationFrame(removeBatch);
      }
    }

    removeBatch();
  });
}

/**
 * Ищет наименьший осмысленный контейнер для удаления.
 * Например, вместо <img> удаляем <ytd-attachment-renderer> или <figure>.
 * Это чище и освобождает больше памяти.
 *
 * @param {Element} el - найденный GIF-элемент
 * @returns {Element} - контейнер для удаления
 */
function findMediaContainer(el) {
  const MEDIA_CONTAINER_TAGS = new Set([
    'YTD-ATTACHMENT-RENDERER',
    'YTD-BACKSTAGE-IMAGE-RENDERER',
    'FIGURE',
    'PICTURE',
  ]);

  let current = el.parentElement;
  let candidate = el;

  // Поднимаемся вверх не более чем на 4 уровня
  for (let depth = 0; depth < 4 && current; depth++) {
    if (MEDIA_CONTAINER_TAGS.has(current.tagName)) {
      candidate = current;
      break;
    }
    // Если контейнер содержит только медиа — удаляем его целиком
    if (current.children.length === 1) {
      candidate = current;
    } else {
      break; // контейнер содержит другой контент — не трогаем его
    }
    current = current.parentElement;
  }

  return candidate;
}

// ─── Дебаунс + Планировщик ───────────────────────────────────────────────────

/**
 * Накапливаем мутации между тиками event loop для пакетной обработки.
 * Избегаем запуска scanAndRemove на каждую из сотен мутаций SPA.
 * @type {Set<Node>}
 */
const pendingNodes = new Set();
let debounceTimer = null;

/**
 * Добавляет узлы в очередь и планирует отложенную очистку.
 * Дебаунс: если мутации продолжают поступать, сброс таймера.
 *
 * @param {NodeList} addedNodes
 */
function scheduleCleanup(addedNodes) {
  for (const node of addedNodes) {
    pendingNodes.add(node);
  }

  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const snapshot = [...pendingNodes];
    pendingNodes.clear();
    scanAndRemove(snapshot);
  }, DEBOUNCE_DELAY_MS);
}

// ─── MutationObserver ────────────────────────────────────────────────────────

/**
 * Наблюдатель за изменениями DOM.
 *
 * subtree: true    — необходимо для SPA: YouTube меняет глубоко вложенные узлы
 * childList: true  — интересуют только добавления/удаления узлов
 * attributes: false — не нужны, снижает нагрузку
 */
const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.addedNodes.length > 0) {
      scheduleCleanup(mutation.addedNodes);
    }
  }
});

// ─── Точка входа ─────────────────────────────────────────────────────────────

/**
 * Инициализация расширения.
 *
 * 1. Немедленный начальный скан (для контента, загруженного до скрипта)
 * 2. Запуск MutationObserver на весь документ
 *
 * run_at: document_start гарантирует, что CSS уже применён.
 * JS запускается как только появится <body>.
 */
function init() {
  // Начальный скан существующего контента
  // (актуально при навигации по SPA без перезагрузки страницы)
  scanAndRemove([document.documentElement]);

  // Запуск наблюдателя
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });
}

// Запускаем сразу или ждём появления <body>
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
