import { create } from 'zustand';

export interface TaskProgress {
  taskId: string;
  percent: number;
  message: string;
  isFinished: boolean;
  isCancelled: boolean;
  result?: unknown;
}

interface TaskState {
  // Active tasks
  activeTaskIds: string[];
  taskProgress: Map<string, TaskProgress>;
  
  // Actions
  addTask: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  updateProgress: (progress: TaskProgress) => void;
  clearAll: () => void;
  
  // Computed
  hasActiveTasks: () => boolean;
  getOverallProgress: () => number;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  activeTaskIds: [],
  taskProgress: new Map(),

  addTask: (taskId) => set((state) => ({
    activeTaskIds: state.activeTaskIds.includes(taskId) 
      ? state.activeTaskIds 
      : [...state.activeTaskIds, taskId]
  })),

  removeTask: (taskId) => set((state) => {
    const newProgress = new Map(state.taskProgress);
    newProgress.delete(taskId);
    return {
      activeTaskIds: state.activeTaskIds.filter((id) => id !== taskId),
      taskProgress: newProgress,
    };
  }),

  updateProgress: (progress) => set((state) => {
    const newProgress = new Map(state.taskProgress);
    newProgress.set(progress.taskId, progress);
    
    // Auto-remove finished tasks
    if (progress.isFinished || progress.isCancelled) {
      setTimeout(() => {
        get().removeTask(progress.taskId);
      }, 3000);
    }
    
    return { taskProgress: newProgress };
  }),

  clearAll: () => set({ activeTaskIds: [], taskProgress: new Map() }),

  hasActiveTasks: () => get().activeTaskIds.length > 0,

  getOverallProgress: () => {
    const { taskProgress, activeTaskIds } = get();
    if (activeTaskIds.length === 0) return 0;
    
    const total = activeTaskIds.reduce((sum, id) => {
      const p = taskProgress.get(id);
      return sum + (p?.percent ?? 0);
    }, 0);
    
    return Math.round(total / activeTaskIds.length);
  },
}));
