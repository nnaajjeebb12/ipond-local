// scripts/screenshot-owner-manual.js
// Capture screenshots of every owner-facing page using Playwright.
// Run AFTER `npm run dev` is up: node scripts/screenshot-owner-manual.js
// Login as owner1@ipond.com / Owner123! (set via SQL for screenshot capture).

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const EMAIL = process.env.SCREENSHOT_EMAIL || "owner1@ipond.com";
const PASSWORD = process.env.SCREENSHOT_PASSWORD || "Owner123!";
const OUT_DIR = path.join(__dirname, "..", "docs", "images", "owner-manual");

fs.mkdirSync(OUT_DIR, { recursive: true });

const SHOTS = [
  { name: "01-login", url: "/login", needsAuth: false, settle: 1200 },
  { name: "02-dashboard-light", url: "/dashboard", settle: 5000, theme: "light", scroll: true },
  { name: "03-dashboard-dark", url: "/dashboard", settle: 5000, theme: "dark", scroll: true },
  { name: "04-pond-detail", url: "/dashboard/1", settle: 4500 },
  { name: "05-sensor-deep-dive", url: "/dashboard/1/temperature", settle: 4500 },
  { name: "06-reports", url: "/reports", settle: 2500 },
  { name: "07-thresholds", url: "/settings/thresholds", settle: 2500 },
  { name: "08-notifications", url: "/notifications", settle: 2500 },
];

// The MainLayout wraps content in `<main overflow-auto>`, so the page
// scrolls inside that container — not the document. Playwright's fullPage
// only captures document-scroll height, so we (a) unlock the inner scroll
// container's overflow, (b) slow-scroll to trigger lazy chart renders,
// (c) snap document.body to the resulting full height before capture.
async function unlockInnerScrollAndExpand(page) {
  await page.addStyleTag({
    content: `
      html, body { height: auto !important; min-height: 100% !important; overflow: visible !important; }
      main { overflow: visible !important; height: auto !important; max-height: none !important; }
      [class*="md:h-screen"], .md\\:h-screen { height: auto !important; min-height: 100vh !important; }
    `,
  });
  await page.waitForTimeout(500);

  // Slow scroll to trigger uPlot/IntersectionObserver
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const step = 400;
      let y = 0;
      const tick = () => {
        window.scrollTo(0, y);
        y += step;
        if (y >= document.documentElement.scrollHeight) {
          window.scrollTo(0, document.documentElement.scrollHeight);
          setTimeout(resolve, 800);
        } else {
          setTimeout(tick, 250);
        }
      };
      tick();
    });
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
}

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    try {
      localStorage.setItem("theme", t);
      document.documentElement.classList.toggle("dark", t === "dark");
      document.documentElement.style.colorScheme = t;
    } catch {}
  }, theme);
}

async function login(page) {
  // Warm-up: visit /login so Next.js compiles auth routes.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});

  // Authenticate from inside the page so the session cookie lands on the
  // browser context. Avoids React-hydration races on the login form.
  const result = await page.evaluate(async ({ email, password, base }) => {
    const csrfRes = await fetch(`${base}/api/auth/csrf`, { credentials: "include" });
    const { csrfToken } = await csrfRes.json();
    const body = new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: `${base}/dashboard`,
      redirect: "false",
      json: "true",
    });
    const r = await fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
    });
    let json = null;
    try { json = await r.clone().json(); } catch {}
    return { status: r.status, finalUrl: r.url, body: json };
  }, { email: EMAIL, password: PASSWORD, base: BASE });
  console.log("  · auth result:", JSON.stringify(result).slice(0, 300));

  // Navigate to dashboard.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log("  · now at", page.url());
  if (!page.url().includes("/dashboard")) {
    throw new Error("Login failed: not at /dashboard after auth");
  }
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1.5,
  });
  const page = await ctx.newPage();

  // 1) Login screen (unauthenticated). Visit twice so Tailwind/CSS is compiled.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector("#email");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT_DIR, "01-login.png"), fullPage: false });
  console.log("✓ 01-login");

  // 2) Authenticate via next-auth API (bypasses React hydration race)
  await login(page);

  // 3) Loop the rest. Visit each URL twice: first to compile, second to capture cleanly.
  for (const shot of SHOTS.slice(1)) {
    try {
      // Warm-up compile
      await page.goto(`${BASE}${shot.url}`, { waitUntil: "domcontentloaded", timeout: 90000 });
      await page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(1500);
      // Real visit
      await page.goto(`${BASE}${shot.url}`, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
      if (shot.theme) {
        await setTheme(page, shot.theme);
        await page.waitForTimeout(600);
      }
      await page.waitForTimeout(shot.settle || 1500);
      if (shot.scroll) {
        await unlockInnerScrollAndExpand(page);
      }
      await page.screenshot({
        path: path.join(OUT_DIR, `${shot.name}.png`),
        fullPage: true,
      });
      console.log(`✓ ${shot.name} (${page.url()})`);
    } catch (e) {
      console.error(`✗ ${shot.name}: ${e.message}`);
    }
  }

  await browser.close();
  console.log("DONE →", OUT_DIR);
})();
