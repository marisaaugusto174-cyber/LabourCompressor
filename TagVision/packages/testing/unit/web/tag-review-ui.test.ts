import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const reviewHtml = readFileSync(
  path.join(process.cwd(), 'apps/web/public/review.html'),
  'utf8'
);
const reviewJs = readFileSync(
  path.join(process.cwd(), 'apps/web/public/tag-review.js'),
  'utf8'
);
const stylesCss = readFileSync(
  path.join(process.cwd(), 'apps/web/public/styles.css'),
  'utf8'
);
const indexHtml = readFileSync(
  path.join(process.cwd(), 'apps/web/public/index.html'),
  'utf8'
);
const launcherScript = readFileSync(
  path.join(process.cwd(), 'Start TagVision macOS.command'),
  'utf8'
);
const serverTs = readFileSync(
  path.join(process.cwd(), 'apps/web/server.ts'),
  'utf8'
);
const apiClientJs = readFileSync(
  path.join(process.cwd(), 'apps/web/public/api-client.js'),
  'utf8'
);
const formStateJs = readFileSync(
  path.join(process.cwd(), 'apps/web/public/form-state.js'),
  'utf8'
);
const localDialogsTs = readFileSync(
  path.join(process.cwd(), 'apps/web/local-dialogs.ts'),
  'utf8'
);
const packMacosSh = readFileSync(
  path.join(process.cwd(), 'scripts/pack-macos.sh'),
  'utf8'
);
const gitignore = readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8');
const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
) as {
  readonly version?: string;
  readonly description?: string;
  readonly scripts?: Record<string, string>;
  readonly files?: readonly string[];
  readonly dependencies?: Record<string, string>;
};

test('review ui exposes a compact local-only scan workflow', () => {
  for (const id of [
    'review-directory',
    'scan-button',
    'choose-review-directory',
    'review-grid',
    'detail-view'
  ]) {
    assert.equal(reviewHtml.includes(`id="${id}"`), true, `missing #${id}`);
  }

  for (const removedText of [
    'Label Studio',
    'download-ls-package',
    'ls-url',
    'ls-token',
    'ls-project-id',
    'import-ls',
    'sync-ls',
    'open-current-ls-task'
  ]) {
    assert.equal(reviewHtml.includes(removedText), false, `unexpected ${removedText} UI`);
  }

  for (const removedScriptText of [
    'labelStudio',
    '/label-studio/',
    'downloadLabelStudioPackage',
    'importIntoLabelStudio',
    'syncLabelStudio'
  ]) {
    assert.equal(reviewJs.includes(removedScriptText), false, `unexpected ${removedScriptText} browser logic`);
  }

  assert.match(reviewHtml, /class="review-source-bar"[\s\S]*id="review-directory"[\s\S]*id="choose-review-directory"[\s\S]*id="scan-button"/u);
  assert.equal(reviewHtml.includes('src="/tag-review.js'), true);
});

test('review page removes descriptive marketing and section copy', () => {
  for (const removedText of [
    '扫描片段视频、模型 JSON 和 taxonomy 快照，回看并写出人工确认的 accepted sidecar。',
    '只读取并扫描目录，不会改名、不改原始 JSON。',
    '递归扫描视频、同名 JSON 和 taxonomy 快照。',
    '滚动时增量加载卡片，视频只在接近视口时挂载。',
    '诊断与日志',
    '检视来源',
    '多视频预览',
    '本地检视',
    '人工 accepted 结果'
  ]) {
    assert.equal(reviewHtml.includes(removedText), false, `unexpected descriptive copy: ${removedText}`);
  }

  assert.match(reviewHtml, /<h1>TagVision<\/h1>/u);
  assert.match(reviewHtml, /<a class="chip" href="\/">入口<\/a>/u);
  assert.match(reviewHtml, /<section id="review-diagnostics-panel" class="panel review-diagnostics-panel hidden"/u);
});

