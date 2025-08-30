/**
 * messenger.js
 *
 * Puppeteer automation script: logs in, persists cookies, navigates
 * to profile URLs, types messages with human-like behavior, and logs JSON output.
 *
 * WARNING: Do not use this to violate terms of service or laws. This script
 * provides a captcha-solver HOOK only; it does NOT bypass captchas automatically.
 *
 * Usage:
 *   node messenger.js --profiles profiles.json --message "Hello there!"
 *
 * Environment variables (in .env):
 *   LOGIN_EMAIL, LOGIN_PASSWORD, HEADLESS
 *
 * Dependencies:
 *   puppeteer-extra, puppeteer-extra-plugin-stealth, puppeteer, dotenv, minimist, fs-extra
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const minimist = require('minimist');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin()); // OPTIONAL - helps avoid simple automated-bot signatures.
// Use responsibly and only for legitimate automation. Remove if you don't want to use stealth.

const COOKIE_DIR = path.resolve(__dirname, 'cookies');
const OUTPUT_LOG = path.resolve(__dirname, 'results.jsonl'); // newline-delimited JSON
const DEFAULT_VIEWPORT = { width: 1200, height: 800 };

/* ---------------------------- Utility helpers ---------------------------- */

// Random number between min and max (ms)
function rand(min = 100, max = 1000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sleep helper
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Append JSON object as newline to results file
async function logResult(obj) {
  await fs.appendFile(OUTPUT_LOG, JSON.stringify(obj) + '\n');
}

/* --------------------------- Human-like actions -------------------------- */

// Simulate human typing into an elementHandle (with per-character random delays)
async function humanType(elementHandle, text, opts = {}) {
  const { min = 100, max = 200 } = opts; // ms between keystrokes
  for (const char of text) {
    await elementHandle.type(char);
    await delay(rand(min, max));
  }
}

// Move mouse in a somewhat-human path between two points
async function humanMove(page, from, to, steps = 20) {
  const dx = (to.x - from.x) / steps;
  const dy = (to.y - from.y) / steps;
  for (let i = 0; i <= steps; i += 1) {
    const x = Math.round(from.x + dx * i + (Math.random() * 4 - 2));
    const y = Math.round(from.y + dy * i + (Math.random() * 4 - 2));
    await page.mouse.move(x, y);
    await delay(rand(5, 30));
  }
}

// Scroll slowly like a human
async function humanScroll(page, distance = 300, steps = 10) {
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((amount) => { window.scrollBy(0, amount); }, Math.round(distance / steps));
    await delay(rand(100, 350));
  }
}

/* -------------------------- Cookie Persistence -------------------------- */

async function cookieFilePathFor(email) {
  await fs.ensureDir(COOKIE_DIR);
  // sanitize email for filename
  const safe = email.replace(/[^a-z0-9_\-\.@]/gi, '_');
  return path.join(COOKIE_DIR, `${safe}.json`);
}

async function saveCookies(page, email) {
  const cookies = await page.cookies();
  const pathToFile = await cookieFilePathFor(email);
  await fs.writeJson(pathToFile, cookies, { spaces: 2 });
}

async function loadCookies(page, email) {
  const pathToFile = await cookieFilePathFor(email);
  if (await fs.pathExists(pathToFile)) {
    const cookies = await fs.readJson(pathToFile);
    try {
      await page.setCookie(...cookies);
      return true;
    } catch (err) {
      console.warn('Failed to set cookies:', err.message);
      return false;
    }
  }
  return false;
}

/* --------------------------- CAPTCHA Hook --------------------------- */

/**
 * captchaSolverHook(page) -> boolean
 * - This is a stub. Integrate your third-party solver here, or prompt a human.
 * - Return true when captcha/problem is solved and script should continue.
 * - Throw or return false to abort processing current profile.
 *
 * IMPORTANT: This function should not attempt to circumvent protections.
 */
async function defaultCaptchaSolverHook(page) {
  // Example behavior: wait for human to solve in the opened browser window.
  // If HEADLESS=false, this will allow a human to manually solve the captcha.
  console.warn('CAPTCHA detected. Waiting up to 5 minutes for manual solve (open browser).');
  // Wait up to 5 minutes for captcha disappearance or manual signal:
  const maxWait = 5 * 60 * 1000;
  const pollInterval = 3000;
  let waited = 0;
  while (waited < maxWait) {
    // Adjust detection here to the site: look for recaptcha frames, site-specific selectors, etc.
    const captchaPresent = await page.evaluate(() => {
      // rough heuristic: presence of iframe with "recaptcha" or large overlay
      const frames = Array.from(document.querySelectorAll('iframe'));
      const hasRecaptchaFrame = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
      const overlay = !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
      return hasRecaptchaFrame || overlay;
    });
    if (!captchaPresent) return true;
    await delay(pollInterval);
    waited += pollInterval;
  }
  throw new Error('Captcha not solved within timeout. Aborting.');
}

/* ---------------------------- Login Function --------------------------- */

