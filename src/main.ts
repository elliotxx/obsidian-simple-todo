import { App, Plugin, TFile, Notice, MarkdownView, Editor, EditorPosition, Modal } from 'obsidian';
import moment from 'moment';
import { DiffResult } from './types';
import { I18n } from './i18n';
import { SimpleTodoSettings, DEFAULT_SETTINGS, SimpleTodoSettingTab } from './settings';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { TodoDiffViewer } from './components/TodoDiffViewer';

export default class SimpleTodoPlugin extends Plugin {
	settings: SimpleTodoSettings;
	i18n: I18n;

	async onload() {
		await this.loadSettings();
		this.i18n = new I18n(this.settings.language);

		// 添加设置面板
		this.addSettingTab(new SimpleTodoSettingTab(this.app, this));

		// 注册插件命令
		this.addCommand({
			id: 'toggle-todo-status',
			name: this.i18n.t('commands.toggleTodo.name'),
			editorCallback: (editor: Editor) => {
				this.toggleTodoStatus();
			}
		});

		this.addCommand({
			id: 'reschedule-previous-todos',
			name: this.i18n.t('commands.rescheduleTodos.name'),
			callback: async () => {
				const diffResult = await this.reschedulePreviousTodos();
				if (diffResult) {
					// 创建一个新的 modal 来显示 diff
					const modal = new TodoDiffModal(this.app, diffResult, this);
					modal.open();
				}
			}
		});

		this.addCommand({
			id: 'archive-completed-todos',
			name: this.i18n.t('commands.archiveTodos.name'),
			callback: () => this.archiveCompletedTodos()
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	// 切换任务状态
	async toggleTodoStatus() {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			return;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const line = editor.getLine(cursor.line);
		
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]\s*(.*)/;
		const match = line.match(todoPattern);
		
		if (match) {
			const [_, indent, currentStatus, content] = match;
			const newStatus = this.getNextStatus(currentStatus);
			
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

			new Notice(this.i18n.t('commands.toggleTodo.notice', { from: this.getStatusText(currentStatus), to: this.getStatusText(newStatus) }));
		}
	}

	// 获取下一个状态
	getNextStatus(currentStatus: string): string {
		switch (currentStatus) {
			case ' ': return '/';
			case '/': return 'x';
			case 'x': return ' ';
			default: return ' ';
		}
	}

	// 获取状态文本说明
	private getStatusText(status: string): string {
		switch (status) {
			case ' ': return this.i18n.t('status.todo');
			case '/': return this.i18n.t('status.inProgress');
			case 'x': return this.i18n.t('status.done');
			default: return this.i18n.t('status.unknown');
		}
	}

	// 重新规划上一个任务日期的未完成任务
	async reschedulePreviousTodos(): Promise<DiffResult | null> {
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			return null;
		}

		const editor = activeView.editor;
		const cursor = editor.getCursor();
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			return null;
		}

		const fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		const today = moment().format('YYYY-MM-DD');

		const { previousDate, unfinishedTodos, unfinishedTodoLineNumbers } = this.findLatestUnfinishedTodos(lines, today, cursor.line);
		
		if (!previousDate || unfinishedTodos.length === 0) {
			new Notice(this.i18n.t('commands.rescheduleTodos.notice.noTasks'));
			return null;
		}

		// 创建预览内容
		const { content: previewContent, newCursorLine } = await this.createPreviewContent(
			fileContent,
			unfinishedTodoLineNumbers,
			unfinishedTodos,
			today,
			cursor
		);

		return {
			oldContent: fileContent,
			newContent: previewContent,
			newCursorLine
		};
	}

