import { create } from 'zustand';
import { FileMetadata } from '../../../shared/types';

export interface FilterOptions {
  searchQuery: string;
  seriesFilter: string;
  genreFilter: string;
  sortBy: 'name' | 'date' | 'size';
  sortOrder: 'asc' | 'desc';
}

interface LibraryState {
  // Files
  files: Record<string, FileMetadata>;
  selectedPaths: string[];
  currentFolder: string;
  
  // Filters
  filters: FilterOptions;
  
  // Actions
  setFiles: (files: Record<string, FileMetadata>) => void;
  setSelectedPaths: (paths: string[]) => void;
  toggleSelection: (path: string) => void;
  clearSelection: () => void;
  setCurrentFolder: (folder: string) => void;
  setFilters: (filters: Partial<FilterOptions>) => void;
  resetFilters: () => void;
  
  // Computed
  selectedFiles: () => FileMetadata[];
  filteredFiles: () => FileMetadata[];
}

const defaultFilters: FilterOptions = {
  searchQuery: '',
  seriesFilter: '',
  genreFilter: '',
  sortBy: 'name',
  sortOrder: 'asc',
};

export const useLibraryStore = create<LibraryState>((set, get) => ({
  files: {},
  selectedPaths: [],
  currentFolder: '',
  filters: defaultFilters,

  setFiles: (files) => set({ files }),
  setSelectedPaths: (paths) => set({ selectedPaths: paths }),
  toggleSelection: (path) => {
    const current = get().selectedPaths;
    const newSelection = current.includes(path)
      ? current.filter((p) => p !== path)
      : [...current, path];
    set({ selectedPaths: newSelection });
  },
  clearSelection: () => set({ selectedPaths: [] }),
  setCurrentFolder: (folder) => set({ currentFolder: folder }),
  setFilters: (newFilters) => set((state) => ({ filters: { ...state.filters, ...newFilters } })),
  resetFilters: () => set({ filters: defaultFilters }),

  selectedFiles: () => {
    const { files, selectedPaths } = get();
    return selectedPaths
      .map((path) => files[path])
      .filter((f): f is FileMetadata => f !== undefined);
  },

  filteredFiles: () => {
    const { files, filters } = get();
    const fileArray = Object.values(files);
    
    return fileArray.filter((file) => {
      // Search query
      if (filters.searchQuery) {
        const query = filters.searchQuery.toLowerCase();
        const matches = 
          file.title?.toLowerCase().includes(query) ||
          file.series?.toLowerCase().includes(query) ||
          file.path?.toLowerCase().includes(query);
        if (!matches) return false;
      }
      
      // Series filter
      if (filters.seriesFilter && file.series !== filters.seriesFilter) {
        return false;
      }
      
      // Genre filter
      if (filters.genreFilter && file.genre !== filters.genreFilter) {
        return false;
      }
      
      return true;
    });
  },
}));
