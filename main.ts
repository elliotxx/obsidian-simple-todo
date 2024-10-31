import { App, Plugin, TFile, Notice, moment } from 'obsidian';
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

	// 重新规划上一个任务日期的未完成任务
	async reschedulePreviousTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const content = await this.app.vault.read(activeFile);
		const lines = content.split('\n');
		const today = moment().format('YYYY-MM-DD');

		// 找到最近的一天的日期和未完成任务
		const { previousDate, unfinishedTodos } = this.findLatestUnfinishedTodos(lines, today);
		
		if (!previousDate || unfinishedTodos.length === 0) {
			// 如果没有找到之前的未完成任务，直接返回
			return;
		}

		// 将任务添加到今天
		const newContent = this.addTodosToToday(content, unfinishedTodos, today);
		await this.app.vault.modify(activeFile, newContent);
	}

	// 辅助方法：查找最近的未完成任务
	private findLatestUnfinishedTodos(lines: string[], today: string): { previousDate: string | null, unfinishedTodos: string[] } {
		let currentDate: string | null = null;
		let previousDate: string | null = null;
		const unfinishedTodos: string[] = [];
		const datePattern = /^\d{4}-\d{2}-\d{2}/;

		for (const line of lines) {
			// 检查是否是日期行
			const dateMatch = line.match(datePattern);
			if (dateMatch) {
				const date = dateMatch[0];
				if (date === today) {
					// 如果是今天的日期，跳过
					continue;
				}
				currentDate = date;
				// 如果已经找到了未完成的任务，就不需要继续查找了
				if (unfinishedTodos.length > 0) {
					break;
				}
			}

			// 如果有当前日期，并且找到了未完成的任务
			if (currentDate && line.match(/^- \[[ /]\] /)) {
				if (unfinishedTodos.length === 0) {
					// 记录第一个找到未完成任务的日期
					previousDate = currentDate;
				}
				unfinishedTodos.push(line);
			}
		}

		return { previousDate, unfinishedTodos };
	}

	// 辅助方法：添加任务到今天
	private addTodosToToday(content: string, todos: string[], today: string): string {
		const lines = content.split('\n');
		const todayPattern = new RegExp(`^${today}`);
		const todayIndex = lines.findIndex(line => todayPattern.test(line));

		if (todayIndex === -1) {
			// 如果找不到今天的日期，在文件开头添加
			const weekday = moment(today).format('dddd');
			const todayHeader = `${today} ${weekday}`;
			return todayHeader + '\n' + todos.join('\n') + '\n\n' + content;
		} else {
			// 在今天的日期下添加任务
			lines.splice(todayIndex + 1, 0, ...todos);
			return lines.join('\n');
		}
	}

	// 归档已完成任务
	async archiveCompletedTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) return;

		const content = await this.app.vault.read(activeFile);
		const lines = content.split('\n');
		
		// 按月份分组任务
		const tasksByMonth = this.groupTasksByMonth(lines);
		
		// 检查每个月份是否可以归档
		for (const [month, tasks] of Object.entries(tasksByMonth)) {
			const hasUnfinishedTasks = tasks.some(task => task.match(/^- \[[ /]\] /));
			if (hasUnfinishedTasks) {
				// 如果存在未完成任务，显示通知并跳过该月份
				new Notice(`${month} 还有未完成的任务，无法归档该月份的任务`);
				continue;
			}

			// 获取该月份的已完成任务
			const completedTasks = tasks.filter(task => task.match(/^- \[x\] /));
			if (completedTasks.length === 0) continue;

			// 确保归档目录存在
			const archiveDirPath = 'simple-todo';
			if (!await this.ensureArchiveDirectory(archiveDirPath)) {
				new Notice('无法创建归档目录');
				return;
			}

			// 创建或更新归档文件
			const archiveFileName = `${archiveDirPath}/archive-${month}.md`;
			await this.updateArchiveFile(archiveFileName, completedTasks, month);

			// 从原文件中删除已归档的任务
			content = this.removeArchivedTasks(content, completedTasks);
		}

		// 更新原文件
		await this.app.vault.modify(activeFile, content);
	}

	// 按月份分组任务
	private groupTasksByMonth(lines: string[]): Record<string, string[]> {
		const tasksByMonth: Record<string, string[]> = {};
		let currentMonth: string | null = null;
		const datePattern = /^(\d{4}-\d{2})-\d{2}/;

		for (const line of lines) {
			const dateMatch = line.match(datePattern);
			if (dateMatch) {
				currentMonth = dateMatch[1];
				if (!tasksByMonth[currentMonth]) {
					tasksByMonth[currentMonth] = [];
				}
			}
			
			if (currentMonth && line.match(/^- \[.+\] /)) {
				tasksByMonth[currentMonth].push(line);
			}
		}

		return tasksByMonth;
	}

	// 确保归档目录存在
	private async ensureArchiveDirectory(dirPath: string): Promise<boolean> {
		try {
			const dir = this.app.vault.getAbstractFileByPath(dirPath);
			if (!dir) {
				await this.app.vault.createFolder(dirPath);
			}
			return true;
		} catch (error) {
			console.error('Failed to create archive directory:', error);
			return false;
		}
	}

	// 更新归档文件
	private async updateArchiveFile(filePath: string, tasks: string[], month: string): Promise<void> {
		try {
			const archiveFile = this.app.vault.getAbstractFileByPath(filePath) as TFile;
			const header = `# ${month} 已归档任务\n\n`;
			
			if (archiveFile) {
				const archiveContent = await this.app.vault.read(archiveFile);
				await this.app.vault.modify(archiveFile, archiveContent + '\n' + tasks.join('\n'));
			} else {
				await this.app.vault.create(filePath, header + tasks.join('\n'));
			}
		} catch (error) {
			new Notice(`归档文件 ${filePath} 创建/更新失败`);
			console.error('Failed to update archive file:', error);
		}
	}

	// 从原文件中删除已归档的任务
	private removeArchivedTasks(content: string, archivedTasks: string[]): string {
		const lines = content.split('\n');
		const archivedTasksSet = new Set(archivedTasks);
		return lines.filter(line => !archivedTasksSet.has(line)).join('\n');
	}
}