/**
 * loginIfNeeded(browser, page, email, password, options)
 *
 * - Attempts to restore cookies first.
 * - If not logged in, performs login using site-specific selectors.
 * - IMPORTANT: You will need to edit the site-specific selectors for the target website's login form.
 */
async function loginIfNeeded(page, email, password, options = {}) {
  const { loginUrl, checkLoggedInSelector, loginSelectors = {} } = options;
  // Attempt to load cookies and check if session is still valid
  const loaded = await loadCookies(page, email);
  if (loaded) {
    // reload page and check login state
    await page.goto(loginUrl, { waitUntil: 'networkidle2' });
    await delay(rand(500, 1500));
    if (await page.$(checkLoggedInSelector)) {
      console.log('Reused cookies: already logged in.');
      return { loggedIn: true, reusedCookies: true };
    }
    console.log('Cookies loaded but session invalid; will perform interactive login.');
  }

  // Perform login - --- SITE-SPECIFIC: Update selectors below to match target site ---
  await page.goto(loginUrl, { waitUntil: 'networkidle2' });
  await delay(rand(500, 1500));

  // Example selectors - **MUST** be adapted to the target website.
  const {
    emailSelector = 'input[type="email"], input[name="email"], #email',
    passwordSelector = 'input[type="password"], input[name="password"], #password',
    submitSelector = 'button[type="submit"], button.login, input[type="submit"]',
  } = loginSelectors;

  // Wait for the email field to appear
  await page.waitForSelector(emailSelector, { timeout: 15000 })
    .catch(() => { throw new Error('Login email field not found - update selectors'); });

  // Type email and password human-like
  const emailEl = await page.$(emailSelector);
  await humanType(emailEl, email, { min: 80, max: 200 });
  await delay(rand(200, 600));

  const passEl = await page.$(passwordSelector);
  if (!passEl) throw new Error('Password field not found - update selectors');
  await humanType(passEl, password, { min: 80, max: 200 });

  await delay(rand(400, 1000));

  // Click submit or press Enter
  const submit = await page.$(submitSelector);
  if (submit) {
    const box = await submit.boundingBox();
    if (box) {
      await humanMove(page, { x: 50, y: 50 }, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, 12);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await submit.click();
    }
  } else {
    // fallback: press Enter
    await page.keyboard.press('Enter');
  }

  // Wait for navigation or some indication of being logged in
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => { /* may remain single-page */ });
  await delay(rand(1000, 2000));

  // Check for captcha presence and call hook if found
  const captchaDetected = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe'));
    const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
    const overlay = !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
    return hasRecaptcha || overlay;
  });
  if (captchaDetected) {
    if (options.captchaSolverHook) {
      const ok = await options.captchaSolverHook(page);
      if (!ok) throw new Error('Captcha solver hook failed or returned false');
    } else {
      throw new Error('Captcha detected during login and no solver hook provided.');
    }
  }

  // Verify login success by checking for user-specific selector
  if (!(await page.$(checkLoggedInSelector))) {
    throw new Error('Login appears to have failed. Check credentials/selectors or captcha.');
  }

  // Save cookies for future runs
  await saveCookies(page, email);

  return { loggedIn: true, reusedCookies: false };
}

/* ------------------------- Send message to profile ------------------------ */

/**
 * sendMessageToProfile(page, profileUrl, message, options)
 *
 * - Navigate to profileUrl
 * - Wait for message box selector, type message using humanType, and send.
 *
 * NOTE: you must adapt selectors to the target website's DOM for locating message box and send button.
 */
async function sendMessageToProfile(page, profile, message, options = {}) {
  const {
    messageBoxSelector = 'textarea[name="message"], textarea#message, div[contenteditable="true"]',
    sendButtonSelector = 'button.send, button[type="submit"], button[aria-label*="Send"]',
    checkSentConfirmationSelector = null, // optional selector to confirm send
    captchaSolverHook = defaultCaptchaSolverHook,
    timeout = 20000
  } = options;

  const start = Date.now();
  try {
    // Navigate to profile URL
    await page.goto(profile.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(rand(800, 1600));

    // Some human behavior before interacting: scroll, move mouse
    await humanScroll(page, rand(200, 700), rand(3, 7));
    await delay(rand(300, 900));

    // Detect captcha on profile page
    const captchaPresent = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
      return hasRecaptcha || !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
    });
    if (captchaPresent) {
      await captchaSolverHook(page);
    }

    // Wait for message box
    await page.waitForSelector(messageBoxSelector, { timeout }).catch(() => {
      throw new Error('Message box not found - update messageBoxSelector');
    });

    // Focus & click into the message box
    const messageBox = await page.$(messageBoxSelector);
    const box = await messageBox.boundingBox();
    if (box) {
      // move mouse to the message box
      await humanMove(page, { x: 50, y: 50 }, { x: box.x + 8, y: box.y + 8 }, 18);
      await page.mouse.click(box.x + 8, box.y + 8, { delay: rand(50, 150) });
    } else {
      await messageBox.click({ delay: rand(40, 120) });
    }

    await delay(rand(200, 600));

    // Type the message human-like
    await humanType(messageBox, message, { min: 60, max: 200 });

    await delay(rand(300, 900));

    // Click the send button
    const sendBtn = await page.$(sendButtonSelector);
    if (sendBtn) {
      const sbox = await sendBtn.boundingBox();
      if (sbox) {
        await humanMove(page, { x: box ? box.x : 100, y: box ? box.y : 100 }, { x: sbox.x + sbox.width / 2, y: sbox.y + sbox.height / 2 }, 12);
        await page.mouse.click(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2);
      } else {
        await sendBtn.click({ delay: rand(40, 150) });
      }
    } else {
      // fallback: press Enter
      await page.keyboard.press('Enter');
    }

    // Wait a short time for send to process
    await delay(rand(900, 1800));

    // Optionally check for a "sent" confirmation selector
    if (checkSentConfirmationSelector) {
      const ok = await page.$(checkSentConfirmationSelector);
      if (!ok) {
        throw new Error('No confirmation that message was sent (selector not found).');
      }
    }

    const duration = Date.now() - start;
    return { success: true, profileId: profile.id, url: profile.url, durationMs: duration };
  } catch (err) {
    const duration = Date.now() - start;
    return { success: false, profileId: profile.id, url: profile.url, error: err.message, durationMs: duration };
  }
}

