import { useState, useEffect, useCallback } from 'react';

/**
 * 설정 상태 관리 훅
 * Electron IPC를 통해 설정을 로드/저장/업데이트
 */
export function useConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const currentConfig = await window.electronAPI.getConfig();
      setConfig(currentConfig);
      setLoading(false);
    } catch (error) {
      console.error('설정 로드 실패:', error);
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (updates) => {
    try {
      await window.electronAPI.saveConfig(updates);
      const updatedConfig = await window.electronAPI.getConfig();
      setConfig(updatedConfig);
      return updatedConfig;
    } catch (error) {
      console.error('설정 저장 실패:', error);
      throw error;
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return { config, loading, saveConfig, reloadConfig: loadConfig };
}
