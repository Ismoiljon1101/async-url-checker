import { useI18n } from '@/shared/i18n/i18n';
import { LANGS } from '@/shared/i18n/translations';

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="langswitch" role="group" aria-label="Language">
      {LANGS.map((code) => (
        <button
          key={code}
          className={`langswitch__btn ${lang === code ? 'langswitch__btn--active' : ''}`}
          onClick={() => setLang(code)}
          aria-pressed={lang === code}
        >
          {code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
