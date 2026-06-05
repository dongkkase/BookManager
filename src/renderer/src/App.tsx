import { useEffect } from 'react';
import { useAppStore, useTaskStore } from './stores';
import { LucideIcon, FolderOpen, FileText, BookOpen, Share2, Settings, Package } from 'lucide-react';

// 탭 정의
interface TabDef {
  id: number;
  name: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { id: 0, name: 'Organizer', icon: FolderOpen },
  { id: 1, name: 'Renamer', icon: FileText },
  { id: 2, name: 'Metadata', icon: BookOpen },
  { id: 3, name: 'Folder', icon: Package },
  { id: 4, name: 'Sharing', icon: Share2 },
  { id: 5, name: 'Settings', icon: Settings },
];

function App(): React.JSX.Element {
  const currentTab = useAppStore((state) => state.currentTab);
  const setCurrentTab = useAppStore((state) => state.setCurrentTab);
  const isProcessing = useAppStore((state) => state.isProcessing);
  const progress = useAppStore((state) => state.progress);
  const statusMessage = useAppStore((state) => state.statusMessage);
  const updateProgress = useTaskStore((state) => state.updateProgress);

  // 초기 설정 로드
  useEffect(() => {
    const init = async () => {
      try {
        const config = await window.api.getConfig();
        useAppStore.getState().loadConfig(config);
        
        // 마지막 탭 인덱스 복원
        if (config.last_tab_index !== undefined) {
          setCurrentTab(config.last_tab_index);
        }
      } catch (e) {
        console.error('Failed to load config:', e);
      }
    };
    init();

    // 태스크 진행률 리스너
    const unsubscribe = window.api.onTaskProgress((progress) => {
      updateProgress(progress as Parameters<typeof updateProgress>[0]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      {/* Title Bar */}
      <header className="flex items-center justify-between px-4 py-2 bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">BookManager</h1>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
            v1.0.0
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-secondary text-xs px-3 py-1">
            업데이트 확인
          </button>
        </div>
      </header>

      {/* Tab Bar */}
      <nav className="tab-bar">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              className={`tab-item ${isActive ? 'active' : ''}`}
              onClick={() => setCurrentTab(tab.id)}
            >
              <div className="flex items-center gap-2">
                <Icon size={16} />
                <span>{tab.name}</span>
              </div>
            </button>
          );
        })}
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        {currentTab === 0 && <OrganizerTab />}
        {currentTab === 1 && <RenamerTab />}
        {currentTab === 2 && <MetadataTab />}
        {currentTab === 3 && <FolderTab />}
        {currentTab === 4 && <SharingTab />}
        {currentTab === 5 && <SettingsTab />}
      </main>

      {/* Status Bar */}
      <footer className="flex items-center gap-4 px-4 py-2 bg-[var(--bg-secondary)] border-t border-[var(--border-color)]">
        {/* Progress Bar */}
        <div className="flex-1 h-1 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent-primary)] transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        
        {/* Progress Percentage */}
        {isProcessing && (
          <span className="text-xs text-[var(--text-muted)]">{progress}%</span>
        )}
        
        {/* Status Message */}
        <span className="text-xs text-[var(--text-secondary)] flex-1 text-right">
          {statusMessage || '준비 완료'}
        </span>
        
        {/* Log Button */}
        <button className="btn-secondary text-xs px-3 py-1">
          로그
        </button>
      </footer>
    </div>
  );
}

// ============================================
// Tab Components (Placeholder)
// ============================================

function OrganizerTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <FolderOpen size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
        <h2 className="text-xl font-semibold mb-2">Organizer</h2>
        <p className="text-[var(--text-muted)]">만화 파일 정리 및 그룹화</p>
        <button className="btn-primary mt-4">
          폴더 선택
        </button>
      </div>
    </div>
  );
}

function RenamerTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <FileText size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
        <h2 className="text-xl font-semibold mb-2">Renamer</h2>
        <p className="text-[var(--text-muted)]">내부 파일명 일괄 변경 및 최적화</p>
        <button className="btn-primary mt-4">
          파일 선택
        </button>
      </div>
    </div>
  );
}

function MetadataTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <BookOpen size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
        <h2 className="text-xl font-semibold mb-2">Metadata</h2>
        <p className="text-[var(--text-muted)]">메타데이터 편집 및 comicInfo.xml 관리</p>
        <button className="btn-primary mt-4">
          파일 선택
        </button>
      </div>
    </div>
  );
}

function FolderTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <Package size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
        <h2 className="text-xl font-semibold mb-2">Folder</h2>
        <p className="text-[var(--text-muted)]">폴더 브라우저 및 파일 미리보기</p>
        <button className="btn-primary mt-4">
          폴더 열기
        </button>
      </div>
    </div>
  );
}

function SharingTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <Share2 size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
        <h2 className="text-xl font-semibold mb-2">Sharing</h2>
        <p className="text-[var(--text-muted)]">로컬 서버 및 모바일 연동</p>
        <button className="btn-primary mt-4">
          서버 시작
        </button>
      </div>
    </div>
  );
}

function SettingsTab() {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <Settings size={48} className="mx-auto mb-4 text-[var(--text-muted)]" />
        <h2 className="text-xl font-semibold mb-2">Settings</h2>
        <p className="text-[var(--text-muted)]">앱 설정 및 환경 구성</p>
      </div>
    </div>
  );
}

export default App;
