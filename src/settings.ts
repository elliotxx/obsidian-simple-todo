import { App, PluginSettingTab, Setting } from 'obsidian';
import SimpleTodoPlugin from './main';

export interface SimpleTodoSettings {
    archivePath: string;
    showDiffPreview: boolean;
}

export const DEFAULT_SETTINGS: SimpleTodoSettings = {
    archivePath: 'simple-todo',
    showDiffPreview: true,
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

        // Archive path setting
        new Setting(containerEl)
            .setName(this.plugin.i18n.t('settings.archivePath.name'))
            .setDesc(this.plugin.i18n.t('settings.archivePath.desc'))
            .addText(text => text
                .setPlaceholder('simple-todo')
                .setValue(this.plugin.settings.archivePath)
                .onChange(async (value) => {
                    this.plugin.settings.archivePath = value;
                    await this.plugin.saveSettings();
                }));

        // Preview changes setting
        new Setting(containerEl)
            .setName(this.plugin.i18n.t('settings.showDiffPreview.name'))
            .setDesc(this.plugin.i18n.t('settings.showDiffPreview.desc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showDiffPreview)
                .onChange(async (value) => {
                    this.plugin.settings.showDiffPreview = value;
                    await this.plugin.saveSettings();
                }));
    }
} 