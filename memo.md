npx kill-port 5173
npm run electron:dev



남은 마이그레이션을 체크하여 진행하자

[x] Core/parsers 마이그레이션
[x] Task/organizeTask.js 마이그레이션 (organize_task.py: 488줄)
[ ] [-] Task/renameTask.js 마이그레이션 (rename_task.py: 595줄)
[ ] Task/updateTask.js 마이그레이션 (update_task.py: 156줄)
[ ] Task/apiWorkers.js 마이그레이션 (api_workers.py: 299줄)
[ ] Server 마이그레이션 (opds_server.py, webdav_server.py, manager.py)
[ ] API 마이그레이션 (api_fetcher.py, api_server.py)
[ ] 프론트엔드 Tab 컴포넌트 완전 구현
[ ] 기능 100% 동일성 검증 테스트 (최종 QA)

**Phase 4 완료**: 누락된 Task 모듈 마이그레이션
**Phase 5 완료**: 서버 모듈 마이그레이션 (전자 folder 비어있음)
**Phase 3 확인**: `core/api_fetcher.py` -> `electron/core/apiFetcher.js` 존재 확인
**Phase 6 완료**: 누락된 React Tab 컴포넌트
**Phase 7**: IPC 연동 완료 및 이벤트 시그널 통합
**Phase 8**: 빌드 테스트 및 최종 QA