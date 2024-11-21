import { App, Plugin, TFile, TFolder, Notice, MarkdownView, Editor, EditorPosition, Modal } from 'obsidian';
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
		
		// Get Obsidian's locale setting
		// @ts-ignore - app.locale exists but is not in the type definitions
		const locale = window.localStorage.getItem('language') || 'en';
		this.i18n = new I18n(locale);

		// Add settings tab
		this.addSettingTab(new SimpleTodoSettingTab(this.app, this));

		// Register plugin commands
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
					// Create a new modal to display diff
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

	// Toggle task status
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

	// Get next status
	getNextStatus(currentStatus: string): string {
		switch (currentStatus) {
			case ' ': return '/';
			case '/': return 'x';
			case 'x': return ' ';
			default: return ' ';
		}
	}

	// Get status text description
	private getStatusText(status: string): string {
		switch (status) {
			case ' ': return this.i18n.t('status.todo');
			case '/': return this.i18n.t('status.inProgress');
			case 'x': return this.i18n.t('status.done');
			default: return this.i18n.t('status.unknown');
		}
	}

	// Reschedule unfinished tasks from previous date
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

		// Create preview content
		const { content: previewContent, newCursorLine } = await this.createPreviewContent(
			fileContent,
			unfinishedTodoLineNumbers,
			unfinishedTodos,
			today,
			cursor
		);

		// If preview is disabled, apply changes directly
		if (!this.settings.showDiffPreview) {
			await this.app.vault.modify(activeFile, previewContent);
			
			// Update cursor position
			if (newCursorLine !== undefined) {
				editor.setCursor({
					line: newCursorLine,
					ch: editor.getLine(newCursorLine).length
				});
				
				editor.scrollIntoView({
					from: { line: newCursorLine, ch: 0 },
					to: { line: newCursorLine, ch: editor.getLine(newCursorLine).length }
				}, true);
			}
			
			new Notice(this.i18n.t('commands.rescheduleTodos.notice.success'));
			return null;
		}

		// Return diff result for preview
		return {
			oldContent: fileContent,
			newContent: previewContent,
			newCursorLine
		};
	}

	// Add new method for creating preview content
	private async createPreviewContent(
		originalContent: string,
		unfinishedTodoLineNumbers: number[],
		unfinishedTodos: string[],
		today: string,
		cursor: EditorPosition
	): Promise<{ content: string; newCursorLine: number }> {
		const lines = originalContent.split('\n');
		const previewLines = [...lines];
		
		// Make sure all tasks to be moved are in unfinished status
		const sanitizedTodos = unfinishedTodos.map(todo => {
			// Reset task status to unfinished
			return todo.replace(/\[(x|\/)\]/, '[ ]');
		});
		
		// Simulate adding tasks at cursor position
		const datePattern = new RegExp(`^${today}`);
		let todayLineIndex = previewLines.findIndex(line => datePattern.test(line));
		
		if (todayLineIndex === -1) {
			// If today's date doesn't exist, create new date and tasks
			const weekday = moment(today).format('dddd');
			const localizedWeekday = this.getWeekdayText(weekday);
			
			// Ensure there's an empty line before and after the insertion position
			let insertPosition = cursor.line;
			let contentToInsert = '';

			// Check previous line
			if (insertPosition > 0 && previewLines[insertPosition - 1].trim() !== '') {
				contentToInsert += '\n';
			}

			
			contentToInsert += `${today} ${localizedWeekday}\n${sanitizedTodos.join('\n')}`;

			// Check next line
			if (insertPosition < previewLines.length && previewLines[insertPosition].trim() !== '') {
				contentToInsert += '\n';
			}

			previewLines.splice(insertPosition, 0, contentToInsert);
		} else {
			// If today's date exists, merge tasks
			const todayTasks = this.getTodayTasks(previewLines, todayLineIndex);
			const mergedTasks = this.mergeTasks(todayTasks, sanitizedTodos);
			
			// Find the end position of today's task block
			let endIndex = todayLineIndex + 1;
			for (let i = todayLineIndex + 1; i < previewLines.length; i++) {
				const line = previewLines[i];
				if (line.match(/^\d{4}-\d{2}-\d{2}/) || line.trim() === '') {
					break;
				}
				endIndex = i + 1;
			}

			// Ensure task block has empty lines before and after
			let insertContent = mergedTasks.join('\n');
			
			// Check previous line (line before date)
			if (todayLineIndex > 0 && previewLines[todayLineIndex - 1].trim() !== '') {
				previewLines.splice(todayLineIndex, 0, '');
				todayLineIndex++;
				endIndex++;
			}

			// Check next line
			if (endIndex < previewLines.length && previewLines[endIndex].trim() !== '') {
				insertContent += '\n';
			}

			// Replace all tasks for today
			previewLines.splice(todayLineIndex + 1, endIndex - todayLineIndex - 1, insertContent);
		}
		
		// Delete tasks from original position, process from back to front
		for (let i = unfinishedTodoLineNumbers.length - 1; i >= 0; i--) {
			const lineNum = unfinishedTodoLineNumbers[i];
			const line = previewLines[lineNum];
			const indent = line.match(/^[\t ]*/)?.[0] || '';
			
			// Check for completed subtasks
			let hasCompletedChildren = false;
			let hasUnfinishedChildren = false;
			for (let j = lineNum + 1; j < previewLines.length; j++) {
				const childLine = previewLines[j];
				const childMatch = childLine.match(/^([\t ]*)-\s*\[([x ])\]/);
				if (!childMatch) continue;
				
				const childIndent = childMatch[1];
				// If indent is less than or equal, we're out of subtask range
				if (childIndent.length <= indent.length) {
					break;
				}
				
				// Check subtask status
				if (childMatch[2] === 'x') {
					hasCompletedChildren = true;
				} else {
					hasUnfinishedChildren = true;
				}
			}
			
			if (hasCompletedChildren && !hasUnfinishedChildren) {
				// If all subtasks are completed, mark parent task as completed
				previewLines[lineNum] = previewLines[lineNum].replace(/\[ \]/, '[x]');
			} else if (!hasCompletedChildren && !hasUnfinishedChildren) {
				// If no subtasks, delete this task
				previewLines.splice(lineNum, 1);
			}
			// If there are unfinished subtasks, keep parent task as unfinished
		}

		// Handle empty lines in the entire file, ensure only one empty line between date blocks
		const result: string[] = [];
		let lastLineWasDate = false;
		let lastLineWasEmpty = false;

		for (let i = 0; i < previewLines.length; i++) {
			const line = previewLines[i];
			const isDate = line.match(/^\d{4}-\d{2}-\d{2}/);
			const isEmpty = line.trim() === '';
			const isTask = line.match(/^[\t ]*- \[[ x/]\]/);

			if (isEmpty) {
				// If the previous line is a date or task, and we haven't added an empty line yet, add an empty line
				if ((lastLineWasDate || isTask) && !lastLineWasEmpty) {
					result.push(line);
					lastLineWasEmpty = true;
				}
				// Otherwise, skip extra empty lines
			} else {
				if (isDate && !lastLineWasEmpty && result.length > 0) {
					// If it's a date line, and there's no empty line before, add an empty line
					result.push('');
				}
				result.push(line);
				lastLineWasDate = isDate !== null;
				lastLineWasEmpty = false;
			}
		}

		// Before returning result, find the last line of today's date block
		const resultLines = result.join('\n').split('\n');
		const todayPattern = new RegExp(`^${today}`);
		let newCursorLine = 0;
		
		for (let i = 0; i < resultLines.length; i++) {
			if (todayPattern.test(resultLines[i])) {
				// Find today's date line, continue searching until the next date line or empty line
				for (let j = i + 1; j < resultLines.length; j++) {
					const nextLine = resultLines[j];
					if (nextLine.match(/^\d{4}-\d{2}-\d{2}/) || nextLine.trim() === '') {
						newCursorLine = j - 1; // Set to the last line of the date block
						break;
					}
					if (j === resultLines.length - 1) {
						newCursorLine = j; // If we reach the end of the file, set to the last line
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

	// Get today's tasks
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

	// Merge tasks, handle parent tasks with same name
	private mergeTasks(existingTasks: string[], newTasks: string[]): string[] {
		const taskMap = new Map<string, {
			task: string,
			indent: string,
			content: string,
			children: string[]
		}>();
		
		// Process existing tasks
		this.processTasksToMap(existingTasks, taskMap);
		// Process new tasks
		this.processTasksToMap(newTasks, taskMap);
		
		// Convert merged tasks back to array
		return this.convertTaskMapToArray(taskMap);
	}

	// Process tasks into Map
	private processTasksToMap(tasks: string[], taskMap: Map<string, any>) {
		const todoPattern = /^([\t ]*)-\s*\[([ x/])\]\s*(.*)/;
		const parentStack: string[] = [];
		let prevIndentLength = -1;
		
		for (const task of tasks) {
			const match = task.match(todoPattern);
			if (!match) continue;
			
			const [_, indent, status, content] = match;
			const indentLength = indent.length;
			
			// Update parent task stack
			while (parentStack.length > 0 && indentLength <= prevIndentLength) {
				parentStack.pop();
				prevIndentLength = parentStack.length > 0 ? 
					taskMap.get(parentStack[parentStack.length - 1]).indent.length : -1;
			}
			
			// Use indent+content as key to identify same tasks
			const taskKey = `${indent}${content}`;
			
			// Skip if task already exists
			if (taskMap.has(taskKey)) {
				continue;
			}
			
			// Add new task
			taskMap.set(taskKey, {
				task: task,
				indent: indent,
				content: content,
				children: []
			});
			
			// Add task to parent's subtask list
			if (parentStack.length > 0) {
				const parentKey = parentStack[parentStack.length - 1];
				taskMap.get(parentKey).children.push(taskKey);
			}
			
			parentStack.push(taskKey);
			prevIndentLength = indentLength;
		}
	}

	// Convert task Map back to array
	private convertTaskMapToArray(taskMap: Map<string, any>, parentKey: string = '', result: string[] = []): string[] {
		for (const [key, value] of taskMap.entries()) {
			if (!parentKey || value.indent.length === 0) {
				result.push(value.task);
				// Recursively process subtasks
				for (const childKey of value.children) {
					result.push(taskMap.get(childKey).task);
				}
			}
		}
		return result;
	}

	// Helper method: Find latest unfinished tasks (including parent tasks)
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

		// For storing task hierarchy relationships
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

		// Start processing tasks from cursor position
		for (let i = startLine; i < lines.length; i++) {
			const line = lines[i];
			// Check if it's a date line
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

		// Process collected task information
		for (const taskInfo of taskInfos) {
			// First add all parent tasks (if not added yet)
			for (const parent of taskInfo.parents) {
				if (!unfinishedTodos.includes(parent.line)) {
					unfinishedTodos.push(parent.line);
					unfinishedTodoLineNumbers.push(parent.lineNumber);
				}
			}
			// Then add current task
			unfinishedTodos.push(taskInfo.line);
			unfinishedTodoLineNumbers.push(taskInfo.lineNumber);
		}

		return { previousDate, unfinishedTodos, unfinishedTodoLineNumbers };
	}

	// Find parent tasks
	private findParentTasks(lines: string[], currentLineNum: number, currentIndent: string): { line: string, lineNumber: number }[] {
		const parents: { line: string, lineNumber: number }[] = [];
		const todoPattern = /^[\t ]*- \[[ x/]\] /;
		
		// Search upward for all parent tasks from current line
		for (let i = currentLineNum - 1; i >= 0; i--) {
			const line = lines[i];
			if (!todoPattern.test(line)) continue;
			
			const indent = line.match(/^[\t ]*/)?.[0] || '';
			// If found a task line with less indent, it's a parent task
			if (indent.length < currentIndent.length) {
				// Add to array start to maintain hierarchy order
				parents.unshift({ line, lineNumber: i+1 });
				// Update current indent to continue searching for higher level parent tasks
				currentIndent = indent;
			}
		}
		
		return parents;
	}

	// Check if it's a leaf task (task with no subtasks)
	private isLeafTask(lines: string[], lineNum: number): boolean {
		const currentLine = lines[lineNum];
		const currentIndent = currentLine.match(/^[\t ]*/)?.[0] || '';
		
		// Check next line
		const nextLine = lines[lineNum + 1];
		if (!nextLine) return true;  // If it's the last line, it's a leaf task
		
		// Get next line's indent
		const nextIndent = nextLine.match(/^[\t ]*/)?.[0] || '';
		
		// If next line is a task with deeper indent, current task is not a leaf task
		if (nextIndent.length > currentIndent.length && nextLine.includes('- [')) {
			return false;
		}
		
		return true;
	}

	// Archive completed tasks
	async archiveCompletedTodos() {
		const activeFile = this.app.workspace.getActiveFile();
		if (!activeFile) {
			console.error('No active file found');
			return;
		}

		let fileContent = await this.app.vault.read(activeFile);
		const lines = fileContent.split('\n');
		
		// Group tasks by month
		const tasksByMonth = this.groupTasksByMonth(lines);
		
		// Check if each month can be archived
		for (const [month, tasks] of Object.entries(tasksByMonth)) {
			const hasUnfinishedTasks = tasks.some(task => task.match(/^- \[[ /]\] /));
			if (hasUnfinishedTasks) {
				new Notice(this.i18n.t('commands.archiveTodos.notice.hasUnfinished', { month }));
				continue;
			}

			// Get completed tasks for the month
			const completedTasks = tasks.filter(task => task.match(/^- \[x\] /));
			if (completedTasks.length === 0) continue;

			// Use the configured archive path
			const archiveDirPath = this.settings.archivePath;
			if (!await this.ensureArchiveDirectory(archiveDirPath)) {
				console.error('Failed to create archive directory');
				new Notice(this.i18n.t('commands.archiveTodos.notice.updateFailed'));
				return;
			}

			// Create or update archive file
			const archiveFileName = `${archiveDirPath}/archive-${month}.md`;
			try {
				await this.updateArchiveFile(archiveFileName, completedTasks, month);
			} catch (error) {
				console.error(`Failed to update archive file: ${error}`);
				continue;
			}

			// Remove archived tasks from original file
			fileContent = this.removeArchivedTasks(fileContent, completedTasks);
		}

		// Update original file
		try {
			await this.app.vault.modify(activeFile, fileContent);
		} catch (error) {
			console.error(`Failed to update original file: ${error}`);
			new Notice(this.i18n.t('commands.archiveTodos.notice.updateFailed'));
		}
	}

	// Group tasks by month
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

	// Ensure archive directory exists
	private async ensureArchiveDirectory(dirPath: string): Promise<boolean> {
		try {
			const dir = this.app.vault.getAbstractFileByPath(dirPath);
			if (!(dir instanceof TFolder)) {
				await this.app.vault.createFolder(dirPath);
			}
			return true;
		} catch (error) {
			console.error('Failed to create archive directory:', error);
			return false;
		}
	}

	// Update archive file
	private async updateArchiveFile(filePath: string, tasks: string[], month: string): Promise<void> {
		try {
			const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
			const header = `# ${month} Completed Tasks\n\n`;
			
			if (abstractFile instanceof TFile) {
				const archiveContent = await this.app.vault.read(abstractFile);
				await this.app.vault.modify(abstractFile, archiveContent + '\n' + tasks.join('\n'));
			} else {
				await this.app.vault.create(filePath, header + tasks.join('\n'));
			}
		} catch (error) {
			new Notice(`Archive file ${filePath} creation/update failed`);
			console.error('Failed to update archive file:', error);
		}
	}

	// Remove archived tasks from original file
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
}

// Create a Modal class to display diff
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
					},
					i18n: this.plugin.i18n
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
