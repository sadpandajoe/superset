// QA capture for sc-107323 dashboard slug redirect bug.
// Usage: node capture.mjs <label>   (label = "before" or "after")
// Drives a real Chromium at 1280x800, records video, and saves stills that
// show the post-save address-bar URL via an injected location.href banner.
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require(
  '/var/lib/agor/home/agorpg/.agor/worktrees/apache/superset/fix-dashboard-slug-redirect-sanitized-redo/superset-frontend/node_modules/playwright',
);

const label = process.argv[2] || 'run';
const BASE = 'http://10.33.92.175:12892';
const OUT = '/var/tmp/sc107323-qa';
const DASH_ID = 6; // USA Births Names
const VIDEO_DIR = path.join(OUT, `video-${label}`);
fs.mkdirSync(VIDEO_DIR, { recursive: true });

const banner = (page) =>
  page.evaluate(() => {
    let b = document.getElementById('__qa_url_banner__');
    if (!b) {
      b = document.createElement('div');
      b.id = '__qa_url_banner__';
      b.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
        'background:#111;color:#0f0;font:16px/1.4 monospace;padding:8px 12px;' +
        'border-bottom:2px solid #0f0;white-space:pre-wrap;word-break:break-all;';
      document.body.appendChild(b);
    }
    b.textContent =
      'POST-SAVE location.href = ' + window.location.href;
  });

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } },
  });
  const page = await context.newPage();
  const log = (m) => console.log(`[${label}] ${m}`);

  try {
    // ---- login ----
    await page.goto(`${BASE}/login/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#username', { timeout: 30000 });
    await page.fill('#username', 'admin');
    await page.fill('#password', 'admin');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {}),
      page.getByRole('button', { name: 'Sign in' }).click(),
    ]);
    log('logged in, url=' + page.url());

    // ---- open dashboard by stable id ----
    await page.goto(`${BASE}/dashboard/${DASH_ID}/`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-test="edit-dashboard-button"]', { timeout: 60000 });
    await page.waitForTimeout(1500);
    log('dashboard loaded, url=' + page.url());

    // ---- enter edit mode ----
    await page.click('[data-test="edit-dashboard-button"]');
    await page.waitForTimeout(1500);

    // ---- open kebab actions menu -> Edit properties ----
    await page.click('[data-test="actions-trigger"]');
    await page.waitForTimeout(800);
    await page.getByRole('menuitem', { name: 'Edit properties' }).click();

    // ---- properties modal ----
    await page.waitForSelector('[data-test="properties-edit-modal"]', { timeout: 20000 });
    const slug = page.locator('[data-test="dashboard-slug-input"]');
    await slug.waitFor({ timeout: 10000 });
    await slug.click({ clickCount: 3 });
    await slug.fill('?test');
    log('slug set to ?test');
    await page.waitForTimeout(500);

    // ---- Apply (onlyApply mode) ----
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    // modal closes
    await page.waitForSelector('[data-test="properties-edit-modal"]', { state: 'detached', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);

    // ---- header Save -> triggers saveDashboardRequest + redirect ----
    const saveBtn = page.locator('[data-test="header-save-button"]');
    await saveBtn.waitFor({ timeout: 10000 });
    await saveBtn.click();

    // wait for the save to resolve (success toast) then let redirect pushState settle
    await page.waitForSelector('text=saved successfully', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2500);

    const postSaveUrl = page.url();
    log('POST-SAVE URL = ' + postSaveUrl);

    // banner + still showing the address-bar url after save (no manual reload)
    await banner(page);
    await page.waitForTimeout(400);
    const afterSavePng = path.join(OUT, `${label}-after-save.png`);
    await page.screenshot({ path: afterSavePng, fullPage: false });

    // ---- render the URL the app redirected us to (real user impact) ----
    await page.goto(postSaveUrl, { waitUntil: 'networkidle' }).catch((e) => log('goto redirected url err: ' + e.message));
    await page.waitForTimeout(3500);
    const renderUrl = page.url();
    log('RENDERED redirected URL = ' + renderUrl);
    await page.evaluate((u) => {
      const b = document.createElement('div');
      b.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#111;color:#0ff;' +
        'font:15px/1.4 monospace;padding:8px 12px;border-bottom:2px solid #0ff;white-space:pre-wrap;word-break:break-all;';
      b.textContent = 'RENDER of redirected URL = ' + u + '  (path=' + window.location.pathname + ' search=' + window.location.search + ')';
      document.body.appendChild(b);
    }, renderUrl);
    await page.waitForTimeout(500);
    const renderPng = path.join(OUT, `${label}-render-redirected.png`);
    await page.screenshot({ path: renderPng, fullPage: false });

    // machine-readable result line
    console.log(`RESULT ${label} POST_SAVE_URL=${postSaveUrl} RENDER_URL=${renderUrl} AFTER_SAVE_PNG=${afterSavePng} RENDER_PNG=${renderPng}`);
  } catch (err) {
    console.log(`[${label}] ERROR: ${err.message}`);
    try { await page.screenshot({ path: path.join(OUT, `${label}-ERROR.png`) }); } catch {}
    process.exitCode = 2;
  } finally {
    // close context to flush + finalize the webm
    await context.close();
    const vids = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'));
    if (vids.length) {
      const dest = path.join(OUT, `${label}-fix.webm`.replace('before-fix', 'before-master'));
      const finalName = label === 'before' ? 'before-master.webm' : 'after-fix.webm';
      fs.copyFileSync(path.join(VIDEO_DIR, vids[0]), path.join(OUT, finalName));
      console.log(`VIDEO ${label} -> ${path.join(OUT, finalName)}`);
    } else {
      console.log(`[${label}] NO VIDEO PRODUCED`);
    }
    await browser.close();
  }
})();
