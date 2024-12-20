export default {
    status: {
        todo: "Todo",
        inProgress: "In progress",
        done: "Done",
        unknown: "Unknown status"
    },
    weekday: {
        sunday: "Sun",
        monday: "Mon",
        tuesday: "Tue",
        wednesday: "Wed",
        thursday: "Thu",
        friday: "Fri",
        saturday: "Sat"
    },
    commands: {
        toggleTodo: {
            name: "Toggle todo status",
            notice: "Task status changed: {from} -> {to}"
        },
        rescheduleTodos: {
            name: "Reschedule previous todos",
            notice: {
                noTasks: "No unfinished tasks found",
                success: "Tasks have been rescheduled"
            }
        },
        archiveTodos: {
            name: "Archive completed todos",
            notice: {
                hasUnfinished: "{month} has unfinished tasks, skipping...",
                updateFailed: "Failed to update file"
            }
        }
    },
    modal: {
        confirm: "Confirm",
        cancel: "Cancel",
        diffViewer: {
            title: "Preview changes",
            confirmHint: "Confirm (Enter)",
            cancelHint: "Cancel (Esc)"
        }
    },
    settings: {
        archivePath: {
            name: "Archive folder path",
            desc: "The folder path where completed tasks will be archived"
        },
        showDiffPreview: {
            name: "Show changes preview",
            desc: "Show preview dialog before applying changes when rescheduling tasks"
        }
    }
} 