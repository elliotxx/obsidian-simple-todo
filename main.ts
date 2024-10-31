import { App, Plugin, TFile, Notice, moment, MarkdownView, Editor } from 'obsidian';
import { TodoItem, TodoStatus } from './types';

export default class SimpleTodoPlugin extends Plugin {
	async onload() {
		console.log('Loading Simple Todo plugin...');
		// 注册插件命令
		this.addCommand({
			id: 'toggle-todo-status',
			name: 'Toggle Todo Status',
			hotkeys: [{ modifiers: ["Mod"], key: "Enter" }],
			editorCallback: (editor: Editor) => {
				this.toggleTodoStatus();
			}
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
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			console.log('No active markdown view found');
			return;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		
		console.log('Current line:', line);

		const todoPattern = /^[\t ]*- \[([ x/])\] /;
		const match = line.match(todoPattern);
		
		if (match) {
			const currentStatus = match[1];
			const newStatus = this.getNextStatus(currentStatus);
			console.log(`Toggling todo status: ${currentStatus} -> ${newStatus}`);
			
			const indentation = line.match(/^[\t ]*/)[0];
			const taskContent = line.replace(todoPattern, '');
			const newLine = `${indentation}- [${newStatus}] ${taskContent}`;
			
			editor.transaction({
				changes: [{
					from: {
						line: cursor.line,
						ch: 0
					},
					to: {
						line: cursor.line,
						ch: line.length
					},
					text: newLine
				}]
			});

			new Notice(`任务状态已更改: ${this.getStatusText(currentStatus)} -> ${this.getStatusText(newStatus)}`);
		} else {
			console.log('No todo item found at current line');
		}
	}

	// 获取下一个状态
	getNextStatus(currentStatus: string): string {
		console.log('Current status:', currentStatus);
		switch (currentStatus) {
			case ' ': return '/';  // 待办 -> 进行中
			case '/': return 'x';  // 进行中 -> 已完成
			case 'x': return ' ';  // 已完成 -> 待办
			default: return ' ';
		}
	}

	// 获取状态文本说明
	private getStatusText(status: string): string {
		switch (status) {
			case ' ': return '待办';
			case '/': return '进行中';
			case 'x': return '已完成';
			default: return '未知状态';
		}
	}

	// 重新规划上一个任务日期的未完成任务
	async reschedulePreviousTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			console.log('No active file found');
			return;
		}

		console.log('Starting to reschedule previous todos...');
		const fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		const today = moment().format('YYYY-MM-DD');

		// 找到最近的一天的日期和未完成任务
		const { previousDate, unfinishedTodos } = this.findLatestUnfinishedTodos(lines, today);
		
		if (!previousDate || unfinishedTodos.length === 0) {
			console.log('No unfinished todos found from previous dates');
			return;
		}

		console.log(`Found ${unfinishedTodos.length} unfinished todos from ${previousDate}`);
		
		// 将任务添加到今天
		const newContent = this.addTodosToToday(fileContent, unfinishedTodos, today);
		await this.app.vault.modify(activeFile, newContent);
		console.log('Successfully rescheduled todos to today');
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
		if (!activeFile) {
			console.log('No active file found');
			return;
		}

		console.log('Starting to archive completed todos...');
		let fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		
		// 按月份分组任务
		const tasksByMonth = this.groupTasksByMonth(lines);
		
		// 检查每个月份是否可以归档
		for (const [month, tasks] of Object.entries(tasksByMonth)) {
			console.log(`Processing tasks for ${month}...`);
			const hasUnfinishedTasks = tasks.some(task => task.match(/^- \[[ /]\] /));
			if (hasUnfinishedTasks) {
				console.log(`${month} has unfinished tasks, skipping...`);
				new Notice(`${month} 还有未完成的任务，无法归档该月份的任务`);
				continue;
			}

			// 获取该月份的已完成任务
			const completedTasks = tasks.filter(task => task.match(/^- \[x\] /));
			if (completedTasks.length === 0) {
				console.log(`No completed tasks found for ${month}`);
				continue;
			}

			console.log(`Found ${completedTasks.length} completed tasks for ${month}`);

			// 确保归档目录存在
			const archiveDirPath = 'simple-todo';
			if (!await this.ensureArchiveDirectory(archiveDirPath)) {
				console.error('Failed to create archive directory');
				new Notice('无法创建归档目录');
				return;
			}

			// 创建或更新归档文件
			const archiveFileName = `${archiveDirPath}/archive-${month}.md`;
			try {
				await this.updateArchiveFile(archiveFileName, completedTasks, month);
				console.log(`Successfully archived tasks to ${archiveFileName}`);
			} catch (error) {
				console.error(`Failed to update archive file: ${error}`);
				continue;
			}

			// 从原文件中删除已归档的任务
			fileContent = this.removeArchivedTasks(fileContent, completedTasks);
			console.log(`Removed ${completedTasks.length} archived tasks from original file`);
		}

		// 更新原文件
		try {
			await this.app.vault.modify(activeFile, fileContent);
			console.log('Successfully updated original file');
		} catch (error) {
			console.error(`Failed to update original file: ${error}`);
			new Notice('更新原文件失败');
		}
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
