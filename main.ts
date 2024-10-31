import { App, Plugin, TFile, Notice, moment, MarkdownView, Editor, EditorPosition } from 'obsidian';
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

		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]\s*(.*)/;
		const match = line.match(todoPattern);
		
		if (match) {
			const [_, indent, currentStatus, content] = match;
			const newStatus = this.getNextStatus(currentStatus);
			console.log(`Toggling todo status: ${currentStatus} -> ${newStatus}`);
			
			const newLine = `${indent}- [${newStatus}] ${content}`;
			
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
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			console.log('No active markdown view found');
			return;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			console.log('No active file found');
			return;
		}

		console.log('Starting to reschedule previous todos...');
		let fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		const today = moment().format('YYYY-MM-DD');

		// 找到最近的一天的日期和未完成任务
		const { previousDate, unfinishedTodos, todoLineNumbers } = this.findLatestUnfinishedTodos(lines, today);
		
		if (!previousDate || unfinishedTodos.length === 0) {
			console.log('No unfinished todos found from previous dates');
			new Notice('没有找到未完成的任务');
			return;
		}

		console.log(`Found ${unfinishedTodos.length} unfinished todos from ${previousDate}`);
		
		// 在光标处添加任务
		await this.insertTodosAtCursor(editor, cursor, unfinishedTodos, today);
		
		// 从原位置删除已移动的任务
		fileContent = this.removeTodosFromOriginal(fileContent, todoLineNumbers);
		await this.app.vault.modify(activeFile, fileContent);
		
		console.log('Successfully rescheduled todos to cursor position and removed from original location');
		new Notice(`已重新规划 ${unfinishedTodos.length} 个任务`);
	}

	// 在光标处插入任务
	private async insertTodosAtCursor(editor: Editor, cursor: EditorPosition, todos: string[], today: string) {
		// 获取当前行
		const currentLine = editor.getLine(cursor.line);
		
		// 检查当前行是否是日期行
		const datePattern = /^\d{4}-\d{2}-\d{2}/;
		let insertContent = '';
		
		if (!datePattern.test(currentLine)) {
			// 如果当前行不是日期行，先插入日期
			// 将 dddd (星期几) 转换为 '周X' 格式
			const weekday = moment(today).format('dddd')
				.replace('星期日', '周日')
				.replace('星期一', '周一')
				.replace('星期二', '周二')
				.replace('星期三', '周三')
				.replace('星期四', '周四')
				.replace('星期五', '周五')
				.replace('星期六', '周六');
			insertContent = `${today} ${weekday}\n`;
		}
		
		// 添加所有任务，保持原有缩进
		insertContent += todos.join('\n') + '\n';

		// 在光标处插入内容
		editor.transaction({
			changes: [{
				from: {
					line: cursor.line,
					ch: 0
				},
				to: {
					line: cursor.line,
					ch: 0
				},
				text: insertContent
			}]
		});
	}

	// 辅助方法：查找最近的未完成任务（包括父任务）
	private findLatestUnfinishedTodos(lines: string[], today: string): { 
		previousDate: string | null, 
		unfinishedTodos: string[],
		todoLineNumbers: number[]
	} {
		let currentDate: string | null = null;
		let previousDate: string | null = null;
		const unfinishedTodos: string[] = [];
		const todoLineNumbers: number[] = [];
		const datePattern = /^\d{4}-\d{2}-\d{2}/;
		const todoPattern = /^[\t ]*- \[[ /]\] /;

		// 用于存储任务的层级关系
		interface TaskInfo {
			line: string;
			lineNumber: number;
			indent: string;
			parents: string[];
		}
		const taskInfos: TaskInfo[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			// 检查是否是日期行
			const dateMatch = line.match(datePattern);
			if (dateMatch) {
				const date = dateMatch[0];
				if (date === today) {
					continue;
				}
				currentDate = date;
				if (taskInfos.length > 0) {
					break;
				}
			}

			// 如果有当前日期，并且找到了未完成的任务
			if (currentDate && todoPattern.test(line)) {
				// 检查是否是叶子任务
				if (this.isLeafTask(lines, i)) {
					const currentIndent = line.match(/^[\t ]*/)?.[0] || '';
					const parents = this.findParentTasks(lines, i, currentIndent);
					
					if (taskInfos.length === 0) {
						previousDate = currentDate;
					}
					
					taskInfos.push({
						line,
						lineNumber: i,
						indent: currentIndent,
						parents
					});
				}
			}
		}

		// 处理收集到的任务信息
		for (const taskInfo of taskInfos) {
			// 首先添加所有父任务（如果还没有添加过）
			for (const parent of taskInfo.parents) {
				if (!unfinishedTodos.includes(parent)) {
					unfinishedTodos.push(parent);
				}
			}
			// 然后添加当前任务
			unfinishedTodos.push(taskInfo.line);
			todoLineNumbers.push(taskInfo.lineNumber);
		}

		return { previousDate, unfinishedTodos, todoLineNumbers };
	}

	// 查找父任务
	private findParentTasks(lines: string[], currentLineNum: number, currentIndent: string): string[] {
		const parents: string[] = [];
		const todoPattern = /^[\t ]*- \[[ x/]\] /;
		
		// 从当前行向上查找所有父任务
		for (let i = currentLineNum - 1; i >= 0; i--) {
			const line = lines[i];
			if (!todoPattern.test(line)) continue;
			
			const indent = line.match(/^[\t ]*/)?.[0] || '';
			// 如果找到缩进更少的任务行，说明是父任务
			if (indent.length < currentIndent.length) {
				parents.unshift(line); // 添加到数组开头，保持层级顺序
				currentIndent = indent; // 更新当前缩进，继续查找更上层的父任务
			}
		}
		
		return parents;
	}

	// 判断是否是叶子任务（没有子任务的任务）
	private isLeafTask(lines: string[], lineNum: number): boolean {
		const currentLine = lines[lineNum];
		const currentIndent = currentLine.match(/^[\t ]*/)?.[0] || '';
		
		// 检查下一行
		const nextLine = lines[lineNum + 1];
		if (!nextLine) return true;  // 如果是最后一行，就是叶子任务
		
		// 获取下一行的缩进
		const nextIndent = nextLine.match(/^[\t ]*/)?.[0] || '';
		
		// 如果下一行是任务且缩进更深，则当前任务不是叶子任务
		if (nextIndent.length > currentIndent.length && nextLine.includes('- [')) {
			return false;
		}
		
		return true;
	}

	// 从原位置删除已移动的任务
	private removeTodosFromOriginal(content: string, lineNumbers: number[]): string {
		const lines = content.split('\n');
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]/;
		
		// 从后往前处理每个任务
		for (let i = lineNumbers.length - 1; i >= 0; i--) {
			const currentLineNum = lineNumbers[i];
			const currentLine = lines[currentLineNum];
			const indentMatch = currentLine.match(/^([\t ]*)/);
			const currentIndent = indentMatch ? indentMatch[1] : '';
			
			// 删除当前任务
			lines.splice(currentLineNum, 1);
			
			// 检查并处理父任务
			this.handleParentTasks(lines, currentLineNum, currentIndent);
		}
		
		return lines.join('\n');
	}

	// 处理父任务
	private handleParentTasks(lines: string[], currentLineNum: number, currentIndent: string) {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]/;
		let parentLineNum = -1;
		let parentIndent = '';
		
		// 从当前行向上查找父任务
		for (let i = currentLineNum - 1; i >= 0; i--) {
			const line = lines[i];
			const match = line.match(todoPattern);
			if (!match) continue;
			
			const [_, indent] = match;
			if (indent.length < currentIndent.length) {
				parentLineNum = i;
				parentIndent = indent;
				break;
			}
		}
		
		if (parentLineNum === -1) return;
		
		// 检查父任务是否还有其他子任务
		const hasOtherChildren = this.checkForRemainingChildren(lines, parentLineNum, parentIndent);
		
		if (!hasOtherChildren) {
			// 如果没有其他子任务，删除父任务
			lines.splice(parentLineNum, 1);
			// 递归处理上层父任务
			this.handleParentTasks(lines, parentLineNum, parentIndent);
		} else {
			// 如果还有其他子任务，检查它们的状态
			const allChildrenCompleted = this.areAllChildrenCompleted(lines, parentLineNum, parentIndent);
			if (allChildrenCompleted) {
				// 如果所有剩余子任务都已完成，更新父任务状态
				lines[parentLineNum] = this.setTaskStatus(lines[parentLineNum], 'x');
			}
		}
	}

	// 检查是否还有其他子任务
	private checkForRemainingChildren(lines: string[], parentLineNum: number, parentIndent: string): boolean {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]/;
		
		for (let i = parentLineNum + 1; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(todoPattern);
			if (!match) continue;
			
			const [_, indent] = match;
			// 如果遇到缩进更少或相等的行，说明已经超出了子任务范围
			if (indent.length <= parentIndent.length) {
				break;
			}
			// 找到了子任务
			return true;
		}
		
		return false;
	}

	// 检查所有子任务是否都已完成
	private areAllChildrenCompleted(lines: string[], parentLineNum: number, parentIndent: string): boolean {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]/;
		
		for (let i = parentLineNum + 1; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(todoPattern);
			if (!match) continue;
			
			const [_, indent, status] = match;
			// 如果遇到缩进更少或相等的行，说明已经超出了子任务范围
			if (indent.length <= parentIndent.length) {
				break;
			}
			// 如果找到未完成的子任务，返回 false
			if (status !== 'x') {
				return false;
			}
		}
		
		return true;
	}

	// 设置任务状态
	private setTaskStatus(line: string, status: string): string {
		return line.replace(/\[([ x/])\]/, `[${status}]`);
	}

	// 判断是否应该删除任务
	private shouldDeleteTask(lines: string[], lineNum: number, currentIndent: string): boolean {
		// 检查下一行是否存在且是任务
		const nextLine = lines[lineNum + 1];
		if (!nextLine) return true;  // 如果是最后一行，可以删除
		
		// 获取下一行的缩进
		const nextIndent = nextLine.match(/^[\t ]*/)?.[0] || '';
		
		// 如果下一行的缩进更深，说明当前任务有子任务，不应该删除
		if (nextIndent.length > currentIndent.length && nextLine.includes('- [')) {
			return false;
		}
		
		// 如果下一行缩进相同或更浅，可以删除当前任务
		return true;
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
		
		// 按月份分��任务
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
