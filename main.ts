import { App, Plugin, TFile, Notice, moment, MarkdownView, Editor, EditorPosition, Modal } from 'obsidian';
import { TodoItem, TodoStatus } from './types';
import * as Diff from 'diff';

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
		const originalContent = await this.app.vault.read(activeFile);
		const lines = originalContent.split('\n');
		const today = moment().format('YYYY-MM-DD');

		// 找到最近的一天的日期和未完成任务
		const { previousDate, unfinishedTodos, todoLineNumbers } = this.findLatestUnfinishedTodos(lines, today);
		
		if (!previousDate || unfinishedTodos.length === 0) {
			console.log('No unfinished todos found from previous dates');
			new Notice('没有找到未完成的任务');
			return;
		}

		console.log(`Found ${unfinishedTodos.length} unfinished todos from ${previousDate}`);
		
		// 创建新内容的临时副本
		const tempEditor = new DocumentFragment();
		const tempContent = editor.getValue();
		
		// 在临时内容中添加任务
		const newContent = await this.insertTodosAtCursor(tempContent, cursor.line, unfinishedTodos, today);
		
		// 从临时内容中删除原任务
		const finalContent = this.removeTodosFromOriginal(newContent, todoLineNumbers);

		// 显示 diff modal
		new DiffModal(
			this.app,
			originalContent,
			finalContent,
			async () => {
				// 确认后更新文件内容
				await this.app.vault.modify(activeFile, finalContent);
				console.log('Successfully rescheduled todos');
				new Notice(`已重新规划 ${unfinishedTodos.length} 个任务`);
			}
		).open();
	}

	// 在光标处插入任务
	private async insertTodosAtCursor(content: string, cursorLine: number, todos: string[], today: string): Promise<string> {
		const lines = content.split('\n');
		const datePattern = new RegExp(`^${today}`);
		
		// 查找今天的日期行
		const todayLineIndex = lines.findIndex(line => datePattern.test(line));
		
		if (todayLineIndex === -1) {
			// 如果今天的日期不存在，直接创建新的日期和任务
			const weekday = moment(today).format('dddd')
				.replace('星期日', '周日')
				.replace('星期一', '周一')
				.replace('星期二', '周二')
				.replace('星期三', '周三')
				.replace('星期四', '周四')
				.replace('星期五', '周五')
				.replace('星期六', '周六');
			
			const insertContent = `${today} ${weekday}\n${todos.join('\n')}\n`;
			lines.splice(cursorLine, 0, insertContent);
		} else {
			// 如果今天的日期已存在，需要合并任务
			const todayTasks = this.getTodayTasks(lines, todayLineIndex);
			const mergedTasks = this.mergeTasks(todayTasks, todos);
			
			let endIndex = todayLineIndex + 1;
			for (let i = todayLineIndex + 1; i < lines.length; i++) {
				const line = lines[i];
				if (line.match(/^\d{4}-\d{2}-\d{2}/) || line.trim() === '') {
					break;
				}
				endIndex = i + 1;
			}
			
			// 替换今天的所有任务
			lines.splice(todayLineIndex + 1, endIndex - todayLineIndex - 1, ...mergedTasks);
		}
		
		return lines.join('\n');
	}

	// 获取今天的任务
	private getTodayTasks(lines: string[], todayLineIndex: number): string[] {
		const tasks: string[] = [];
		for (let i = todayLineIndex + 1; i < lines.length; i++) {
			const line = lines[i];
			if (line.match(/^\d{4}-\d{2}-\d{2}/) || line.trim() === '') {
				break;
			}
			if (line.match(/^[\t ]*- \[[ x/]\]/)) {
				tasks.push(line);
			}
		}
		return tasks;
	}

	// 合并任务，处理同名父任务
	private mergeTasks(existingTasks: string[], newTasks: string[]): string[] {
		const taskMap = new Map<string, {
			task: string,
			indent: string,
			content: string,
			children: string[]
		}>();
		
		// 处理现有任务
		this.processTasksToMap(existingTasks, taskMap);
		// 处理新任务
		this.processTasksToMap(newTasks, taskMap);
		
		// 将合并后的任务转换回数组
		return this.convertTaskMapToArray(taskMap);
	}

	// 将任务处理到 Map 中
	private processTasksToMap(tasks: string[], taskMap: Map<string, any>) {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]\s*(.*)/;
		const parentStack: string[] = [];
		let prevIndentLength = -1;
		
		for (const task of tasks) {
			const match = task.match(todoPattern);
			if (!match) continue;
			
			const [_, indent, status, content] = match;
			const indentLength = indent.length;
			
			// 更新父任务栈
			while (parentStack.length > 0 && indentLength <= prevIndentLength) {
				parentStack.pop();
				prevIndentLength = parentStack.length > 0 ? 
					taskMap.get(parentStack[parentStack.length - 1]).indent.length : -1;
			}
			
			// 使缩进+内容作为 key，这样可以识别相同的任务
			const taskKey = `${indent}${content}`;
			
			// 如果任务已经存在，跳过
			if (taskMap.has(taskKey)) {
				continue;
			}
			
			// 添加新任务
			taskMap.set(taskKey, {
				task: task,
				indent: indent,
				content: content,
				children: []
			});
			
			// 将任务添加到父任务的子任务列表中
			if (parentStack.length > 0) {
				const parentKey = parentStack[parentStack.length - 1];
				taskMap.get(parentKey).children.push(taskKey);
			}
			
			parentStack.push(taskKey);
			prevIndentLength = indentLength;
		}
	}

	// 获取较高的状态
	private getHigherStatus(status1: string, status2: string): string {
		const statusPriority = { 'x': 3, '/': 2, ' ': 1 };
		return statusPriority[status1] >= statusPriority[status2] ? status1 : status2;
	}

	// 将任务 Map 转换回数组
	private convertTaskMapToArray(taskMap: Map<string, any>, parentKey: string = '', result: string[] = []): string[] {
		for (const [key, value] of taskMap.entries()) {
			if (!parentKey || value.indent.length === 0) {
				result.push(value.task);
				// 递归处理子任务
				for (const childKey of value.children) {
					result.push(taskMap.get(childKey).task);
				}
			}
		}
		return result;
	}

	// 更新所有任务的状态
	private updateAllTasksStatus(lines: string[], todayLineIndex: number): string {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]/;
		const parentTasks = new Map<string, number>(); // 缩进 -> 行号
		let inTodaySection = false;
		
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			
			// 检查是否进入或离开今天的部分
			if (i === todayLineIndex) {
				inTodaySection = true;
				continue;
			}
			if (inTodaySection && (line.match(/^\d{4}-\d{2}-\d{2}/) || line.trim() === '')) {
				inTodaySection = false;
				continue;
			}
			
			if (!inTodaySection) continue;
			
			const match = line.match(todoPattern);
			if (!match) continue;
			
			const [_, indent, status] = match;
			
			if (indent.length === 0) {
				// 顶级任务
				parentTasks.clear();
				parentTasks.set(indent, i);
				
				// 检查其子任务状态
				const allChildrenCompleted = this.checkChildrenStatus(lines, i, indent);
				if (allChildrenCompleted) {
					lines[i] = this.setTaskStatus(lines[i], 'x');
				} else {
					// 如果有未完成的子任务，确保父任务不是完成状态
					const currentStatus = status;
					if (currentStatus === 'x') {
						lines[i] = this.setTaskStatus(lines[i], ' ');
					}
				}
			} else {
				// 子任务
				let parentIndent = '';
				for (const [pIndent, pLine] of parentTasks.entries()) {
					if (pIndent.length < indent.length) {
						if (parentIndent.length < pIndent.length) {
							parentIndent = pIndent;
						}
					}
				}
				
				if (parentIndent !== '') {
					const parentLineNum = parentTasks.get(parentIndent);
					if (parentLineNum !== undefined) {
						const allChildrenCompleted = this.checkChildrenStatus(lines, parentLineNum, parentIndent);
						if (allChildrenCompleted) {
							lines[parentLineNum] = this.setTaskStatus(lines[parentLineNum], 'x');
						} else {
							// 如果有未完成的子任务，确保父任务不是完成状态
							const parentLine = lines[parentLineNum];
							const parentStatus = parentLine.match(todoPattern)?.[2];
							if (parentStatus === 'x') {
								lines[parentLineNum] = this.setTaskStatus(parentLine, ' ');
							}
						}
					}
				}
				
				parentTasks.set(indent, i);
			}
		}
		
		return lines.join('\n');
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
				// 检查是否叶子任务
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
				// 如果所有剩子任务都已完成，更新父任务状态
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
		
		// 按月份分任务
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

	// 检查子任务状态
	private checkChildrenStatus(lines: string[], parentLineNum: number, parentIndent: string): boolean {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]/;
		let allCompleted = true;
		
		for (let i = parentLineNum + 1; i < lines.length; i++) {
			const line = lines[i];
			const match = line.match(todoPattern);
			if (!match) continue;
			
			const [_, indent, status] = match;
			// 如果遇到缩进更少或相等的行，说明已经超出了子任务范围
			if (indent.length <= parentIndent.length) {
				break;
			}
			
			// 如果有任何未完成的子任务
			if (status !== 'x') {
				allCompleted = false;
				break;
			}
		}
		
		return allCompleted;
	}
}

