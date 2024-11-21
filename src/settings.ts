import { App, PluginSettingTab, Notice, Setting } from 'obsidian';
import SimpleTodoPlugin from './main';
import { LocaleKey, LOCALES } from './i18n';

export interface SimpleTodoSettings {
    language: LocaleKey;
}

export const DEFAULT_SETTINGS: SimpleTodoSettings = {
    language: 'en'
}

export class SimpleTodoSettingTab extends PluginSettingTab {
    plugin: SimpleTodoPlugin;

    constructor(app: App, plugin: SimpleTodoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName(this.plugin.i18n.t('settings.language.name'))
            .setDesc(this.plugin.i18n.t('settings.language.desc'))
            .addDropdown(dropdown => dropdown
                .addOptions({
                    'en': 'English',
                    'zh-CN': '简体中文'
                })
                .setValue(this.plugin.settings.language)
                .onChange(async (value: LocaleKey) => {
                    this.plugin.settings.language = value;
                    this.plugin.i18n.setLocale(value);
                    this.plugin.reloadCommands();
                    await this.plugin.saveSettings();
                    this.display();
                    new Notice(this.plugin.i18n.t('settings.language.changed'));
                }));
    }
} 