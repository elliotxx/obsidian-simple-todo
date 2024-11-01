import { App, Plugin, TFile, Notice, moment, MarkdownView, Editor, EditorPosition, Modal } from 'obsidian';
import { TodoItem, TodoStatus, DiffResult } from './types';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { TodoDiffViewer } from './components/TodoDiffViewer';

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
			callback: async () => {
				const diffResult = await this.reschedulePreviousTodos();
				if (diffResult) {
					// 创建一个新的 modal 来显示 diff
					const modal = new TodoDiffModal(this.app, diffResult);
					modal.open();
				}
			}
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
	async reschedulePreviousTodos(): Promise<DiffResult | null> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			console.log('No active markdown view found');
			return null;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			console.log('No active file found');
			return null;
		}

		console.log('Starting to reschedule previous todos...');
		const fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		const today = moment().format('YYYY-MM-DD');

		const { previousDate, unfinishedTodos, unfinishedTodoLineNumbers } = this.findLatestUnfinishedTodos(lines, today);
		console.log('Previous date:', previousDate);
		console.log('Unfinished todos:', unfinishedTodos);
		console.log('Unfinished todos line numbers:', unfinishedTodoLineNumbers);
		
		if (!previousDate || unfinishedTodos.length === 0) {
			console.log('No unfinished todos found from previous dates');
			new Notice('没有找到未完成的任务');
			return null;
		}

		// 创建预览内容
		const previewContent = await this.createPreviewContent(
			fileContent,
			unfinishedTodoLineNumbers,
			unfinishedTodos,
			today,
			cursor
		);

		return {
			oldContent: fileContent,
			newContent: previewContent
		};
	}

	// 添加新方法用于创建预览内容
	private async createPreviewContent(
		originalContent: string,
		unfinishedTodoLineNumbers: number[],
		unfinishedTodos: string[],
		today: string,
		cursor: EditorPosition
	): Promise<string> {
		// 创建内容副本
		const lines = originalContent.split('\n');
		const previewLines = [...lines];
		
		// 模拟在光标处添加任务
		const datePattern = new RegExp(`^${today}`);
		const todayLineIndex = previewLines.findIndex(line => datePattern.test(line));
		
		if (todayLineIndex === -1) {
			// 如果今天的日期不存在，创建新的日期和任务
			const weekday = moment(today).format('dddd')
				.replace('星期日', '周日')
				.replace('星期一', '周一')
				.replace('星期二', '周二')
				.replace('星期三', '周三')
				.replace('星期四', '周四')
				.replace('星期五', '周五')
				.replace('星期六', '周六');
			
			const insertContent = `${today} ${weekday}\n${unfinishedTodos.join('\n')}`;
			previewLines.splice(cursor.line, 0, insertContent);
		} else {
			// 如果今天的日期已存在，合并任务
			const todayTasks = this.getTodayTasks(previewLines, todayLineIndex);
			const mergedTasks = this.mergeTasks(todayTasks, unfinishedTodos);
			
			// 找到今天任务的结束位置
			let endIndex = todayLineIndex + 1;
			for (let i = todayLineIndex + 1; i < previewLines.length; i++) {
				const line = previewLines[i];
				if (line.match(/^\d{4}-\d{2}-\d{2}/) || line.trim() === '') {
					break;
				}
				endIndex = i + 1;
			}
			
			// 替换今天的所有任务
			previewLines.splice(todayLineIndex + 1, endIndex - todayLineIndex - 1, ...mergedTasks);
		}
		
		// 从原位置删除任务，从后往前处理
		for (let i = unfinishedTodoLineNumbers.length - 1; i >= 0; i--) {
			const lineNum = unfinishedTodoLineNumbers[i];
			const line = previewLines[lineNum];
			const indent = line.match(/^[\t ]*/)?.[0] || '';
			
			// 检查是否有已完成的子任务
			let hasCompletedChildren = false;
			for (let j = lineNum + 1; j < previewLines.length; j++) {
				const childLine = previewLines[j];
				const childMatch = childLine.match(/^([\t ]*)-\s*\[(x)\]/);
				if (!childMatch) continue;
				
				const childIndent = childMatch[1];
				// 如果遇到缩进更少或相等的行，说明已经超出了子任务范围
				if (childIndent.length <= indent.length) {
					break;
				}
				
				// 找到已完成的子任务
				if (childMatch[2] === 'x') {
					hasCompletedChildren = true;
					break;
				}
			}
			
			if (hasCompletedChildren) {
				// 如果有已完成的子任务，将父任务标记为已完成
				previewLines[lineNum] = previewLines[lineNum].replace(/\[ \]/, '[x]');
			} else {
				// 如果没有已完成的子任务，删除该任务
				previewLines.splice(lineNum, 1);
			}
		}
		
		return previewLines.join('\n');
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
			
			// 使用缩进+内容作为 key，这样可以识别相同的任务
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
		const statusPriority: Record<string, number> = { 'x': 3, '/': 2, ' ': 1 };
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
		unfinishedTodoLineNumbers: number[]
	} {
		let currentDate: string | null = null;
		let previousDate: string | null = null;
		const unfinishedTodos: string[] = [];
		const unfinishedTodoLineNumbers: number[] = [];
		const datePattern = /^\d{4}-\d{2}-\d{2}/;
		const todoPattern = /^[\t ]*- \[[ /]\] /;

		// 用于存储任务的层级关系
		interface TaskInfo {
			line: string;
			lineNumber: number;
			indent: string;
			parents: Array<{
				line: string;
				lineNumber: number;
			}>;
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
						lineNumber: i+1,
						indent: currentIndent,
						parents
					});
				}
			}
		}

		console.log("taskInfos", taskInfos)

		// 处理收集到的任务信息
		for (const taskInfo of taskInfos) {
			// 首先添加所有父任务（如果还没有添加过）
			for (const parent of taskInfo.parents) {
				if (!unfinishedTodos.includes(parent.line)) {
					unfinishedTodos.push(parent.line);
					unfinishedTodoLineNumbers.push(parent.lineNumber);
				}
			}
			// 然后添加当前任务
			unfinishedTodos.push(taskInfo.line);
			unfinishedTodoLineNumbers.push(taskInfo.lineNumber);
		}

		return { previousDate, unfinishedTodos, unfinishedTodoLineNumbers };
	}

	// 查找父任务
	private findParentTasks(lines: string[], currentLineNum: number, currentIndent: string): { line: string, lineNumber: number }[] {
		const parents: { line: string, lineNumber: number }[] = [];
		const todoPattern = /^[\t ]*- \[[ x/]\] /;
		
		// 从当前行向上查找所有父任务
		for (let i = currentLineNum - 1; i >= 0; i--) {
			const line = lines[i];
			if (!todoPattern.test(line)) continue;
			
			const indent = line.match(/^[\t ]*/)?.[0] || '';
			// 如果找到缩进更少的任务行，说明是父任务
			if (indent.length < currentIndent.length) {
				parents.unshift({ line, lineNumber: i+1 }); // 添加到数组开头，保持层级顺序
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
			// 如果还有其他子任务，查它们的状态
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

// 创建一个 Modal 类来显示 diff
class TodoDiffModal extends Modal {
	private originalContent: string;
	private todoLineNumbers: number[];
	private unfinishedTodos: string[];

	constructor(app: App, private diffResult: DiffResult) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		// @ts-ignore
		ReactDOM.render(
			React.createElement(TodoDiffViewer, {
				diffResult: this.diffResult,
				onClose: () => this.close(),
				onConfirm: async () => {
					// 执行实际的任务移动操作
					await this.confirmChanges();
					this.close();
				}
			}),
			contentEl
		);
	}

	onClose() {
		const { contentEl } = this;
		ReactDOM.unmountComponentAtNode(contentEl);
	}

	private async confirmChanges() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView || !this.diffResult) {
			return;
		}

		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return;
		}

		try {
			// 将新内容写入文件
			await this.app.vault.modify(activeFile, this.diffResult.newContent);
			new Notice('任务已重新规划');
		} catch (error) {
			console.error('Failed to update file:', error);
			new Notice('更新文件失败');
		}
	}
}