/* ------------------------------- Main flow -------------------------------- */

async function launchBrowser(opts = {}) {
  const headless = (process.env.HEADLESS === 'true') || !!opts.headless;
  const browser = await puppeteer.launch({
    headless,
    defaultViewport: DEFAULT_VIEWPORT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ].concat(opts.args || []),
  });
  return browser;
}

async function processAll(profiles, message, options = {}) {
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  if (!email || !password) throw new Error('LOGIN_EMAIL and LOGIN_PASSWORD must be set in environment.');

  const browser = await launchBrowser(options.launchOptions || {});
  const page = await browser.newPage();

  // Optional: set a realistic user agent
  await page.setUserAgent(options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

  const results = [];
  try {
    // Perform login if needed
    const loginResult = await loginIfNeeded(page, email, password, {
      loginUrl: options.loginUrl,
      checkLoggedInSelector: options.checkLoggedInSelector,
      loginSelectors: options.loginSelectors,
      captchaSolverHook: options.captchaSolverHook || defaultCaptchaSolverHook,
    });
    console.log('Login ok:', loginResult);

    // Process profiles one by one
    for (const profile of profiles) {
      // create a new page per profile if you prefer; reuse page to preserve session and be lighter
      try {
        // small random pause between profiles
        await delay(rand(1000, 4000));
        const res = await sendMessageToProfile(page, profile, message, {
          messageBoxSelector: options.messageBoxSelector,
          sendButtonSelector: options.sendButtonSelector,
          checkSentConfirmationSelector: options.checkSentConfirmationSelector,
          captchaSolverHook: options.captchaSolverHook || defaultCaptchaSolverHook,
        });
        await logResult({ timestamp: new Date().toISOString(), ...res });
        console.log('Profile result:', res);
        results.push(res);
      } catch (err) {
        const fail = { success: false, profileId: profile.id, url: profile.url, error: err.message };
        await logResult({ timestamp: new Date().toISOString(), ...fail });
        results.push(fail);
      }
    }
  } catch (err) {
    console.error('Fatal error during processing:', err);
    throw err;
  } finally {
    await browser.close();
  }
  return results;
}

/* ------------------------------- CLI / Run -------------------------------- */

async function main() {
  const argv = minimist(process.argv.slice(2));
  const profilesPath = argv.profiles || argv.p;
  const message = argv.message || argv.m;
  if (!profilesPath || !message) {
    console.error('Usage: node messenger.js --profiles profiles.json --message "Hello there!"');
    process.exit(2);
  }

  const profiles = await fs.readJson(profilesPath);
  // Example site-specific options - MUST be adapted for your target site:
  const siteOptions = {
    launchOptions: { headless: process.env.HEADLESS === 'true' },
    loginUrl: 'https://example.com/login', // <- CHANGE to site login page
    checkLoggedInSelector: '.user-menu, nav .profile, [data-user-id]', // <- CHANGE to a selector visible only when logged-in
    loginSelectors: {
      emailSelector: 'input[type="email"]',
      passwordSelector: 'input[type="password"]',
      submitSelector: 'button[type="submit"]'
    },
    messageBoxSelector: 'textarea#message, div[contenteditable="true"]', // <- CHANGE to site's message box
    sendButtonSelector: 'button.send, button[aria-label="Send"]', // <- CHANGE to site's send button
    checkSentConfirmationSelector: null,
    captchaSolverHook: defaultCaptchaSolverHook,
  };

  try {
    const results = await processAll(profiles, message, siteOptions);
    console.log('All done. Results saved to', OUTPUT_LOG);
  } catch (err) {
    console.error('Script failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
