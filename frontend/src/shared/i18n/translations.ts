export type Lang = 'en' | 'ru';

export const LANGS: Lang[] = ['en', 'ru'];

/**
 * Flat translation dictionaries. The English map defines the key set; the
 * Russian map must match it (enforced by the Record type below). Values may
 * contain {placeholders} filled in by the t() helper.
 */
const en = {
  'app.title': 'URL Checker',
  'app.subtitle':
    'Submit a batch of URLs — the service checks each one asynchronously (max 5 at a time) and reports status, HTTP code, and timing.',

  'form.label': 'URLs to check',
  'form.hint': '(one per line)',
  'form.count': '{n} URL(s)',
  'form.submit': 'Start check',
  'form.submitting': 'Starting…',

  'list.recent': 'Recent jobs',
  'list.empty': 'No jobs yet. Start one above.',
  'stats.line': '{checked} of {total} processed · {ok} ok · {failed} error',
  'stats.cancelled': ' · {n} cancelled',

  'detail.selectPrompt': 'Select a job to see its URLs.',
  'detail.loading': 'Loading…',
  'detail.cancel': 'Cancel job',
  'detail.progress': 'Overall progress',

  'table.url': 'URL',
  'table.status': 'Status',
  'table.http': 'HTTP',
  'table.time': 'Time',
  'table.error': 'Error',

  'status.pending': 'Pending',
  'status.in_progress': 'In progress',
  'status.completed': 'Completed',
  'status.cancelled': 'Cancelled',
  'status.failed': 'Failed',
  'status.success': 'OK',
  'status.error': 'Error',

  'time.seconds': '{n}s ago',
  'time.minutes': '{n}m ago',
  'time.hours': '{n}h ago',
} as const;

export type TranslationKey = keyof typeof en;

const ru: Record<TranslationKey, string> = {
  'app.title': 'Проверка URL',
  'app.subtitle':
    'Отправьте список URL — сервис проверяет каждый асинхронно (не более 5 одновременно) и показывает статус, HTTP-код и время.',

  'form.label': 'URL для проверки',
  'form.hint': '(по одному в строке)',
  'form.count': '{n} URL',
  'form.submit': 'Проверить',
  'form.submitting': 'Запуск…',

  'list.recent': 'Последние задачи',
  'list.empty': 'Пока нет задач. Запустите проверку выше.',
  'stats.line': '{checked} из {total} обработано · {ok} успешно · {failed} с ошибкой',
  'stats.cancelled': ' · {n} отменено',

  'detail.selectPrompt': 'Выберите задачу, чтобы увидеть её URL.',
  'detail.loading': 'Загрузка…',
  'detail.cancel': 'Отменить задачу',
  'detail.progress': 'Общий прогресс',

  'table.url': 'URL',
  'table.status': 'Статус',
  'table.http': 'HTTP',
  'table.time': 'Время',
  'table.error': 'Ошибка',

  'status.pending': 'Ожидание',
  'status.in_progress': 'Выполняется',
  'status.completed': 'Завершено',
  'status.cancelled': 'Отменено',
  'status.failed': 'Ошибка',
  'status.success': 'OK',
  'status.error': 'Ошибка',

  'time.seconds': '{n} с назад',
  'time.minutes': '{n} мин назад',
  'time.hours': '{n} ч назад',
};

export const translations: Record<Lang, Record<TranslationKey, string>> = {
  en,
  ru,
};
