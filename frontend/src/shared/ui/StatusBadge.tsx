import type { JobStatus, UrlStatus } from '@/features/jobs/types';
import { useI18n } from '@/shared/i18n/i18n';
import type { TranslationKey } from '@/shared/i18n/translations';

export function StatusBadge({ status }: { status: JobStatus | UrlStatus }) {
  const { t } = useI18n();
  const key = `status.${status}` as TranslationKey;
  return <span className={`badge badge--${status}`}>{t(key)}</span>;
}
