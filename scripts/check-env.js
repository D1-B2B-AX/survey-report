/**
 * check-env.js — 환경 확인 스크립트
 *
 * 플러그인 첫 실행 시 (report.md Phase 0) 아래 항목을 확인한다:
 *   1. Node.js 설치 여부
 *   2. npm 패키지 설치 여부 (node_modules)
 *   3. 서비스 계정 credentials 파일 존재 여부
 *
 * 사용법:
 *   node scripts/check-env.js
 *
 * 출력: JSON — 항목별 상태 + 전체 준비 여부
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 플러그인 루트 경로 (scripts/ 의 상위)
const PLUGIN_ROOT = path.join(__dirname, '..');
const NODE_MODULES_PATH = path.join(PLUGIN_ROOT, 'node_modules');
const PACKAGE_JSON_PATH = path.join(PLUGIN_ROOT, 'package.json');

function main() {
  const checks = {
    nodeJs: checkNodeJs(),
    packages: checkPackages(),
    update: checkForUpdate(),
  };

  checks.allReady = checks.nodeJs.ok && checks.packages.ok;

  // 현재 시각 — LLM이 시각을 추측하지 않고 이 값을 사용
  const now = new Date();
  const kstOffset = 9 * 60 * 60 * 1000;
  const kst = new Date(now.getTime() + kstOffset);
  checks.currentTime = now.toISOString();
  checks.currentTimeKST = kst.toISOString().slice(0, 16).replace('T', ' ');
  checks.fileTimestamp = kst.toISOString().slice(0, 10).replace(/-/g, '') + '_' + kst.toISOString().slice(11, 13) + kst.toISOString().slice(14, 16);

  // 플러그인 버전 (package.json에서 읽기)
  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf-8'));
    checks.pluginVersion = pkg.version || 'unknown';
  } catch {
    checks.pluginVersion = 'unknown';
  }

  console.log(JSON.stringify(checks, null, 2));

  if (!checks.allReady) {
    process.exit(1);
  }
}

// ============================================================
// 1. Node.js 설치 여부
// ============================================================

function checkNodeJs() {
  try {
    const version = execSync('node -v', { encoding: 'utf-8' }).trim();
    return {
      ok: true,
      version,
    };
  } catch {
    // 자동 설치 시도 (Windows: winget)
    try {
      console.error('Node.js가 없습니다. 자동 설치를 시도합니다...');
      execSync('winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements', {
        encoding: 'utf-8',
        stdio: 'inherit',
      });
      // 설치 후 재확인
      const version = execSync('node -v', { encoding: 'utf-8' }).trim();
      return {
        ok: true,
        version,
        autoInstalled: true,
      };
    } catch {
      return {
        ok: false,
        message: 'Node.js 자동 설치에 실패했습니다.',
        fix: 'https://nodejs.org 에서 LTS 버전을 직접 설치해주세요.',
      };
    }
  }
}

// ============================================================
// 2. npm 패키지 설치 여부
// ============================================================

function checkPackages() {
  const requiredPackages = ['xlsx'];

  // node_modules 존재 여부 또는 필수 패키지 누락 확인
  const needsInstall = !fs.existsSync(NODE_MODULES_PATH) ||
    requiredPackages.some(pkg => !fs.existsSync(path.join(NODE_MODULES_PATH, pkg)));

  if (needsInstall) {
    // 자동 설치 시도
    try {
      console.error('필요한 패키지를 자동 설치합니다...');
      execSync('npm install', {
        cwd: PLUGIN_ROOT,
        encoding: 'utf-8',
        stdio: 'inherit',
      });

      // 설치 후 재확인
      const stillMissing = requiredPackages.filter(pkg =>
        !fs.existsSync(path.join(NODE_MODULES_PATH, pkg))
      );

      if (stillMissing.length > 0) {
        return {
          ok: false,
          message: `자동 설치 후에도 패키지가 누락되었습니다: ${stillMissing.join(', ')}`,
          fix: `${PLUGIN_ROOT} 폴더에서 npm install 을 직접 실행해주세요.`,
        };
      }

      return {
        ok: true,
        installedPackages: requiredPackages,
        autoInstalled: true,
      };
    } catch {
      return {
        ok: false,
        message: '패키지 자동 설치에 실패했습니다.',
        fix: `${PLUGIN_ROOT} 폴더에서 npm install 을 직접 실행해주세요.`,
      };
    }
  }

  return {
    ok: true,
    installedPackages: requiredPackages,
  };
}


// ============================================================
// 3. 플러그인 업데이트 확인
// ============================================================

function checkForUpdate() {
  try {
    // git 레포인지 확인
    execSync('git rev-parse --git-dir', {
      cwd: PLUGIN_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
  } catch {
    // git 레포가 아니면 (수동 설치 등) 체크 건너뜀
    return { ok: true, skipped: true, reason: 'git 레포가 아님' };
  }

  try {
    // 원격에서 최신 정보 가져오기 (다운로드는 안 함)
    execSync('git fetch origin', {
      cwd: PLUGIN_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 10000, // 10초 타임아웃
    });

    // 로컬과 원격의 차이 확인
    const local = execSync('git rev-parse HEAD', {
      cwd: PLUGIN_ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();

    let remote;
    try {
      remote = execSync('git rev-parse origin/main', {
        cwd: PLUGIN_ROOT,
        encoding: 'utf-8',
        stdio: 'pipe',
      }).trim();
    } catch {
      // origin/main이 없으면 origin/master 시도
      try {
        remote = execSync('git rev-parse origin/master', {
          cwd: PLUGIN_ROOT,
          encoding: 'utf-8',
          stdio: 'pipe',
        }).trim();
      } catch {
        return { ok: true, skipped: true, reason: '원격 브랜치를 찾을 수 없음' };
      }
    }

    if (local === remote) {
      return { ok: true, upToDate: true };
    } else {
      return {
        ok: true,
        upToDate: false,
        message: '플러그인 업데이트가 있습니다.',
        action: 'UPDATE_AVAILABLE',
      };
    }
  } catch {
    // 네트워크 안 되면 조용히 넘어감
    return { ok: true, skipped: true, reason: '네트워크 연결 불가 — 업데이트 확인 건너뜀' };
  }
}

// ============================================================
// 실행
// ============================================================

main();