	// 添加新方法用于创建预览内容
	private async createPreviewContent(
		originalContent: string,
		unfinishedTodoLineNumbers: number[],
		unfinishedTodos: string[],
		today: string,
		cursor: EditorPosition
	): Promise<{ content: string; newCursorLine: number }> {
		const lines = originalContent.split('\n');
		const previewLines = [...lines];
		
		// 确保所有要移动的任务状态都是未完成状态
		const sanitizedTodos = unfinishedTodos.map(todo => {
			// 将任务状态重置为未完成
			return todo.replace(/\[(x|\/)\]/, '[ ]');
		});
		
		// 模拟在光标处添加任务
		const datePattern = new RegExp(`^${today}`);
		let todayLineIndex = previewLines.findIndex(line => datePattern.test(line));
		
		if (todayLineIndex === -1) {
			// 如果今天的日期不存在，创建新的日期和任务
			const weekday = moment(today).format('dddd');
			const localizedWeekday = this.getWeekdayText(weekday);
			
			// 确保插入位置前后有一个空行
			let insertPosition = cursor.line;
			let contentToInsert = '';

			// 检查前一行
			if (insertPosition > 0 && previewLines[insertPosition - 1].trim() !== '') {
				contentToInsert += '\n';
			}

			contentToInsert += `${today} ${localizedWeekday}\n${sanitizedTodos.join('\n')}`;

			// 检查后一行
			if (insertPosition < previewLines.length && previewLines[insertPosition].trim() !== '') {
				contentToInsert += '\n';
			}

			previewLines.splice(insertPosition, 0, contentToInsert);
		} else {
			// 如果今天的日期已存在，合并任务
			const todayTasks = this.getTodayTasks(previewLines, todayLineIndex);
			const mergedTasks = this.mergeTasks(todayTasks, sanitizedTodos);
			
			// 找到今天任务块的结束位置
			let endIndex = todayLineIndex + 1;
			for (let i = todayLineIndex + 1; i < previewLines.length; i++) {
				const line = previewLines[i];
				if (line.match(/^\d{4}-\d{2}-\d{2}/) || line.trim() === '') {
					break;
				}
				endIndex = i + 1;
			}

			// 确保任务块前后有一个空行
			let insertContent = mergedTasks.join('\n');
			
			// 检查前一行（日期行的前一行）
			if (todayLineIndex > 0 && previewLines[todayLineIndex - 1].trim() !== '') {
				previewLines.splice(todayLineIndex, 0, '');
				todayLineIndex++;
				endIndex++;
			}

			// 检查后一行
			if (endIndex < previewLines.length && previewLines[endIndex].trim() !== '') {
				insertContent += '\n';
			}

			// 替换今天的所有任务
			previewLines.splice(todayLineIndex + 1, endIndex - todayLineIndex - 1, insertContent);
		}
		
		// 从原位置删除任务，从后往前处理
		for (let i = unfinishedTodoLineNumbers.length - 1; i >= 0; i--) {
			const lineNum = unfinishedTodoLineNumbers[i];
			const line = previewLines[lineNum];
			const indent = line.match(/^[\t ]*/)?.[0] || '';
			
			// 检查是否有已完成的子任务
			let hasCompletedChildren = false;
			let hasUnfinishedChildren = false;
			for (let j = lineNum + 1; j < previewLines.length; j++) {
				const childLine = previewLines[j];
				const childMatch = childLine.match(/^([\t ]*)-\s*\[([x ])\]/);
				if (!childMatch) continue;
				
				const childIndent = childMatch[1];
				// 如果遇到缩进更少或相等的行，说明已经出了子任务范围
				if (childIndent.length <= indent.length) {
					break;
				}
				
				// 检查子任务状态
				if (childMatch[2] === 'x') {
					hasCompletedChildren = true;
				} else {
					hasUnfinishedChildren = true;
				}
			}
			
			if (hasCompletedChildren && !hasUnfinishedChildren) {
				// 如果所有子任务都已完成，将父任务标记为已完成
				previewLines[lineNum] = previewLines[lineNum].replace(/\[ \]/, '[x]');
			} else if (!hasCompletedChildren && !hasUnfinishedChildren) {
				// 如果没有子任务，删除该任务
				previewLines.splice(lineNum, 1);
			}
			// 如果有未完成的子任务，保持父任务为未完成状态
		}

		// 处理整个文件的空行，确保日期块之间只有一个空行
		const result: string[] = [];
		let lastLineWasDate = false;
		let lastLineWasEmpty = false;

		for (let i = 0; i < previewLines.length; i++) {
			const line = previewLines[i];
			const isDate = line.match(/^\d{4}-\d{2}-\d{2}/);
			const isEmpty = line.trim() === '';
			const isTask = line.match(/^[\t ]*- \[[ x/]\]/);

			if (isEmpty) {
				// 如果上一行是日期或任务，并且还没有添加过空行，则添加一个空行
				if ((lastLineWasDate || isTask) && !lastLineWasEmpty) {
					result.push(line);
					lastLineWasEmpty = true;
				}
				// 否则跳过多余的空行
			} else {
				if (isDate && !lastLineWasEmpty && result.length > 0) {
					// 如果是日期行，并且前面没有空行，添加一个空行
					result.push('');
				}
				result.push(line);
				lastLineWasDate = isDate !== null;
				lastLineWasEmpty = false;
			}
		}

		// 在返回结果前，找到今天日期块的最后一行
		const resultLines = result.join('\n').split('\n');
		const todayPattern = new RegExp(`^${today}`);
		let newCursorLine = 0;
		
		for (let i = 0; i < resultLines.length; i++) {
			if (todayPattern.test(resultLines[i])) {
				// 找到今天的日期行后，继续向下查找直到下一个日期行或空行
				for (let j = i + 1; j < resultLines.length; j++) {
					const nextLine = resultLines[j];
					if (nextLine.match(/^\d{4}-\d{2}-\d{2}/) || nextLine.trim() === '') {
						newCursorLine = j - 1; // 设置为日期块的最后一行
						break;
					}
					if (j === resultLines.length - 1) {
						newCursorLine = j; // 如果到达文件末尾，设置为最后一行
					}
				}
				break;
			}
		}

		return {
			content: resultLines.join('\n'),
			newCursorLine
		};
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

	// 辅助方法：查找最近的未完成任务（包括父任务）
	private findLatestUnfinishedTodos(
		lines: string[], 
		today: string,
		startLine: number
	): { 
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

		// 从光标位置开始向后开始处理任务
		for (let i = startLine; i < lines.length; i++) {
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

			if (currentDate && todoPattern.test(line)) {
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

	// 归档已完成任务
	async archiveCompletedTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			console.error('No active file found');
			return;
		}

		let fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		
		// 按月份分任务
		const tasksByMonth = this.groupTasksByMonth(lines);
		
		// 检查每个月份是否可以归档
		for (const [month, tasks] of Object.entries(tasksByMonth)) {
			const hasUnfinishedTasks = tasks.some(task => task.match(/^- \[[ /]\] /));
			if (hasUnfinishedTasks) {
				new Notice(this.i18n.t('commands.archiveTodos.notice.hasUnfinished', { month }));
				continue;
			}

			// 获取该月份的已完成任务
			const completedTasks = tasks.filter(task => task.match(/^- \[x\] /));
			if (completedTasks.length === 0) continue;

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
			} catch (error) {
				console.error(`Failed to update archive file: ${error}`);
				continue;
			}

			// 从原文件中删除已归档的任务
			fileContent = this.removeArchivedTasks(fileContent, completedTasks);
		}

		// 更新原文件
		try {
			await this.app.vault.modify(activeFile, fileContent);
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
			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			const header = `# ${month} 已归档任务\n\n`;
			
			if (abstractFile instanceof TFile) {
				const archiveContent = await this.app.vault.read(abstractFile);
				await this.app.vault.modify(abstractFile, archiveContent + '\n' + tasks.join('\n'));
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

	private getWeekdayText(weekday: string): string {
		const weekdayMap: Record<string, string> = {
			'Sunday': 'weekday.sunday',
			'Monday': 'weekday.monday',
			'Tuesday': 'weekday.tuesday',
			'Wednesday': 'weekday.wednesday',
			'Thursday': 'weekday.thursday',
			'Friday': 'weekday.friday',
			'Saturday': 'weekday.saturday'
		};
		
		return this.i18n.t(weekdayMap[weekday] || 'weekday.sunday');
	}

	// 添加重新加载命令的方法
	reloadCommands() {
		// 清除并重新注册命令
		const commandIds = [
			`${this.manifest.id}:toggle-todo-status`,
			`${this.manifest.id}:reschedule-previous-todos`,
			`${this.manifest.id}:archive-completed-todos`
		];

		// 移除现有命令
		commandIds.forEach(id => {
			// @ts-ignore
			this.app.commands?.removeCommand(id);
		});

		// 重新注册命令
		this.addCommand({
			id: 'toggle-todo-status',
			name: this.i18n.t('commands.toggleTodo.name'),
			editorCallback: (editor: Editor) => {
				this.toggleTodoStatus();
			}
		});

		this.addCommand({
			id: 'reschedule-previous-todos',
			name: this.i18n.t('commands.rescheduleTodos.name'),
			callback: async () => {
				const diffResult = await this.reschedulePreviousTodos();
				if (diffResult) {
					const modal = new TodoDiffModal(this.app, diffResult, this);
					modal.open();
				}
			}
		});

		this.addCommand({
			id: 'archive-completed-todos',
			name: this.i18n.t('commands.archiveTodos.name'),
			callback: () => this.archiveCompletedTodos()
		});
	}
}

// 创建一个 Modal 类来显示 diff
class TodoDiffModal extends Modal {
	constructor(app: App, private diffResult: DiffResult, private plugin: SimpleTodoPlugin) {
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
			await this.app.vault.modify(activeFile, this.diffResult.newContent);
			await new Promise(resolve => setTimeout(resolve, 50));
			
			if (this.diffResult.newCursorLine !== undefined) {
				const editor = activeView.editor;
				const line = this.diffResult.newCursorLine;
				
				if (line >= 0 && line < editor.lineCount()) {
					editor.setCursor({
						line: line,
						ch: editor.getLine(line).length
					});
					
					editor.scrollIntoView({
						from: { line: line, ch: 0 },
						to: { line: line, ch: editor.getLine(line).length }
					}, true);
				}
			}
			
			new Notice(this.plugin.i18n.t('commands.rescheduleTodos.notice.success'));
		} catch (error) {
			console.error('Failed to update file:', error);
			new Notice(this.plugin.i18n.t('commands.archiveTodos.notice.updateFailed'));
		}
	}
}
