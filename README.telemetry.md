# 오류 보고와 기능 사용 통계

BookManager는 Sentry에 제한된 JavaScript 오류 정보를, PostHog에 메뉴·기능 사용 이벤트를 전송할 수 있습니다. 두 항목은 기본으로 켜져 있으며, 원하지 않으면 환경 설정에서 각각 끌 수 있습니다. 서비스 연결 설정이 있고 해당 사용 설정이 켜진 경우에 전송합니다. 이 문서는 코드의 동작과 운영 프로젝트의 연결·배포 설정을 설명합니다.

## 운영 프로젝트

- [Sentry 오류 목록](https://devmore.sentry.io/issues/?project=4512186958217296)
- [PostHog 프로젝트](https://us.posthog.com/project/642044)
- [PostHog 기능 사용 대시보드](https://us.posthog.com/project/642044/dashboard/2162649)

현재 개발 기기의 연결 값은 Git에서 제외되는 `.env.local`에 저장합니다. 이 파일은 다른 기기나 CI로 전달되지 않으므로, CI 빌드에는 아래 배포 설정의 세 환경 변수를 별도로 지정해야 합니다. 실제 사용자 통계는 연결 설정을 포함한 앱을 배포한 뒤 사용 통계 설정이 켜진 설치에서부터 쌓입니다.

연결 검증 이벤트에는 `0.0.0-telemetry-test` 버전을 사용합니다. 실제 사용량을 볼 때는 PostHog의 `app_version`에서 이 값을 제외하고, Sentry에서는 `development` 환경 또는 `bookmanager@0.0.0-telemetry-test` 릴리스를 구분합니다.

Sentry 프로젝트의 **Security & Privacy**에서는 아래 두 설정을 함께 적용합니다. 현재 운영 프로젝트에도 적용되어 있으며, 새 프로젝트로 옮길 때 다시 설정해야 합니다.

- **Prevent Storing of IP Addresses**를 켭니다.
- **Advanced Data Scrubbing**에 `[Remove] [Anything] from [$user.geo.**]` 규칙을 추가합니다.

앱에서 사용자 정보를 보내지 않아도 Sentry는 연결 IP로 위치를 추론할 수 있습니다. IP 저장 중지만으로 위치 정보가 제거되지는 않으므로 별도의 위치 제거 규칙이 필요합니다. 설정은 이후 수신한 이벤트에 적용되며 기존 이벤트를 소급 수정하지 않습니다. 운영 프로젝트의 새 `metadata-save` 테스트 이벤트에서 Geography 정보가 제거된 것을 상세 화면으로 확인했습니다. 새 프로젝트를 설정하거나 규칙을 바꾸면 새 이벤트의 IP와 국가·도시 등 위치 값을 다시 확인합니다. 관련 동작은 [Sentry 공식 저장소의 안내](https://github.com/getsentry/sentry/issues/92201)를 참고합니다.

## 사용 설정과 수집 범위

환경 설정 → 기본 설정 → 오류 보고 및 사용 통계에서 원하지 않는 항목의 체크를 해제하고 저장합니다. 설정 키는 `telemetry_error_reports`, `telemetry_usage_stats`이며, 설정이 없으면 기본값 `true`를 사용하고 기존에 저장된 `false`는 유지합니다. 실행 중 설정을 저장하면 재시작 없이 적용됩니다. 설정 파일 저장에 실패해도 명시적인 수집 중단 요청은 이번 실행에 즉시 적용하고, 화면에서 저장 실패와 재시도를 안내합니다. 재시작 후에도 유지하려면 설정 저장을 완료해야 합니다. 서비스가 연결되어 있지 않으면 설정 화면에 전송되지 않는 상태를 표시합니다.

| 구분 | 전송하는 정보 | 전송하지 않는 정보 |
| --- | --- | --- |
| Sentry | 허용된 오류 유형·오류 코드, 앱 내부 코드의 상대 위치와 행·열, 앱 버전, OS, 고정 기능·발생 위치 식별자 | 원본 오류 메시지, 책 이름·본문·메타데이터, 실제 파일 경로, 검색어, 사용자 설정, API 키, 첨부 파일 |
| PostHog | 무작위 설치 ID, 이벤트 시각, 앱 버전, OS, 고정 메뉴·도구·기능 식별자, 작업 결과, 처리 시간, 허용된 파일 형식 분류, 실제 사용한 TTS 엔진·모델 분류 | 책 이름·본문·메타데이터, 파일 경로, 검색어, 계정·기기 이름, 음성 이름·스타일·사용자 설정, API 키 |

화면 녹화, 자동 클릭 수집, 성능 추적, Sentry breadcrumbs와 일반 로그 전송은 사용하지 않습니다. PostHog 이벤트는 `$process_person_profile: false`, `$geoip_disable: true`, `$ip: null`을 지정하며 앱에서 사용자 프로필을 만들거나 로그인 계정과 연결하지 않습니다. 다만 HTTPS 요청을 받는 서비스에는 네트워크 통신의 출발지 IP가 보일 수 있으므로 이를 개인정보가 전혀 없는 전송이라고 설명하지 않습니다. PostHog의 익명 이벤트 동작은 [공식 문서](https://posthog.com/docs/data/anonymous-vs-identified-events)를 참고합니다.

사용 통계 전송이 활성화되면 무작위 UUID를 생성해 설정 폴더의 `telemetry-state.json`에 저장합니다. 오류 보고만 켠 경우 이 ID를 생성하지 않습니다. 사용 통계를 끄면 대기 중인 전송을 폐기하고 진행 중인 요청을 중단하며 설치 ID를 삭제합니다. 다시 켜면 새 ID를 사용합니다. 이미 서비스에 도착한 데이터까지 소급해 삭제하는 기능은 아닙니다. 설정 폴더를 복사하면 ID도 함께 복사될 수 있고, 쓰기 권한이 없으면 앱 실행마다 ID가 달라질 수 있습니다.

## 서비스 프로젝트와 배포 설정

1. Sentry의 기존 조직에 BookManager 전용 프로젝트를 만들고 플랫폼은 Node.js로 선택합니다. 오류 수집용 공개 DSN을 사용합니다. 현재 앱에는 수동 전송 코드가 있으므로 설치 마법사로 자동 계측 코드를 추가하지 않습니다.
2. PostHog에 BookManager 전용 프로젝트를 만들고 Product analytics용 프로젝트 토큰과 수집 호스트를 확인합니다. 개인 API 키나 관리용 API 키를 앱에 넣지 않습니다. 프로젝트 지역에 따라 `https://us.i.posthog.com` 또는 `https://eu.i.posthog.com`을 사용합니다.
3. 저장소 루트에 `.env.example`을 참고한 `.env.local`을 만들고 아래 값을 입력합니다. 기존 `.env.local`이 있으면 해당 키만 추가하거나 수정합니다. 이 파일은 Git에서 제외됩니다.
4. Vite 빌드 후 플랫폼별 배포 앱을 생성합니다. 배포 앱에서 수집 항목이 켜져 있는지 확인한 뒤 실제 오류·사용 이벤트가 해당 프로젝트에 들어오는지 확인합니다.

```dotenv
BOOKMANAGER_SENTRY_DSN=
BOOKMANAGER_POSTHOG_TOKEN=
BOOKMANAGER_POSTHOG_HOST=https://us.i.posthog.com
```

값이 비어 있는 서비스는 연결되지 않은 상태로 유지됩니다. DSN과 프로젝트 토큰은 이벤트를 보내는 공개 수집 설정이며 배포 앱에서 확인할 수 있습니다. Sentry 관리 토큰, PostHog 개인 API 키, Google 로그인 자격 증명은 포함하지 않습니다. PostHog 프로젝트 토큰은 [프로젝트 설정 안내](https://posthog.com/docs/libraries/next-js)에 설명되어 있습니다.

`viteTelemetryConfigPlugin.js`는 Vite가 읽은 `.env.local` 등의 설정과 실행 환경 변수에서 위 세 키만 골라 `dist/telemetry-config.json`을 생성합니다. 메인 프로세스는 이 파일을 읽으며, 실행 환경에 지정된 비어 있지 않은 `BOOKMANAGER_*` 값이 번들 설정보다 우선합니다. Electron이 `.env.local`을 직접 읽는 구조가 아니므로 값을 바꾼 뒤에는 다시 빌드해야 합니다. CI에서는 같은 세 환경 변수를 빌드 작업에 지정합니다.

개발 실행에서는 기본적으로 전송하지 않습니다. 개발 수신 검증이 필요할 때는 프로젝트 수집 값을 준비하고 아래처럼 Electron 실행 프로세스에 별도 환경 변수를 지정합니다. 앱 안의 해당 사용 설정도 켜져 있어야 합니다. `.env.local`의 `BOOKMANAGER_TELEMETRY_DEV=1`만으로는 활성화되지 않습니다.

```bash
BOOKMANAGER_TELEMETRY_DEV=1 npm run electron:dev
```

개발 검증에는 별도 테스트 프로젝트를 사용하는 편이 좋습니다. Sentry에는 `development` 환경 태그가 붙지만 PostHog 사용 이벤트에는 개발 환경 구분 속성이 없으므로 같은 프로젝트를 쓰면 사용량에 섞입니다.

## 오류 수집 구현

Electron 28 앱의 메인 프로세스에서 `@sentry/node` 10.75.3의 독립적인 `NodeClient`를 사용합니다. 자동 통합을 끄고 `captureEvent`로 정제한 이벤트만 전송합니다. 렌더러·뷰어 오류는 제한된 IPC를 거쳐 메인 프로세스에서 다시 정제합니다. 도서 본문을 띄운 iframe이나 외부 URL은 이 IPC의 호출 대상으로 허용하지 않습니다.

앱 내부에 실제 존재하는 코드 파일의 위치만 `app:///electron/...`, `app:///src/...`, `app:///dist/assets/...`로 바꾸어 보냅니다. 원본 오류 메시지는 버리고 허용 목록에 있는 오류 유형과 코드만 유지합니다. 스택이 없는 오류는 기능·발생 위치·유형·코드로 묶습니다. 릴리스는 `bookmanager@<version.json의 latest_version>`이며 릴리스 정보가 없으면 앱 패키지 버전을 사용합니다.

JavaScript 예외와 처리하지 않은 Promise 거부, 연결된 프로세스 이상 상태, 계측된 작업 오류를 대상으로 합니다. 네이티브 크래시 덤프·미니덤프는 수집하지 않습니다. 소스맵 업로드도 포함하지 않으므로 배포 렌더러 스택은 원본 JSX 위치가 아닌 번들 파일의 행·열로 나타납니다.

작업의 반환값에 있는 `ok: false`, `success: false`, 오류 목록과 명시적인 취소 상태를 구분합니다. 사용자 취소, 파일 없음·권한 부족·용량 부족과 지정된 입력 검증 오류는 일반적으로 Sentry 이슈로 올리지 않습니다. 상세 정보를 문자열로만 돌려주는 실패는 원본 문자열 대신 `TASK_FAILED`로 보고될 수 있어, 원인 분석에는 기존 로컬 로그가 필요할 수 있습니다.

## PostHog 이벤트 규격

이벤트·속성은 `electron/telemetry.js`의 허용 목록으로 제한합니다. 임의의 제목·경로·작업 옵션·결과 객체를 속성에 추가해도 전송되지 않습니다. 브라우저 SDK의 자동 계측 없이 메인 프로세스에서 `/capture/`로 직접 전송합니다.

| 이벤트 | 의미 | 주요 속성 |
| --- | --- | --- |
| `app_active` | 사용 통계 전송 활성화 또는 UTC 날짜가 바뀐 뒤 첫 관측 활동 | 공통 속성 |
| `menu_opened` | 사용자가 메뉴를 선택하거나 기능 이동으로 메뉴가 전환됨 | `menu`, `source` |
| `tool_opened` | 파일 도구에서 사용 가능한 도구를 열음 | `tool`, `source` |
| `feature_started` | 계측된 작업 시작 | `feature`, 선택적인 `format` |
| `feature_completed` | 계측된 작업이 정상 결과를 반환함 | `feature`, `duration_ms`, 선택적인 `format` |
| `feature_failed` | 계측된 작업이 실패를 반환하거나 예외 발생 | `feature`, `duration_ms` |
| `feature_cancelled` | 계측된 작업이 명시적으로 취소됨 | `feature`, `duration_ms` |
| `viewer_tts_used` | EPUB·텍스트 뷰어에서 TTS 음성이 실제로 재생됨 | `feature = viewer-tts`, `format`, `tts_engine`, `tts_model` |

공통 속성은 `distinct_id`, `app_version`, `os`입니다. OS 값은 `win32`, `darwin`, `linux`, `other` 중 하나이며 `platform`이라는 이벤트 속성을 사용하지 않습니다. `source`는 `menu`, `navigation`, `catalog`, `drop` 등 코드에 정의된 분류입니다. `duration_ms`는 최대 24시간으로 제한하며, `format`은 `comic`, `epub`, `pdf`, `text`, `audio` 중 하나입니다.

`app_active`는 실행 중인 프로세스에서 UTC 날짜당 최대 한 번 발생합니다. 앱을 재시작하거나 사용 통계를 껐다 다시 켜면 같은 날짜에도 발생할 수 있으므로 이벤트 횟수를 활성 설치 수로 해석하지 않습니다. 활동이 없는 앱에 주기적으로 발생시키는 타이머는 없습니다. 시작할 때 자동 복원된 탭과 이미 열려 있는 메뉴·도구의 반복 선택은 별도의 열기 이벤트로 기록하지 않습니다.

현재 계측 범위는 다음과 같습니다.

| 식별자 | 계측 대상과 해석 |
| --- | --- |
| 메뉴 `folder`, `organizer`, `renamer`, `metadata`, `tools`, `sharing`, `releases`, `settings` | 각 메뉴로 이동하거나 설정을 열기 |
| 도구 `text-cleaner`, `epub-editor` | 텍본 정리기·EPUB 제작 에디터 열기 |
| 기능 `archive-organizer`, `archive-renamer` | 압축 구조 정리·내부 파일명 변경 실행 |
| 기능 `metadata-save` | 메타데이터 저장 작업 |
| 기능 `text-cleaner` | 텍본 정리기의 저장 작업. 분석·편집 횟수 전체를 나타내지 않음 |
| 기능 `epub-save`, `epub-export`, `epub-import` | EPUB 제작 에디터의 저장·내보내기·가져오기 |
| 기능 `viewer-open` | 일반 내장 뷰어 세션 생성과 열기 요청. 외부 뷰어·미리보기·이전/다음 책 이동은 제외하며, 책의 렌더링 완료나 읽기 완료를 의미하지 않음 |
| 기능 `viewer-tts` | EPUB·텍스트 뷰어의 낭독 또는 선택한 텍스트 듣기에서 실제 재생한 엔진·모델. 전용 이벤트 `viewer_tts_used`로 전송 |
| 기능 `sharing-start` | 공유 서버 시작. 실제 접속자 수나 파일 전송량을 의미하지 않음 |

내장 뷰어의 모든 버튼·책갈피 등 아직 연결되지 않은 기능을 사용하지 않는 기능으로 판단하면 안 됩니다. 파일 도구 카탈로그의 다른 작업 탭 바로가기는 대상 메뉴의 `menu_opened`로 집계합니다.

### 뷰어 종류와 TTS 모델 확인

PostHog에서 아래 조건으로 별도 인사이트를 만들면 뷰어 종류와 TTS 모델별 사용량을 볼 수 있습니다. 기간은 최근 28일로 설정하고 `app_version = 0.0.0-telemetry-test`를 제외합니다. 집계는 이벤트 수와 고유 `distinct_id` 수를 사용하며, 고유 수는 로그인 사용자 수가 아닌 관측된 설치 수입니다.

| 분석 | 이벤트와 필터 | 속성별 분리 |
| --- | --- | --- |
| 뷰어 종류 | `feature_completed`, `feature = viewer-open` | `format`: `comic`(만화책), `epub`, `pdf`, `text`(텍스트), `audio`(오디오북) |
| TTS 모델 | `viewer_tts_used`, `feature = viewer-tts` | `tts_engine`, `tts_model`. 뷰어별 비교는 `format = epub` 또는 `text`로 필터 |

TTS 엔진과 모델은 다음 허용 값만 전송합니다.

| `tts_engine` | `tts_model` | 해석 |
| --- | --- | --- |
| `system` | `system` | 운영체제 음성 합성 사용. 개별 음성·모델 이름은 수집하지 않음 |
| `supertonic` | `supertonic-3` | Supertonic 3 사용 |
| `openai` | `gpt-4o-mini-tts`, `tts-1` | 실제 음성을 생성한 모델. `tts-1`로 대체 실행한 경우도 구분 |
| `google` | `google-cloud-default` | 앱이 모델을 지정하지 않는 Google Cloud 기본 서비스 사용. 실제 내부 모델 이름을 뜻하지 않음 |

`viewer_tts_used`는 뷰어 세션마다 엔진·모델 조합별로 한 번 전송합니다. 사용 통계를 껐다 다시 켜면 이후 재생에서 새 이벤트가 발생할 수 있습니다. 이벤트 수는 해당 조합을 사용한 뷰어 세션의 참고 수치이며, 버튼을 누른 횟수·문장 수·낭독 시간을 나타내지 않습니다. 음성을 미리 생성하는 동작, 설정의 음성 미리듣기, EPUB 제작 에디터 미리보기는 제외합니다. 미리 생성한 음성도 실제로 재생하면 집계합니다. 책 식별자·제목·본문·경로나 음성 이름·스타일·설정값은 전송하지 않습니다.

아래 운영 대시보드의 기존 SQL 인사이트 세 개에는 이 두 분석을 추가하지 않았습니다. TTS 모델 통계는 해당 계측이 포함된 앱을 배포한 뒤 실제 재생이 발생한 설치부터 쌓입니다.

## 최근 28일 대시보드

[운영 대시보드](https://us.posthog.com/project/642044/dashboard/2162649)는 아래 SQL 인사이트 세 개로 구성되어 있습니다. 각 쿼리는 실행 시점의 `now() - 28일`부터 `now()`까지를 집계하고, `app_version = '0.0.0-telemetry-test'`인 연결 검증 이벤트를 제외합니다.

| 인사이트 | 현재 집계 내용 |
| --- | --- |
| 활성 설치 | `app_active`의 기간 전체 `uniqExact(distinct_id)` |
| 메뉴·도구 사용 | 메뉴 8개와 도구 2개별 열기 횟수, 고유 사용 설치 수, 활성 설치 대비 사용 비율 |
| 기능 사용과 작업 결과 | 계측된 기능 9개별 고유 사용 설치 수와 시작·완료·실패·취소 건수 |

메뉴·도구 표는 위 계측 목록의 메뉴 8개와 도구 2개를 고정 목록으로 합친 뒤 이벤트 집계를 `LEFT JOIN`하여 사용량이 0인 항목도 표시합니다. 기능 표도 실제 계측된 기능 9개의 고정 목록을 사용합니다. 기능 사용 설치 수는 `feature_started`, `feature_completed`, `feature_failed`, `feature_cancelled` 중 하나라도 관측된 고유 `distinct_id` 수입니다. 시작 이벤트만을 기준으로 한 수와는 다를 수 있습니다.

기간과 테스트 버전 제외 조건이 SQL에 직접 들어 있으므로 대시보드 상단의 날짜·속성 필터를 바꾸어도 현재 세 인사이트에 적용되지 않습니다. 다른 기간이나 특정 `app_version`·`os`를 분석하려면 해당 SQL 조건을 수정하거나 별도 인사이트를 만듭니다.

메뉴·도구 사용 비율은 해당 항목을 쓴 고유 설치 수를 같은 기간의 활성 설치 수로 나눕니다. 일별 고유 수를 합산하면 같은 설치가 중복되므로 기간 전체 고유 수로 계산합니다. 창 종료·전송 누락·기간 경계 때문에 시작과 종료 횟수가 맞지 않을 수 있습니다. 작업 ID를 보내지 않아 개별 실행을 정확히 짝지은 감사 기록으로는 사용할 수 없습니다.

추가 분석으로는 버전·OS별 추이, `feature_completed`의 `duration_ms` 중앙값·상위 백분위, 다른 날의 반복 사용을 별도 Trends 인사이트로 만들 수 있습니다. 성공률도 완료 건수를 완료·실패·취소 건수의 합으로 나눈 참고 지표로 추가할 수 있으며 시작 건수와 함께 해석합니다. 이 항목들은 현재 세 인사이트에 포함되어 있지 않습니다. 집계와 속성별 분리는 [Trends 공식 문서](https://posthog.com/docs/product-analytics/trends/overview)를 참고합니다.

새 메뉴·도구·기능을 계측하면 대시보드 SQL의 고정 목록도 함께 갱신합니다. `src/fileTools.js`의 사용 가능한 도구, `src/appShell.js`의 메뉴 정의, 이 문서의 실제 계측 목록을 대조해 0과 미계측을 구분합니다. 신규 기능은 제공된 앱 버전의 설치만 비교하고 준비 중인 도구는 분석 대상에서 제외합니다.

로그인 사용자 수가 아닌 사용 통계 설정이 켜져 있고 이벤트가 수신된 설치 수입니다. 여러 기기, 앱 데이터 복사·삭제, 사용 통계를 껐다 다시 켜는 것은 집계에 영향을 줍니다. 사용 통계를 끈 설치·구버전·오프라인 실행은 관측되지 않으며, 도입 이전의 사용 기록을 복원하지 않습니다.

## 전송과 장애 처리

전송은 앱 작업과 분리해 수행하며, 네트워크 오류나 SDK 로드 실패를 원래 작업에 전파하지 않습니다. 메모리 대기는 최대 40건, 동시 요청은 2건, 요청 제한 시간은 기본 3초입니다. 사용 이벤트는 분당 120건, 오류는 분당 20건으로 제한합니다. 초과·실패한 이벤트를 디스크에 저장하거나 오프라인에서 다시 전송하지 않습니다. 사용 통계를 끄기 전에 시작된 작업의 종료 이벤트는 설정을 껐다 다시 켜도 수집하지 않습니다.

이 구조는 정상 동작을 방해하지 않는 범위에서 개선용 신호를 얻기 위한 것입니다. 결제·감사·정확한 총 사용자 수를 위한 기록으로 사용하지 않습니다.

## 검증

실제 외부 수집 키 없이도 사용 설정 기본값, 허용 목록, 민감 정보 제거, 저장한 ID 복원과 삭제, 네트워크 오류·전송 중단, IPC 호출 주체, 작업 결과 분류를 검증할 수 있습니다.

```bash
node --test electron/telemetry.test.js electron/observability.test.js electron/configManager.test.js src/telemetry.test.js src/settingsPolicy.test.js
node --test electron/viewerTelemetry.test.js src/viewerTtsTelemetry.test.js src/viewerTtsHistory.test.js src/viewerSelectionToolbar.test.js
npx vite build
```

배포 전에는 설정이 없는 상태·각 항목만 켠 상태·사용 설정을 끈 상태를 실제 앱에서 확인합니다. 서비스 수신 확인은 테스트 프로젝트에서 메뉴 열기와 계측된 작업을 수행한 후 PostHog 이벤트를 확인하고, Sentry에는 책 정보가 없는 테스트 오류를 보고해 확인합니다. 외부 프로젝트와 대시보드 생성 여부는 각 서비스 화면에서 별도로 확인해야 합니다.
