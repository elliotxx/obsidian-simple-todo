export default {
    settings: {
        language: {
            name: "Language",
            desc: "Change the display language",
            changed: "Language changed successfully"
        }
    },
    status: {
        todo: "Todo",
        inProgress: "In Progress",
        done: "Done",
        unknown: "Unknown Status"
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
            name: "Toggle Todo Status",
            notice: "Task status changed: {from} -> {to}"
        },
        rescheduleTodos: {
            name: "Reschedule Previous Todos",
            notice: {
                noTasks: "No unfinished tasks found",
                success: "Tasks have been rescheduled"
            }
        },
        archiveTodos: {
            name: "Archive Completed Todos",
            notice: {
                hasUnfinished: "{month} has unfinished tasks, skipping...",
                updateFailed: "Failed to update file"
            }
        }
    }
} 