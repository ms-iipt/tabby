# 플러그인 오프라인 설치

내부망(인터넷 차단) 환경에서 Tabby 플러그인을 설치하는 방법입니다.

## 요약

**인터넷 없이 설치할 수 있습니다.** Tabby는 시작할 때 지정된 디렉터리들을 스캔해서
플러그인을 찾으므로, 폴더를 통째로 넣어주면 됩니다. 앱 내부의 플러그인 스토어(npm 검색)는
이 포크에서 제거되었으므로 온라인 설치 경로는 아예 없습니다.

---

## 1. 플러그인이 로드되는 위치

[app/src/plugins.ts](app/src/plugins.ts)가 아래 경로들을 스캔합니다.

| 위치 | 용도 |
|---|---|
| `<userData>/plugins/node_modules/` | **사용자 설치 플러그인** — 여기에 넣습니다 |
| `<resources>/builtin-plugins/` | 앱에 내장된 기본 플러그인 (건드리지 않음) |
| `$TABBY_PLUGINS` (`:` 구분 다중 경로) | 추가 검색 경로 — 공유 폴더 배포 등에 활용 |

`<userData>` 실제 경로:

| OS | 경로 |
|---|---|
| Windows | `%APPDATA%\tabby\plugins\node_modules\` |
| macOS | `~/Library/Application Support/tabby/plugins/node_modules/` |
| Linux | `~/.config/tabby/plugins/node_modules/` |

앱에서 바로 열 수도 있습니다: **Settings → Plugins → `Open plugins directory`**

### 인식 조건

`package.json`의 `keywords`에 다음 중 하나가 있어야 로드됩니다
(없으면 그냥 무시됩니다).

```
tabby-plugin   tabby-builtin-plugin   terminus-plugin   terminus-builtin-plugin
```

`main` 필드가 가리키는 파일이 실제로 존재해야 하고, 그 모듈은 `NgModule` 클래스를
default export 해야 합니다.

---

## 2. 설치 절차

### 인터넷 되는 PC에서 패키지 받기

플러그인은 일반 npm 패키지입니다. **의존성까지 함께** 받아야 합니다.

```bash
mkdir tabby-plugin-bundle && cd tabby-plugin-bundle
npm init -y

# 예: tabby-clippy
npm install --omit=dev tabby-clippy
```

`node_modules/` 안에 플러그인과 그 의존성이 모두 들어옵니다. 이 폴더를 압축해서
내부망으로 옮깁니다.

```bash
tar czf tabby-plugin-bundle.tar.gz node_modules
```

> `npm pack`으로 받은 `.tgz` 하나만 옮기면 **의존성이 빠져서 로드에 실패합니다.**
> 반드시 `node_modules` 전체를 옮기세요.

### 내부망 PC에 넣기

플러그인 디렉터리의 `node_modules` 안에 풀어놓습니다.

**Windows (PowerShell)**
```powershell
$dst = "$env:APPDATA\tabby\plugins\node_modules"
New-Item -ItemType Directory -Force $dst | Out-Null
tar -xzf tabby-plugin-bundle.tar.gz -C "$env:APPDATA\tabby\plugins"
```

**macOS / Linux**
```bash
dst="$HOME/Library/Application Support/tabby/plugins"   # Linux: ~/.config/tabby/plugins
mkdir -p "$dst"
tar xzf tabby-plugin-bundle.tar.gz -C "$dst"
```

최종 구조:

```
<userData>/plugins/
└── node_modules/
    ├── tabby-clippy/
    │   ├── package.json      ← keywords에 tabby-plugin 필요
    │   └── dist/index.js
    └── <의존 패키지들>/
```

**Tabby를 완전히 종료한 뒤 다시 실행하면** 로드됩니다. 플러그인 스캔은 시작 시 한 번만
수행되므로 재시작이 필요합니다.

### 확인

**Settings → Plugins** 목록에 나타나면 성공입니다. 안 보이면 아래를 확인하세요.

- `Ctrl+Shift+I`(macOS `Cmd+Option+I`) → DevTools 콘솔에 로드 오류가 찍힙니다
- `package.json`의 `keywords`에 `tabby-plugin`이 있는지
- `main`이 가리키는 파일이 실제로 있는지
- 플러그인이 요구하는 의존성이 `node_modules`에 함께 들어왔는지

---

## 3. 여러 PC에 한 번에 배포하기

공유 폴더나 로컬 경로를 `TABBY_PLUGINS`로 지정하면 사용자별 복사 없이 공용 플러그인을
쓸 수 있습니다. `:`로 여러 경로를 넘길 수 있습니다.

```powershell
# Windows - 사용자 환경변수로 영구 설정
setx TABBY_PLUGINS "\\fileserver\tabby-plugins"
```

```bash
# macOS / Linux
export TABBY_PLUGINS=/opt/tabby-plugins
```

이 경로도 **플러그인 폴더들을 직접 담고 있어야 합니다** (`node_modules` 한 단계를 더
두지 않습니다). 즉 `\\fileserver\tabby-plugins\tabby-clippy\package.json` 형태입니다.

---

## 4. 제거

해당 폴더를 지우고 Tabby를 재시작하면 됩니다. **Settings → Plugins** 의 제거 버튼도
동작하지만(로컬 파일 삭제만 수행), 폴더를 직접 지우는 편이 확실합니다.

---

## 5. 이 포크에서 달라진 점

내부망 배포를 위해 외부 통신 기능을 제거했습니다.

- **플러그인 스토어(npm 레지스트리 검색) 제거** — `Settings → Plugins`는 **이미 설치된**
  플러그인만 보여주고, 앱이 외부로 요청을 보내지 않습니다
  ([tabby-plugin-manager/src/services/pluginManager.service.ts](tabby-plugin-manager/src/services/pluginManager.service.ts))
- 자동 업데이트, 통계 전송(Mixpanel), 크래시 리포트(Sentry), 설정 동기화(api.tabby.sh) 제거

따라서 플러그인 추가는 **위의 오프라인 절차가 유일한 방법**입니다.
자세한 빌드/릴리즈는 [RELEASE.md](RELEASE.md)를 참고하세요.