// DiffModal 类
class DiffModal extends Modal {
	private originalContent: string;
	private newContent: string;
	private onConfirm: () => void;

	constructor(app: App, originalContent: string, newContent: string, onConfirm: () => void) {
		super(app);
		this.originalContent = originalContent;
		this.newContent = newContent;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// 设置 modal 宽度
		this.modalEl.style.width = '80vw';
		this.modalEl.style.height = '80vh';

		// 创建标题
		contentEl.createEl('h2', { text: '确认更改' });

		// 创建 diff 容器
		const diffContainer = contentEl.createEl('div', { cls: 'diff-container' });
		diffContainer.style.height = 'calc(80vh - 150px)';
		diffContainer.style.overflow = 'auto';
		diffContainer.style.padding = '10px';
		diffContainer.style.border = '1px solid var(--background-modifier-border)';
		diffContainer.style.borderRadius = '4px';
		diffContainer.style.fontFamily = 'monospace';
		diffContainer.style.whiteSpace = 'pre-wrap';
		diffContainer.style.fontSize = '14px';

		// 生成 diff
		const diffs = Diff.diffLines(this.originalContent, this.newContent);
		
		// 找到所有变更块
		const changes = this.findChangeBlocks(diffs);
		
		// 显示变更
		changes.forEach((change, index) => {
			if (index > 0) {
				// 添加分隔线
				const separator = diffContainer.createEl('div');
				separator.style.height = '1px';
				separator.style.margin = '10px 0';
				separator.style.backgroundColor = 'var(--background-modifier-border)';
			}

			// 显示上文
			if (change.context && change.context.length > 0) {
				const contextBlock = diffContainer.createEl('div');
				contextBlock.style.color = 'var(--text-muted)';
				contextBlock.style.padding = '2px 4px';
				contextBlock.textContent = change.context.join('\n');
			}

			// 显示折叠的行数
			if (change.beforeContext) {
				const collapsedIndicator = diffContainer.createEl('div');
				collapsedIndicator.style.color = 'var(--text-faint)';
				collapsedIndicator.style.textAlign = 'center';
				collapsedIndicator.style.padding = '5px 0';
				collapsedIndicator.style.backgroundColor = 'var(--background-secondary)';
				collapsedIndicator.style.margin = '5px 0';
				collapsedIndicator.textContent = `... ${change.beforeContext} 行未改变 ...`;
			}

			// 显示删除的内容
			if (change.removed && change.removed.length > 0) {
				const removedBlock = diffContainer.createEl('div');
				removedBlock.style.backgroundColor = 'var(--background-modifier-error-hover)';
				removedBlock.style.color = 'var(--text-error)';
				removedBlock.style.padding = '2px 4px';
				removedBlock.textContent = '- ' + change.removed.join('\n- ');
			}

			// 显示添加的内容
			if (change.added && change.added.length > 0) {
				const addedBlock = diffContainer.createEl('div');
				addedBlock.style.backgroundColor = 'var(--background-modifier-success-hover)';
				addedBlock.style.color = 'var(--text-success)';
				addedBlock.style.padding = '2px 4px';
				addedBlock.textContent = '+ ' + change.added.join('\n+ ');
			}
		});

		// 创建按钮容器
		const buttonContainer = contentEl.createEl('div', { cls: 'button-container' });
			buttonContainer.style.marginTop = '20px';
			buttonContainer.style.display = 'flex';
			buttonContainer.style.justifyContent = 'flex-end';
			buttonContainer.style.gap = '10px';
			buttonContainer.style.padding = '10px';

		// 创建确认按钮
		const confirmButton = buttonContainer.createEl('button', { text: '确认' });
		confirmButton.style.padding = '5px 15px';
		confirmButton.onclick = () => {
			this.onConfirm();
			this.close();
		};

		// 创建取消按钮
		const cancelButton = buttonContainer.createEl('button', { text: '取消' });
		cancelButton.style.padding = '5px 15px';
		cancelButton.onclick = () => {
			this.close();
		};
	}

