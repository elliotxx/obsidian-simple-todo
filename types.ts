export enum TodoStatus {
    TODO = ' ',
    IN_PROGRESS = '/',
    COMPLETED = 'x'
}

export interface TodoItem {
    content: string;
    status: TodoStatus;
    date: string;
} 

export interface DiffResult {
	oldContent: string;
	newContent: string;
}