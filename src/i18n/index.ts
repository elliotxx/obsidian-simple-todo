import en from './locales/en';
import zhCN from './locales/zh-CN';

export class I18n {
    private translations: any;

    constructor(locale: string) {
        const normalizedLocale = locale.toLowerCase();
        
        if (normalizedLocale === 'zh-cn' || 
            normalizedLocale === 'zh' || 
            normalizedLocale === 'zh-hans' || 
            normalizedLocale === 'zh_cn' ||
            normalizedLocale === 'zh_hans') {
            this.translations = zhCN;
        } else {
            this.translations = en;
        }
    }

    t(key: string, variables?: Record<string, any>): string {
        const keys = key.split('.');
        let value: any = this.translations;

        for (const k of keys) {
            value = value?.[k];
            if (!value) break;
        }

        if (typeof value !== 'string') return key;

        if (variables) {
            return value.replace(/\{(\w+)\}/g, (_, key) => 
                variables[key] !== undefined ? variables[key] : `{${key}}`
            );
        }

        return value;
    }
} 