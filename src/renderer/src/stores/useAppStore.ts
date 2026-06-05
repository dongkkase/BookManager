import { create } from 'zustand';
import { AppConfig } from '../../../shared/types';

interface AppState {
  // Config
  config: AppConfig | null;
  isLoadingConfig: boolean;
  
  // Window
  currentTab: number;
  isMaximized: boolean;
  
  // Processing
  isProcessing: boolean;
  progress: number;
  statusMessage: string;
  
  // Actions
  loadConfig: (config: AppConfig) => void;
  setCurrentTab: (tab: number) => void;
  setIsProcessing: (processing: boolean) => void;
  setProgress: (progress: number) => void;
  setStatusMessage: (message: string) => void;
  updateProgress: (progress: number, message: string) => void;
  resetProgress: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  config: null,
  isLoadingConfig: true,
  currentTab: 0,
  isMaximized: false,
  isProcessing: false,
  progress: 0,
  statusMessage: '',

  loadConfig: (config) => set({ config, isLoadingConfig: false }),
  setCurrentTab: (tab) => set({ currentTab: tab }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setProgress: (progress) => set({ progress }),
  setStatusMessage: (message) => set({ statusMessage: message }),
  updateProgress: (progress, message) => set({ progress, statusMessage: message }),
  resetProgress: () => set({ progress: 0, statusMessage: '' }),
}));