test('review page uses static white Liquid Glass with blue pink aurora background', () => {
  assert.match(stylesCss, /--glass-surface:/u);
  assert.match(stylesCss, /--glass-border:/u);
  assert.match(stylesCss, /--aurora-blue:/u);
  assert.match(stylesCss, /--aurora-pink:/u);
  assert.match(stylesCss, /body\s*\{[\s\S]*radial-gradient\(circle at 16% 18%,\s*var\(--aurora-blue\)/u);
  assert.match(stylesCss, /body\s*\{[\s\S]*background-attachment:\s*fixed/su);
  assert.match(stylesCss, /\.panel,\s*\.subpanel,\s*\.status-card,\s*\.review-card\s*\{[\s\S]*backdrop-filter:\s*blur\(24px\) saturate\(1\.45\)/u);
  assert.match(stylesCss, /\.panel::before,\s*\.subpanel::before,\s*\.status-card::before,\s*\.review-card::before/u);
  assert.match(stylesCss, /@supports\s+not\s+\(\(backdrop-filter:\s*blur\(1px\)\)\)\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.96\)/u);
  assert.doesNotMatch(stylesCss, /animation:\s*aurora/u);
  assert.doesNotMatch(stylesCss, /canvas/i);
});

test('review page uses rounder shared radius tokens for glass modules', () => {
  assert.match(stylesCss, /--radius-surface:\s*32px/u);
  assert.match(stylesCss, /--radius-card:\s*28px/u);
  assert.match(stylesCss, /--radius-inner:\s*22px/u);
  assert.match(stylesCss, /--radius-control:\s*18px/u);
  assert.match(stylesCss, /\.panel,\s*\.subpanel\s*\{[\s\S]*border-radius:\s*var\(--radius-surface\)/u);
  assert.match(stylesCss, /\.status-card,\s*\.review-card\s*\{[\s\S]*border-radius:\s*var\(--radius-card\)/u);
  assert.match(stylesCss, /button\s*\{[\s\S]*border-radius:\s*var\(--radius-control\)/u);
  assert.match(stylesCss, /input,\s*select\s*\{[\s\S]*border-radius:\s*var\(--radius-control\)/u);
  assert.match(stylesCss, /\.review-source-bar\s*\{[\s\S]*border-radius:\s*var\(--radius-card\)/u);
  assert.match(stylesCss, /\.review-player\s*\{[\s\S]*border-radius:\s*var\(--radius-card\)/u);
  assert.match(stylesCss, /\.review-tag-compact\s*\{[\s\S]*border-radius:\s*var\(--radius-inner\)/u);
});

test('review diagnostics panel is hidden until anomalies or action errors occur', () => {
  assert.match(reviewJs, /diagnosticsPanel:\s*document\.querySelector\('#review-diagnostics-panel'\)/u);
  assert.match(reviewJs, /function hideDiagnosticsPanel\(\)\s*\{[\s\S]*refs\.diagnosticsPanel\.classList\.add\('hidden'\)/u);
  assert.match(reviewJs, /function showDiagnosticsPanel\(\)\s*\{[\s\S]*refs\.diagnosticsPanel\.classList\.remove\('hidden'\)/u);
  assert.match(reviewJs, /if \(rows\.length === 0\)\s*\{[\s\S]*hideDiagnosticsPanel\(\);[\s\S]*return;/u);
  assert.match(reviewJs, /refs\.diagnosticsPanel\.classList\.remove\('hidden'\)/u);
  assert.match(reviewJs, /showDiagnostics\(\[\{ severity: 'error', message: error\.message \}\]\)/u);
  assert.match(reviewHtml, /id="review-diagnostics-panel"[^>]*hidden/u);
});

test('review controls and detail surfaces keep neutral glass without gradient button fills', () => {
  assert.match(stylesCss, /button\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.62\)/u);
  assert.match(stylesCss, /button\s*\{[\s\S]*backdrop-filter:\s*blur\(18px\) saturate\(1\.35\)/u);
  assert.match(stylesCss, /\.review-card-video\s*\{[\s\S]*background:\s*#0f172a/su);
  assert.match(stylesCss, /\.review-card-video\s+img\s*\{[\s\S]*object-fit:\s*cover/su);
  assert.match(stylesCss, /\.review-player\s*\{[\s\S]*background:\s*rgba\(15,\s*23,\s*42,\s*0\.94\)/u);
  assert.match(stylesCss, /\.review-tag-compact\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.74\)/u);
  assert.match(stylesCss, /\.accepted-path-row\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.72\)/u);
  assert.doesNotMatch(stylesCss, /button\s*\{[^}]*linear-gradient/su);
});

test('main web ui links to the tag review page', () => {
  assert.equal(indexHtml.includes('href="/review.html"'), true);
  assert.match(indexHtml, /<h1>TagVision<\/h1>/u);
  assert.equal(indexHtml.includes('进入检视台'), true);
  assert.equal(indexHtml.includes('Labour Compressor'), false);

  for (const removedText of [
    'TagVision V0.5.1 macOS',
    '本地审核入口：扫描片段视频',
    'Local sidecar JSON',
    'Manual accepted result',
    'Taxonomy snapshot',
    '审核入口'
  ]) {
    assert.equal(indexHtml.includes(removedText), false, `unexpected entry copy: ${removedText}`);
  }
});

test('release metadata names the local tool as TagVision V0.5.1 macOS', () => {
  assert.equal(packageJson.name, 'tagvision-macos');
  assert.equal(packageJson.version, '0.5.1');
  assert.match(packageJson.description ?? '', /TagVision V0\.5\.1 macOS/u);
  assert.equal(packageJson.scripts?.['pack:macos:v0.5.1'], 'bash scripts/pack-macos.sh');
  assert.equal(packageJson.files?.includes('apps/'), true);
  assert.equal(packageJson.files?.includes('Start TagVision macOS.command'), true);
  assert.equal(packageJson.files?.includes('TagVision macOS Manual Terminal Startup.txt'), true);
  assert.equal(reviewHtml.includes('TagVision'), true);
  assert.equal(reviewHtml.includes('TagVision V0.5.1 macOS'), false);
  assert.equal(reviewHtml.includes('Release: TagVision V0.5.1 macOS'), false);
});

test('review detail opens as a fixed fullscreen modal and disables page autoload', () => {
  assert.match(reviewHtml, /id="detail-view"[^>]*review-detail-modal/u);
  assert.match(stylesCss, /\.review-detail-modal\s*\{[^}]*position:\s*fixed/su);
  assert.match(stylesCss, /\.is-review-modal-open\s*\{[^}]*overflow:\s*hidden/su);
  assert.equal(reviewJs.includes("document.body.classList.add('is-review-modal-open')"), true);
  assert.match(reviewJs, /function maybeAutoLoadMore\(\)\s*\{[\s\S]*?if \(isDetailOpen\(\)\) \{/u);
  assert.doesNotMatch(reviewJs, /function openDetail\(index\)\s*\{[\s\S]*?scrollIntoView/u);
});

test('review detail exposes accepted path editor and save action', () => {
  for (const id of [
    'accepted-path-list',
    'accepted-path-select',
    'add-accepted-path',
    'save-accepted-result'
  ]) {
    assert.equal(reviewHtml.includes(`id="${id}"`), true, `missing #${id}`);
  }

  assert.equal(reviewJs.includes("apiPost('/api/tag-review/accepted'"), true);
  assert.equal(reviewJs.includes('renderAcceptedPathOptions'), true);
  assert.ok(
    reviewHtml.indexOf('id="detail-tags"') < reviewHtml.indexOf('class="review-accepted-editor"'),
    'detail tags should render before the accepted path editor'
  );
  assert.match(stylesCss, /\.review-tag-panel\s*\{[^}]*display:\s*block/su);
  assert.doesNotMatch(stylesCss, /#detail-tags\s*\{[^}]*flex:/su);
  assert.match(stylesCss, /\.review-accepted-editor\s*\{[^}]*margin-top:\s*12px/su);
  assert.match(stylesCss, /\.review-accepted-editor\s+h3\s*\{[^}]*font-size:\s*13px/su);
  assert.match(stylesCss, /\.accepted-path-list\s*\{[^}]*flex-wrap:\s*wrap/su);
  assert.match(stylesCss, /\.accepted-path-list\.empty-state\s+p\s*\{[^}]*font-size:\s*12px/su);
  assert.match(stylesCss, /\.accepted-path-row\s*\{[^}]*border:\s*1px solid rgba\(148,\s*163,\s*184,\s*0\.24\)/su);
  assert.match(stylesCss, /\.accepted-path-row\s+span\s*\{[^}]*font-size:\s*12px/su);
  assert.match(stylesCss, /\.accepted-path-row\s+button\s*\{[^}]*font-size:\s*12px/su);
  assert.doesNotMatch(stylesCss, /\.accepted-path-list\s*\{[^}]*overflow-x:\s*auto/su);
  assert.doesNotMatch(stylesCss, /\.accepted-path-list\s*\{[^}]*white-space:\s*nowrap/su);
  assert.doesNotMatch(reviewJs, /refs\.saveAcceptedResult\.disabled = !\(currentScan\?\.taxonomySnapshot\?\.paths\?\.length > 0\)/u);
  assert.match(reviewJs, /selectedAcceptedPaths\.length === 0[\s\S]*updateAcceptedSaveState\(\);[\s\S]*return;/u);
});

test('review detail exposes keyboard shortcuts', () => {
  assert.match(reviewJs, /import \{ handleReviewShortcut \} from '\.\/review-shortcuts\.js'/u);
  assert.match(reviewJs, /handleReviewShortcut\(\{/u);
  assert.equal(reviewHtml.includes('← 上一个　空格 播放/暂停　→ 下一个　Esc 关闭'), false);
  assert.match(reviewHtml, /id="previous-detail"[^>]*hidden/u);
  assert.match(reviewHtml, /id="next-detail"[^>]*hidden/u);
  assert.ok(
    [...stylesCss.matchAll(/\.review-detail-nav\s*\{[^}]*justify-content:\s*center[^}]*\}/gs)].length >= 2,
    'detail nav should stay centered in base and narrow layouts'
  );
});

test('review detail integrates Plyr and adaptive one-screen layout', () => {
  assert.equal(reviewHtml.includes('href="/vendor/plyr.css"'), true);
  assert.equal(reviewHtml.includes('src="/vendor/plyr.js"'), true);
  assert.equal(reviewHtml.includes('id="review-player-stage"'), true);
  assert.equal(reviewHtml.includes('id="tag-evidence-overlay"'), true);
  assert.match(reviewJs, /createReviewPlayer/u);
  assert.match(reviewJs, /classifyVideoOrientation/u);
  assert.match(reviewJs, /fitVideoSize/u);
  assert.match(reviewJs, /ResizeObserver/u);
  assert.match(reviewJs, /data-video-orientation/u);
  assert.match(reviewJs, /review-tag-compact/u);
  assert.match(stylesCss, /--review-player-width/u);
  assert.match(stylesCss, /--review-player-height/u);
  assert.match(stylesCss, /--review-player-ratio/u);
  assert.match(stylesCss, /\.review-player\s+video\s*\{[^}]*object-fit:\s*contain/su);
  assert.match(stylesCss, /\.review-player\s+\.plyr__poster\s*\{[^}]*display:\s*none/su);
  assert.match(stylesCss, /\.review-tag-panel\s*\{[^}]*overflow:\s*auto/su);
});

test('review player keeps the source aspect ratio when fullscreen', () => {
  assert.match(stylesCss, /\.review-player\s+\.plyr__video-wrapper\s+video\s*\{[^}]*object-fit:\s*contain/su);
  assert.match(stylesCss, /\.review-player\s+\.plyr--fullscreen\s+video,\s*\.review-player\s+\.plyr:fullscreen\s+video,\s*\.review-player\s+video:fullscreen\s*\{[^}]*object-fit:\s*contain/su);
  assert.doesNotMatch(stylesCss, /\.review-player\s+video\s*\{[^}]*object-fit:\s*fill/su);
  assert.doesNotMatch(stylesCss, /\.review-player\s+\.plyr__video-wrapper\s+video\s*\{[^}]*object-fit:\s*fill/su);
});

test('review detail tags show full paths and adapt column count to available panel width', () => {
  assert.match(stylesCss, /\.review-tag-panel\s*\{[^}]*container-type:\s*inline-size/su);
  assert.match(stylesCss, /\.review-tag-list\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(260px,\s*1fr\)\)/su);
  assert.match(stylesCss, /\.review-tag-compact\s+strong,\s*\.review-tag-compact\s+span\s*\{[^}]*white-space:\s*normal/su);
  assert.match(stylesCss, /\.review-tag-compact\s+strong,\s*\.review-tag-compact\s+span\s*\{[^}]*overflow:\s*visible/su);
  assert.doesNotMatch(stylesCss, /\.review-tag-compact\s+strong,\s*\.review-tag-compact\s+span\s*\{[^}]*text-overflow:\s*ellipsis/su);
  assert.doesNotMatch(stylesCss, /\.review-tag-list\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/su);
  assert.match(stylesCss, /@container\s*\(max-width:\s*620px\)/u);
});

test('review detail tag cards show evidence notes without opening overlay', () => {
  assert.match(reviewJs, /class="review-tag-reason"/u);
  assert.match(reviewJs, /tag\.evidenceNote/u);
  assert.match(reviewJs, /标注理由/u);
  assert.doesNotMatch(reviewJs, /data-tag-evidence-index/u);
  assert.doesNotMatch(reviewJs, /bindTagEvidenceButtons/u);
  assert.match(stylesCss, /\.review-tag-reason\s*\{[^}]*white-space:\s*normal/su);
  assert.match(stylesCss, /\.review-tag-reason\s*\{[^}]*overflow-wrap:\s*anywhere/su);
  assert.doesNotMatch(stylesCss, /\.review-tag-reason\s*\{[^}]*text-overflow:\s*ellipsis/su);
});

test('review cards use thumbnail images instead of mounting videos', () => {
  assert.match(reviewJs, /function thumbnailUrl/u);
  assert.match(reviewJs, /\/api\/tag-review\/thumbnail/u);
  assert.match(reviewJs, /<img[^>]+data-src="\$\{escapeHtml\(thumbnailUrl\(item\)\)\}"/u);
  assert.doesNotMatch(reviewJs, /<video muted playsinline preload="none"/u);
});

test('review cards expose a compact cover layout with stable tag overflow', () => {
  assert.match(reviewJs, /review-card-cover-bar/u);
  assert.match(reviewJs, /review-card-media-type/u);
  assert.match(reviewJs, /remainingTagCount/u);
  assert.match(reviewJs, /review-card-tag-more/u);
  assert.match(reviewJs, /review-card-tag-empty/u);
  assert.match(reviewJs, /#\$\{index \+ 1\}/u);
  assert.match(stylesCss, /\.review-card-video::after/u);
  assert.match(stylesCss, /\.review-card-title strong/u);
  assert.match(stylesCss, /text-overflow: ellipsis/u);
});

test('review page exposes a minimal fixed tick scroll ruler preview', () => {
  assert.match(reviewHtml, /id="review-scroll-ruler"/u);
  assert.match(reviewHtml, /id="review-scroll-ruler-track"/u);
  assert.match(reviewHtml, /id="review-scroll-ruler-tooltip"/u);
  assert.doesNotMatch(reviewHtml, /快捷目录/u);
  assert.match(reviewJs, /const REVIEW_RULER_TARGET_TICK_GAP = 26/u);
  assert.match(reviewJs, /const REVIEW_RULER_MAX_VISIBLE_TICK_COUNT = 24/u);
  assert.match(reviewJs, /const REVIEW_RULER_RESPONSE_SEGMENTS_PER_TICK = 4/u);
  assert.match(reviewJs, /const REVIEW_RULER_DOCK_MAGNIFICATION_RADIUS = 4/u);
  assert.match(reviewJs, /const REVIEW_RULER_DOCK_BASE_TICK_WIDTH = 24/u);
  assert.match(reviewJs, /const REVIEW_RULER_DOCK_MAX_TICK_WIDTH = 72/u);
  assert.match(reviewJs, /function renderScrollRuler/u);
  assert.match(reviewJs, /function calculateScrollRulerVisibleTickCount/u);
  assert.match(reviewJs, /function readScrollRulerPointerState/u);
  assert.match(reviewJs, /function updateScrollRulerHoverFromPointer/u);
  assert.match(reviewJs, /function setScrollRulerExpandedState/u);
  assert.match(reviewJs, /function collapseScrollRulerIfPointerOutside/u);
  assert.match(reviewJs, /function applyScrollRulerDockMagnification/u);
  assert.match(reviewJs, /function resetScrollRulerDockMagnification/u);
  assert.match(reviewJs, /function buildScrollRulerTickRange/u);
  assert.match(reviewJs, /function buildScrollRulerPointerRange/u);
  assert.match(reviewJs, /function jumpToScrollRulerPointerPosition/u);
  assert.match(reviewJs, /function ensureRenderedThrough/u);
  assert.match(reviewJs, /refs\.scrollRuler\.addEventListener\('pointerenter', \(\) => setScrollRulerExpandedState\(true\)\)/u);
  assert.match(reviewJs, /refs\.scrollRuler\.addEventListener\('pointermove', updateScrollRulerHoverFromPointer\)/u);
  assert.match(reviewJs, /refs\.scrollRuler\.addEventListener\('click', jumpToScrollRulerPointerPosition\)/u);
  assert.match(reviewJs, /refs\.scrollRuler\.addEventListener\('pointerleave', \(\) => \{[\s\S]*?setScrollRulerExpandedState\(false\)/u);
  assert.match(reviewJs, /window\.addEventListener\('pointermove', collapseScrollRulerIfPointerOutside, \{ passive: true \}\)/u);
  assert.match(reviewJs, /window\.addEventListener\('scroll', updateScrollRulerActiveState/u);
  assert.match(reviewJs, /pointerRatio/u);
  assert.match(reviewJs, /applyScrollRulerDockMagnification\(pointerState\.pointerRatio\)/u);
  assert.match(reviewJs, /resetScrollRulerDockMagnification\(\)/u);
  assert.match(reviewJs, /scrollIntoView\(\{ block: 'start', behavior: 'smooth' \}\)/u);
  assert.doesNotMatch(reviewJs, /findScrollRulerTick\(event\.target\)/u);
  assert.match(stylesCss, /\.review-scroll-ruler\s*\{[^}]*position:\s*fixed/su);
  assert.match(stylesCss, /--review-ruler-reserve:\s*calc\(var\(--review-ruler-right\) \+ var\(--review-ruler-width\)\)/u);
  assert.match(stylesCss, /--review-ruler-content-gap:\s*clamp\(18px,\s*2vw,\s*28px\)/u);
  assert.match(stylesCss, /--review-ruler-right:\s*clamp\(36px,\s*3\.2vw,\s*52px\)/u);
  assert.match(stylesCss, /--review-ruler-width:\s*clamp\(64px,\s*5vw,\s*86px\)/u);
  assert.match(stylesCss, /--review-ruler-track-width:\s*clamp\(44px,\s*3\.8vw,\s*58px\)/u);
  assert.match(stylesCss, /--review-ruler-expanded-track-width:\s*clamp\(78px,\s*7vw,\s*112px\)/u);
  assert.match(stylesCss, /--review-ruler-expanded-scale:\s*1\.18/u);
  assert.match(stylesCss, /\.review-page\s*\{[^}]*max-width:\s*calc\(1320px \+ var\(--review-ruler-reserve\) \+ var\(--review-ruler-content-gap\)\)/su);
  assert.match(stylesCss, /\.review-page\s*\{[^}]*padding-right:\s*calc\(var\(--review-ruler-reserve\) \+ var\(--review-ruler-content-gap\)\)/su);
  assert.match(stylesCss, /\.review-page\s*\{[^}]*box-sizing:\s*border-box/su);
  assert.match(stylesCss, /\.review-scroll-ruler\s*\{[^}]*right:\s*0/su);
  assert.match(stylesCss, /\.review-scroll-ruler\s*\{[^}]*width:\s*var\(--review-ruler-reserve\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler\s*\{[^}]*padding-right:\s*var\(--review-ruler-right\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler\s*\{[^}]*height:\s*clamp\(420px,\s*72vh,\s*640px\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler\s*\{[^}]*cursor:\s*pointer/su);
  assert.match(stylesCss, /\.review-scroll-ruler-track\s*\{[^}]*width:\s*var\(--review-ruler-track-width\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler-track\s*\{[^}]*height:\s*100%/su);
  assert.match(stylesCss, /\.review-scroll-ruler-track\s*\{[^}]*cursor:\s*pointer/su);
  assert.match(stylesCss, /\.review-scroll-ruler\.is-expanded\s+\.review-scroll-ruler-track\s*\{[^}]*width:\s*var\(--review-ruler-expanded-track-width\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler\.is-expanded\s+\.review-scroll-ruler-track\s*\{[^}]*transform:\s*scaleX\(var\(--review-ruler-expanded-scale\)\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler-tick\s*\{[^}]*width:\s*14px/su);
  assert.match(stylesCss, /\.review-scroll-ruler-tick\s*\{[^}]*cursor:\s*pointer/su);
  assert.match(stylesCss, /\.review-scroll-ruler-tick:hover,\s*\.review-scroll-ruler-tick\.is-hovered\s*\{[^}]*width:\s*38px/su);
  assert.match(stylesCss, /\.review-scroll-ruler\.is-expanded\s+\.review-scroll-ruler-tick\s*\{[^}]*width:\s*var\(--scroll-ruler-dock-width,\s*24px\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler\.is-expanded\s+\.review-scroll-ruler-tick::before\s*\{[^}]*height:\s*var\(--scroll-ruler-dock-line-height,\s*2px\)/su);
  assert.doesNotMatch(stylesCss, /\.review-scroll-ruler\.is-expanded[\s\S]*width:\s*46px/su);
  assert.match(stylesCss, /\.review-scroll-ruler-tooltip\s*\{[^}]*position:\s*absolute/su);
  assert.match(stylesCss, /\.review-scroll-ruler\.is-expanded\s+\.review-scroll-ruler-tooltip\s*\{[^}]*right:\s*calc\(var\(--review-ruler-right\) \+ var\(--review-ruler-expanded-track-width\) \+ 12px\)/su);
  assert.match(stylesCss, /--ruler-tick-level-1:\s*rgba\(15,\s*23,\s*42,\s*0\.18\)/u);
  assert.match(stylesCss, /--ruler-tick-level-2:\s*rgba\(15,\s*23,\s*42,\s*0\.44\)/u);
  assert.match(stylesCss, /--ruler-tick-level-3:\s*rgba\(15,\s*23,\s*42,\s*0\.76\)/u);
  assert.match(stylesCss, /\.review-scroll-ruler-tick::before\s*\{[^}]*background:\s*var\(--ruler-tick-level-1\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler-tick\.is-active::before\s*\{[^}]*background:\s*var\(--ruler-tick-level-2\)/su);
  assert.match(stylesCss, /\.review-scroll-ruler-tick:hover::before,\s*\.review-scroll-ruler-tick\.is-hovered::before\s*\{[^}]*background:\s*var\(--ruler-tick-level-3\)/su);
  assert.match(stylesCss, /@media \(max-width:\s*860px\)\s*\{[\s\S]*\.review-page\s*\{[^}]*padding-right:\s*16px/su);
  assert.doesNotMatch(stylesCss, /\.review-scroll-ruler-tick\.is-active::before\s*\{[^}]*rgba\(37,\s*99,\s*235/su);
  assert.doesNotMatch(stylesCss, /\.review-scroll-ruler-tick:hover::before,[\s\S]*rgba\(30,\s*64,\s*175/su);
});

test('mac launcher starts TagVision from its own directory and opens review ui', () => {
  assert.match(launcherScript, /cd "\$SCRIPT_DIR"/u);
  assert.match(launcherScript, /\/opt\/homebrew\/bin/u);
  assert.match(launcherScript, /\/usr\/local\/bin/u);
  assert.match(launcherScript, /sync_dependencies\(\)/u);
  assert.match(launcherScript, /dependencies_ready\(\)/u);
  assert.match(launcherScript, /Using bundled TagVision dependencies/u);
  assert.match(launcherScript, /npm ci --omit=dev --no-audit --no-fund/u);
  assert.match(launcherScript, /npm install --omit=dev --no-audit --no-fund/u);
  assert.match(launcherScript, /TAGVISION_WEB_HOST:-127\.0\.0\.1/u);
  assert.match(launcherScript, /TAGVISION_WEB_PORT:-4312/u);
  assert.match(launcherScript, /curl -fsS "\$TAGVISION_URL"/u);
  assert.match(launcherScript, /TagVision V0\.5\.1 macOS is ready/u);
  assert.match(launcherScript, /open "\$TAGVISION_URL"/u);
  assert.match(launcherScript, /nohup npm run web/u);
  assert.match(launcherScript, /stop_existing_tagvision_servers\(\)/u);
  assert.match(launcherScript, /is_tagvision_server_process\(\)/u);
  assert.match(launcherScript, /node apps\/web\/server\.ts/u);
  assert.match(launcherScript, /tagvision-macos/u);
  assert.match(launcherScript, /Refusing to stop non-TagVision process/u);
  assert.doesNotMatch(launcherScript, /Opening existing TagVision URL/u);
  assert.doesNotMatch(launcherScript, /wait "\$SERVER_PID"/u);
});

test('mac distribution includes one-click and manual terminal startup assets', () => {
  const manualStartGuide = readFileSync(
    path.join(process.cwd(), 'TagVision macOS Manual Terminal Startup.txt'),
    'utf8'
  );

  assert.match(manualStartGuide, /Start TagVision macOS\.command/u);
  assert.match(manualStartGuide, /npm run web/u);
  assert.match(manualStartGuide, /http:\/\/127\.0\.0\.1:4312\/review\.html/u);
  assert.match(manualStartGuide, /TagVision-macOS-V0\.5\.1\.zip/u);
  assert.match(packMacosSh, /TagVision-macOS-V0\.5/u);
  assert.match(packMacosSh, /npm ci --omit=dev --no-audit --no-fund/u);
});

test('launcher runtime pid file is ignored and excluded from mac package', () => {
  assert.match(gitignore, /^tagvision-macos-server\.pid$/mu);
  assert.match(packMacosSh, /--exclude tagvision-macos-server\.pid/u);
});

test('server does not write json errors after response headers were sent', () => {
  assert.match(serverTs, /if \(response\.headersSent\)/u);
  assert.match(serverTs, /response\.destroy/u);
});

test('review runtime dependencies are present for module imports', () => {
  assert.match(reviewJs, /from '\.\/api-client\.js'/u);
  assert.match(reviewJs, /from '\.\/form-state\.js'/u);
  assert.match(apiClientJs, /export async function apiGet/u);
  assert.match(apiClientJs, /export async function apiPost/u);
  assert.match(apiClientJs, /export function buildDebugJson/u);
  assert.match(formStateJs, /export function escapeHtml/u);
});

test('review serves Plyr from an offline runtime dependency through exact routes', () => {
  assert.equal(packageJson.dependencies?.plyr, '3.8.4');
  assert.match(serverTs, /\/vendor\/plyr\.js/u);
  assert.match(serverTs, /\/vendor\/plyr\.css/u);
  assert.match(serverTs, /\/vendor\/plyr\.svg/u);
  assert.doesNotMatch(serverTs, /url\.pathname.*node_modules/u);
});

test('local folder chooser opens the system dialog without activating Finder windows', () => {
  assert.doesNotMatch(localDialogsTs, /tell application "Finder" to activate/u);
  assert.match(localDialogsTs, /choose folder/u);
});