	// 查找变更块
	private findChangeBlocks(diffs: Diff.Change[]): Array<{
		beforeContext?: number;
		afterContext?: number;
		removed?: string[];
		added?: string[];
		context?: string[];
	}> {
		const CONTEXT_LINES = 2;  // 显示变更块前后的上下文行数
		const changes: Array<{
			beforeContext?: number;
			afterContext?: number;
			removed?: string[];
			added?: string[];
			context?: string[];
		}> = [];
		
		let currentChange: {
			beforeContext?: number;
			afterContext?: number;
			removed?: string[];
				added?: string[];
			context?: string[];
		} = {};
		
		let contextLines: string[] = [];
		
		diffs.forEach((part, index) => {
			if (!part.added && !part.removed) {
				const lines = part.value.split('\n')
					.filter(line => line.length > 0);
					
				if (lines.length > CONTEXT_LINES * 2) {
					// 保存前面的上下文
					if (currentChange.removed || currentChange.added) {
						currentChange.context = contextLines.slice(-CONTEXT_LINES);
						changes.push(currentChange);
						currentChange = {};
						contextLines = [];
					}
					
					// 记录被折叠的行数
					if (lines.length > CONTEXT_LINES * 2) {
						changes.push({
							beforeContext: lines.length - (CONTEXT_LINES * 2)
						});
					}
					
					// 保存后面的上下文用于下一个变更
					contextLines = lines.slice(-CONTEXT_LINES);
				} else {
					contextLines = contextLines.concat(lines);
				}
			} else {
				const lines = part.value.split('\n')
					.filter(line => line.length > 0);
					
				if (part.added) {
					if (!currentChange.added) {
						currentChange.added = [];
					}
					currentChange.added = currentChange.added.concat(lines);
				}
				if (part.removed) {
					if (!currentChange.removed) {
						currentChange.removed = [];
					}
					currentChange.removed = currentChange.removed.concat(lines);
				}
				
				// 添加前面的上下文
				if (contextLines.length > 0) {
					currentChange.context = contextLines.slice(-CONTEXT_LINES);
					contextLines = [];
				}
			}
		});
		
		// 处理最后一个变更
		if (currentChange.removed || currentChange.added) {
			if (contextLines.length > 0) {
				currentChange.context = contextLines.slice(-CONTEXT_LINES);
			}
			changes.push(currentChange);
		}
		
		return changes;
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
