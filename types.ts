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
	newCursorLine?: number;
}

export type LocaleType = {
    settings: {
        language: {
            name: string;
            desc: string;
            changed: string;
        }
    };
    status: {
        todo: string;
        inProgress: string;
        done: string;
        unknown: string;
    };
    weekday: {
        sunday: string;
        monday: string;
        tuesday: string;
        wednesday: string;
        thursday: string;
        friday: string;
        saturday: string;
    };
    commands: {
        toggleTodo: {
            name: string;
            notice: string;
        };
        rescheduleTodos: {
            name: string;
            notice: {
                noTasks: string;
                success: string;
            }
        };
        archiveTodos: {
            name: string;
            notice: {
                hasUnfinished: string;
                updateFailed: string;
            }
        }
    }
}