export default {
    settings: {
        language: {
            name: "语言",
            desc: "更改显示语言",
            changed: "语言切换成功"
        }
    },
    status: {
        todo: "待办",
        inProgress: "进行中",
        done: "已完成",
        unknown: "未知状态"
    },
    weekday: {
        sunday: "周日",
        monday: "周一",
        tuesday: "周二",
        wednesday: "周三",
        thursday: "周四",
        friday: "周五",
        saturday: "周六"
    },
    commands: {
        toggleTodo: {
            name: "切换任务状态",
            notice: "任务状态已更改: {from} -> {to}"
        },
        rescheduleTodos: {
            name: "重新规划未完成任务",
            notice: {
                noTasks: "没有找到未完成的任务",
                success: "任务已重新规划"
            }
        },
        archiveTodos: {
            name: "归档已完成任务",
            notice: {
                hasUnfinished: "{month} 还有未完成的任务，无法归档该月份的任务",
                updateFailed: "更新文件失败"
            }
        }
    },
    modal: {
        confirm: "确认",
        cancel: "取消",
        diffViewer: {
            title: "变更前后对比",
            confirmHint: "确认 (Enter)",
            cancelHint: "取消 (Esc)"
        }
    }
} 