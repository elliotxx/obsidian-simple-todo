import { App, Plugin, TFile, moment } from 'obsidian';
import { TodoItem, TodoStatus } from './types';

export default class SimpleTodoPlugin extends Plugin {
	async onload() {
		// 注册插件命令
		this.addCommand({
			id: 'toggle-todo-status',
			name: 'Toggle Todo Status',
			callback: () => this.toggleTodoStatus()
		});

		this.addCommand({
			id: 'reschedule-previous-todos',
			name: 'Reschedule Previous Day Todos',
			callback: () => this.reschedulePreviousTodos()
		});

		this.addCommand({
			id: 'archive-completed-todos',
			name: 'Archive Completed Todos',
			callback: () => this.archiveCompletedTodos()
		});
	}

	// 切换任务状态
	async toggleTodoStatus() {
		const activeView = this.app.workspace.getActiveViewOfType('markdown');
		if (!activeView) return;

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		
		const todoPattern = /^- \[([ x/])\] /;
		if (todoPattern.test(line)) {
			const currentStatus = line.match(todoPattern)[1];
			const newStatus = this.getNextStatus(currentStatus);
			const newLine = line.replace(todoPattern, `- [${newStatus}] `);
			editor.setLine(cursor.line, newLine);
		}
	}

	// 获取下一个状态
	getNextStatus(currentStatus: string): string {
		switch (currentStatus) {
			case ' ': return '/';  // 待办 -> 进行中
			case '/': return 'x';  // 进行中 -> 已完成
			case 'x': return ' ';  // 已完成 -> 待办
			default: return ' ';
		}
	}

	// 重新规划前一天未完成的任务
	async reschedulePreviousTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const content = await this.app.vault.read(activeFile);
		const lines = content.split('\n');
		const today = moment().format('YYYY-MM-DD');
		const yesterday = moment().subtract(1, 'day').format('YYYY-MM-DD');

		// 找到昨天的未完成任务
		const unfinishedTodos = this.findUnfinishedTodos(lines, yesterday);
		if (unfinishedTodos.length === 0) return;

		// 将任务添加到今天
		const newContent = this.addTodosToToday(content, unfinishedTodos, today);
		await this.app.vault.modify(activeFile, newContent);
	}

	// 归档已完成任务
	async archiveCompletedTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const content = await this.app.vault.read(activeFile);
		const lines = content.split('\n');
		
		// 找到所有已完成的任务
		const completedTodos = lines.filter(line => line.match(/^- \[x\] /));
		if (completedTodos.length === 0) return;

		// 创建归档文件
		const archiveFileName = `archive-${moment().format('YYYY-MM')}.md`;
		const archiveFile = this.app.vault.getAbstractFileByPath(archiveFileName) as TFile;
		
		if (archiveFile) {
			const archiveContent = await this.app.vault.read(archiveFile);
			await this.app.vault.modify(archiveFile, archiveContent + '\n' + completedTodos.join('\n'));
		} else {
			await this.app.vault.create(archiveFileName, completedTodos.join('\n'));
		}

		// 从原文件中删除已完成任务
		const newContent = lines.filter(line => !line.match(/^- \[x\] /)).join('\n');
		await this.app.vault.modify(activeFile, newContent);
	}

	// 辅助方法：查找未完成任务
	private findUnfinishedTodos(lines: string[], date: string): string[] {
		let isInDate = false;
		const unfinishedTodos: string[] = [];

		for (const line of lines) {
			if (line.includes(date)) {
				isInDate = true;
				continue;
			}
			if (isInDate && line.match(/^- \[[ /]\] /)) {
				unfinishedTodos.push(line);
			}
			if (isInDate && line.match(/^\d{4}-\d{2}-\d{2}/)) {
				break;
			}
		}

		return unfinishedTodos;
	}

	// 辅助方法：添加任务到今天
	private addTodosToToday(content: string, todos: string[], today: string): string {
		const lines = content.split('\n');
		const todayIndex = lines.findIndex(line => line.includes(today));

		if (todayIndex === -1) {
			// 如果找不到今天的日期，在文件末尾添加
			return content + '\n\n' + today + '\n' + todos.join('\n');
		} else {
			// 在今天的日期下添加任务
			lines.splice(todayIndex + 1, 0, ...todos);
			return lines.join('\n');
		}
	}
}
