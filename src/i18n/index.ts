import en from './locales/en';
import zhCN from './locales/zh-CN';
import type { LocaleType } from '../types';

export const LOCALES = {
    en,
    'zh-CN': zhCN
} as const;

export type LocaleKey = keyof typeof LOCALES;

export class I18n {
    private locale: LocaleKey = 'en';

    constructor(locale: LocaleKey = 'en') {
        this.setLocale(locale);
    }

    setLocale(locale: LocaleKey) {
        this.locale = locale;
    }

    t(key: string, params?: Record<string, string>): string {
        const keys = key.split('.');
        let value: any = LOCALES[this.locale];

        for (const k of keys) {
            value = value?.[k];
            if (!value) break;
        }

        if (typeof value !== 'string') return key;

        if (params) {
            return value.replace(/\{(\w+)\}/g, (_, key) => params[key] || `{${key}}`);
        }

        return value;
    }
} 