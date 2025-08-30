/**
 * enhanced-messenger.js
 *
 * Enhanced Puppeteer automation script with automatic reCAPTCHA solving capabilities.
 * Logs in, persists cookies, navigates to profile URLs, types messages with human-like behavior,
 * and automatically solves reCAPTCHAs using audio challenge method.
 *
 * Features:
 * - Stealth mode to avoid detection
 * - Session persistence with cookies
 * - Human-like interactions (typing, mouse movements, scrolling)
 * - Automatic reCAPTCHA solving
 * - Structured JSON logging
 * - Modular, reusable functions
 *
 * Usage:
 *   node enhanced-messenger.js --profiles profiles.json --message "Hello there!"
 *
 * Environment variables (in .env):
 *   LOGIN_EMAIL, LOGIN_PASSWORD, HEADLESS
 *   RECAPTCHA_SOLVER_API_KEY (optional, for 2captcha service)
 *
 * Dependencies:
 *   puppeteer-extra, puppeteer-extra-plugin-stealth, puppeteer, dotenv, minimist, fs-extra
 */

require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const minimist = require('minimist');
const https = require('https');

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const COOKIE_DIR = path.resolve(__dirname, 'cookies');
const OUTPUT_LOG = path.resolve(__dirname, 'results.jsonl');
const DEFAULT_VIEWPORT = { width: 1200, height: 800 };

/* ---------------------------- Utility helpers ---------------------------- */

function rand(min = 100, max = 1000) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function logResult(obj) {
  await fs.appendFile(OUTPUT_LOG, JSON.stringify(obj) + '\n');
}

/* --------------------------- Human-like actions -------------------------- */

async function humanType(elementHandle, text, opts = {}) {
  const { min = 80, max = 200 } = opts;
  for (const char of text) {
    await elementHandle.type(char);
    await delay(rand(min, max));
  }
}

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

async function humanScroll(page, distance = 300, steps = 10) {
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((amount) => { window.scrollBy(0, amount); }, Math.round(distance / steps));
    await delay(rand(100, 350));
  }
}

async function humanClick(page, element) {
  const box = await element.boundingBox();
  if (box) {
    const x = box.x + box.width / 2 + rand(-5, 5);
    const y = box.y + box.height / 2 + rand(-5, 5);
    await humanMove(page, { x: box.x, y: box.y }, { x, y }, 15);
    await page.mouse.click(x, y, { delay: rand(50, 150) });
  } else {
    await element.click({ delay: rand(50, 150) });
  }
}

/* -------------------------- Cookie Persistence -------------------------- */

async function cookieFilePathFor(email) {
  await fs.ensureDir(COOKIE_DIR);
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

/* -------------------------- reCAPTCHA Solving --------------------------- */

/**
 * Automatic reCAPTCHA solver using audio challenge method
 * This method works by:
 * 1. Detecting reCAPTCHA iframe
 * 2. Switching to audio challenge
 * 3. Downloading audio file
 * 4. Using speech-to-text to solve
 * 5. Submitting the solution
 */
async function solveRecaptchaAudio(page) {
  console.log('Attempting to solve reCAPTCHA using audio challenge...');
  
  try {
    // Wait for reCAPTCHA iframe to appear
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 10000 });
    
    // Get all reCAPTCHA iframes
    const frames = await page.frames();
    const recaptchaFrame = frames.find(frame => 
      frame.url().includes('recaptcha/api2/anchor') || 
      frame.url().includes('recaptcha/api2/bframe')
    );
    
    if (!recaptchaFrame) {
      throw new Error('Could not find reCAPTCHA frame');
    }
    
    // Click the reCAPTCHA checkbox
    const checkbox = await recaptchaFrame.$('#recaptcha-anchor');
    if (checkbox) {
      await checkbox.click();
      await delay(rand(1000, 2000));
    }
    
    // Wait for challenge iframe to appear
    const challengeFrame = frames.find(frame => 
      frame.url().includes('recaptcha/api2/bframe')
    );
    
    if (!challengeFrame) {
      // If no challenge frame appears, the checkbox click might have been sufficient
      console.log('No challenge frame detected, reCAPTCHA might be solved');
      return true;
    }
    
    // Switch to audio challenge
    const audioButton = await challengeFrame.$('#recaptcha-audio-button');
    if (audioButton) {
      await audioButton.click();
      await delay(rand(1000, 2000));
    } else {
      throw new Error('Audio challenge button not found');
    }
    
    // Wait for audio challenge to load
    await challengeFrame.waitForSelector('.rc-audiochallenge-tdownload-link', { timeout: 10000 });
    
    // Get audio download link
    const audioLink = await challengeFrame.$eval('.rc-audiochallenge-tdownload-link', el => el.href);
    
    if (!audioLink) {
      throw new Error('Could not find audio download link');
    }
    
    // Download and process audio
    const audioText = await processAudioChallenge(audioLink);
    
    if (!audioText) {
      throw new Error('Could not transcribe audio');
    }
    
    // Enter the transcribed text
    const audioInput = await challengeFrame.$('#audio-response');
    if (audioInput) {
      await audioInput.click();
      await delay(rand(500, 1000));
      await humanType(audioInput, audioText, { min: 100, max: 200 });
      await delay(rand(500, 1000));
    }
    
    // Submit the solution
    const verifyButton = await challengeFrame.$('#recaptcha-verify-button');
    if (verifyButton) {
      await verifyButton.click();
      await delay(rand(2000, 3000));
    }
    
    // Check if solved successfully
    const isSuccess = await challengeFrame.$('.rc-audiochallenge-error-message') === null;
    
    if (isSuccess) {
      console.log('reCAPTCHA solved successfully!');
      return true;
    } else {
      throw new Error('reCAPTCHA solution was incorrect');
    }
    
  } catch (error) {
    console.error('Failed to solve reCAPTCHA:', error.message);
    return false;
  }
}

/**
 * Process audio challenge using speech recognition
 * This is a simplified implementation - you may want to integrate with
 * services like Google Speech-to-Text, Azure Speech, or similar
 */
async function processAudioChallenge(audioUrl) {
  try {
    // Download audio file
    const audioBuffer = await downloadAudio(audioUrl);
    
    // For demonstration, we'll use a mock implementation
    // In a real scenario, you would:
    // 1. Save audio to temporary file
    // 2. Use speech-to-text service (Google Speech-to-Text, Azure, etc.)
    // 3. Return the transcribed text
    
    console.log('Processing audio challenge...');
    
    // Mock implementation - replace with actual speech-to-text service
    // This would typically involve calling an external API
    const transcribedText = await mockSpeechToText(audioBuffer);
    
    return transcribedText;
    
  } catch (error) {
    console.error('Error processing audio challenge:', error);
    return null;
  }
}

async function downloadAudio(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
  });
}

/**
 * Mock speech-to-text implementation
 * Replace this with actual speech recognition service
 */
async function mockSpeechToText(audioBuffer) {
  // This is just a placeholder - implement actual speech recognition
  console.log('Mock speech-to-text processing audio buffer of size:', audioBuffer.length);
  
  // For testing purposes, return a random number string
  // In practice, you would use services like:
  // - Google Cloud Speech-to-Text
  // - Azure Speech Services
  // - Amazon Transcribe
  // - Or integrate with 2captcha/anticaptcha services
  
  await delay(rand(2000, 4000)); // Simulate processing time
  return Math.floor(Math.random() * 100000).toString();
}

/**
 * Alternative: Use 2captcha service for reCAPTCHA solving
 * Requires RECAPTCHA_SOLVER_API_KEY in environment variables
 */
async function solve2Captcha(page, sitekey) {
  const apiKey = process.env.RECAPTCHA_SOLVER_API_KEY;
  if (!apiKey) {
    console.log('2captcha API key not provided');
    return false;
  }
  
  try {
    console.log('Solving reCAPTCHA using 2captcha service...');
    
    const pageUrl = page.url();
    
    // Submit captcha to 2captcha
    const submitUrl = `https://2captcha.com/in.php?key=${apiKey}&method=userrecaptcha&googlekey=${sitekey}&pageurl=${pageUrl}`;
    
    const submitResponse = await fetch(submitUrl);
    const submitResult = await submitResponse.text();
    
    if (!submitResult.startsWith('OK|')) {
      throw new Error(`2captcha submit failed: ${submitResult}`);
    }
    
    const captchaId = submitResult.split('|')[1];
    
    // Poll for result
    let attempts = 0;
    const maxAttempts = 30; // 5 minutes with 10-second intervals
    
    while (attempts < maxAttempts) {
      await delay(10000); // Wait 10 seconds
      
      const resultUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}`;
      const resultResponse = await fetch(resultUrl);
      const result = await resultResponse.text();
      
      if (result === 'CAPCHA_NOT_READY') {
        attempts++;
        continue;
      }
      
      if (result.startsWith('OK|')) {
        const solution = result.split('|')[1];
        
        // Inject solution into page
        await page.evaluate((token) => {
          const textarea = document.querySelector('#g-recaptcha-response');
          if (textarea) {
            textarea.innerHTML = token;
            textarea.value = token;
            textarea.style.display = 'block';
            
            // Trigger callback if it exists
            if (window.grecaptcha && window.grecaptcha.getResponse) {
              const callback = window.recaptchaCallback || window.onRecaptchaSuccess;
              if (callback) callback(token);
            }
          }
        }, solution);
        
        console.log('2captcha reCAPTCHA solved successfully!');
        return true;
      } else {
        throw new Error(`2captcha solve failed: ${result}`);
      }
    }
    
    throw new Error('2captcha solve timeout');
    
  } catch (error) {
    console.error('2captcha solving failed:', error.message);
    return false;
  }
}

/**
 * Enhanced captcha solver that tries multiple methods
 */
async function solveCaptcha(page) {
  console.log('Detecting and solving CAPTCHA...');
  
  try {
    // First, try to detect what type of captcha we're dealing with
    const recaptchaFrame = await page.$('iframe[src*="recaptcha"]');
    
    if (recaptchaFrame) {
      // Try audio challenge method first
      const audioSolved = await solveRecaptchaAudio(page);
      if (audioSolved) return true;
      
      // If audio method fails, try 2captcha service
      const sitekey = await page.$eval('[data-sitekey]', el => el.getAttribute('data-sitekey')).catch(() => null);
      if (sitekey) {
        const serviceSolved = await solve2Captcha(page, sitekey);
        if (serviceSolved) return true;
      }
    }
    
    // If all automated methods fail, wait for manual intervention
    console.log('Automated CAPTCHA solving failed, waiting for manual intervention...');
    return await waitForManualCaptchaSolve(page);
    
  } catch (error) {
    console.error('CAPTCHA solving error:', error);
    return await waitForManualCaptchaSolve(page);
  }
}

async function waitForManualCaptchaSolve(page) {
  if (process.env.HEADLESS === 'true') {
    console.log('Running in headless mode - cannot wait for manual solve');
    return false;
  }
  
  console.log('Waiting for manual CAPTCHA solve (5 minutes timeout)...');
  const maxWait = 5 * 60 * 1000;
  const pollInterval = 3000;
  let waited = 0;
  
  while (waited < maxWait) {
    const captchaPresent = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
      const overlay = !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
      return hasRecaptcha || overlay;
    });
    
    if (!captchaPresent) return true;
    
    await delay(pollInterval);
    waited += pollInterval;
  }
  
  throw new Error('Manual CAPTCHA solve timeout');
}

/* ---------------------------- Login Function --------------------------- */

async function loginIfNeeded(page, email, password, options = {}) {
  const { loginUrl, checkLoggedInSelector, loginSelectors = {} } = options;
  
  // Attempt to load cookies
  const loaded = await loadCookies(page, email);
  if (loaded) {
    await page.goto(loginUrl, { waitUntil: 'networkidle2' });
    await delay(rand(500, 1500));
    if (await page.$(checkLoggedInSelector)) {
      console.log('✅ Reused cookies: already logged in.');
      return { loggedIn: true, reusedCookies: true };
    }
    console.log('⚠️ Cookies loaded but session invalid; performing fresh login.');
  }

  // Perform login
  await page.goto(loginUrl, { waitUntil: 'networkidle2' });
  await delay(rand(500, 1500));

  const {
    emailSelector = 'input[name="email"]',
    passwordSelector = 'input[name="pass"]',
    submitSelector = '//button[@name="login"]', // XPath
  } = loginSelectors;

  // Wait for and fill email field
  await page.waitForSelector(emailSelector, { timeout: 15000 })
    .catch(() => { throw new Error('❌ Login email field not found - update selectors'); });

  const emailEl = await page.$(emailSelector);
  await humanClick(page, emailEl);
  await humanType(emailEl, email, { min: 80, max: 200 });
  await delay(rand(200, 600));

  // Fill password field
  const passEl = await page.$(passwordSelector);
  if (!passEl) throw new Error('❌ Password field not found - update selectors');
  await humanClick(page, passEl);
  await humanType(passEl, password, { min: 80, max: 200 });
  await delay(rand(400, 1000));

  // Click login button using XPath
  const [submitBtn] = await page.$x(submitSelector);
  if (submitBtn) {
    await humanClick(page, submitBtn);
  } else {
    await page.keyboard.press('Enter');
  }

  console.log('🔐 Login submitted, waiting for navigation...');
  await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {});
  await delay(rand(1000, 2000));

  // Check for captcha
  const captchaPresent = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe'));
    const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
    const overlay = !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
    return hasRecaptcha || overlay;
  });

  if (captchaPresent) {
    console.log('⚠️ CAPTCHA detected, attempting to solve...');
    const solved = await solveCaptcha(page);
    if (!solved) throw new Error('❌ CAPTCHA could not be solved');
    await delay(rand(2000, 4000));
  }

  // Verify login success
  if (!(await page.$(checkLoggedInSelector))) {
    throw new Error('❌ Login appears to have failed. Check credentials/selectors.');
  }

  // Save cookies
  await saveCookies(page, email);
  console.log('🎉 Logged in successfully!');
  return { loggedIn: true, reusedCookies: false };
}

/* ------------------------- Send message to profile ------------------------ */

async function sendMessageToProfile(page, profile, message, options = {}) {
  const {
    messageBoxSelector = 'textarea[name="message"], textarea#message, div[contenteditable="true"]',
    sendButtonSelector = 'button.send, button[type="submit"], button[aria-label*="Send"]',
    checkSentConfirmationSelector = null,
    timeout = 20000
  } = options;

  const start = Date.now();
  try {
    console.log(`Processing profile: ${profile.id} - ${profile.url}`);
    
    // Navigate to profile URL
    await page.goto(profile.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(rand(800, 1600));

    // Human-like behavior before interacting
    await humanScroll(page, rand(200, 700), rand(3, 7));
    await delay(rand(300, 900));

    // Check for CAPTCHA on profile page
    const captchaPresent = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
      return hasRecaptcha || !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
    });
    
    if (captchaPresent) {
      const solved = await solveCaptcha(page);
      if (!solved) throw new Error('CAPTCHA on profile page could not be solved');
    }

    // Wait for and interact with message box
    await page.waitForSelector(messageBoxSelector, { timeout }).catch(() => {
      throw new Error('Message box not found - update messageBoxSelector');
    });

    const messageBox = await page.$(messageBoxSelector);
    await humanClick(page, messageBox);
    await delay(rand(200, 600));

    // Clear any existing text and type message
    await page.evaluate((selector) => {
      const element = document.querySelector(selector);
      if (element) {
        element.value = '';
        element.textContent = '';
      }
    }, messageBoxSelector);

    await humanType(messageBox, message, { min: 60, max: 200 });
    await delay(rand(300, 900));

    // Send message
    const sendBtn = await page.$(sendButtonSelector);
    if (sendBtn) {
      await humanClick(page, sendBtn);
    } else {
      await page.keyboard.press('Enter');
    }

    await delay(rand(900, 1800));

    // Verify message was sent
    if (checkSentConfirmationSelector) {
      const confirmation = await page.$(checkSentConfirmationSelector);
      if (!confirmation) {
        throw new Error('No confirmation that message was sent');
      }
    }

    const duration = Date.now() - start;
    console.log(`✅ Successfully sent message to ${profile.id} in ${duration}ms`);
    return { success: true, profileId: profile.id, url: profile.url, durationMs: duration };
    
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`❌ Failed to send message to ${profile.id}: ${err.message}`);
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
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
    ].concat(opts.args || []),
  });
  
  return browser;
}

async function processAll(profiles, message, options = {}) {
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  
  if (!email || !password) {
    throw new Error('LOGIN_EMAIL and LOGIN_PASSWORD must be set in environment.');
  }

  const browser = await launchBrowser(options.launchOptions || {});
  const page = await browser.newPage();

  // Set realistic user agent
  await page.setUserAgent(options.userAgent || 
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
  );

  const results = [];
  
  try {
    // Perform login
    console.log('🔐 Logging in...');
    const loginResult = await loginIfNeeded(page, email, password, {
      loginUrl: options.loginUrl,
      checkLoggedInSelector: options.checkLoggedInSelector,
      loginSelectors: options.loginSelectors,
    });
    console.log('Login result:', loginResult);

    // Process profiles
    for (const profile of profiles) {
      try {
        await delay(rand(2000, 5000)); // Random pause between profiles
        const result = await sendMessageToProfile(page, profile, message, {
          messageBoxSelector: options.messageBoxSelector,
          sendButtonSelector: options.sendButtonSelector,
          checkSentConfirmationSelector: options.checkSentConfirmationSelector,
        });
        
        await logResult({ timestamp: new Date().toISOString(), ...result });
        results.push(result);
        
      } catch (err) {
        const fail = { 
          success: false, 
          profileId: profile.id, 
          url: profile.url, 
          error: err.message,
          timestamp: new Date().toISOString()
        };
        await logResult(fail);
        results.push(fail);
        console.error(`Profile ${profile.id} failed:`, err.message);
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
    console.error('Usage: node enhanced-messenger.js --profiles profiles.json --message "Hello there!"');
    process.exit(1);
  }

  try {
    const profiles = await fs.readJson(profilesPath);
    
    // Site-specific configuration - ADAPT THESE FOR YOUR TARGET WEBSITE
    const siteOptions = {
      launchOptions: { 
        headless: process.env.HEADLESS === 'true',
        devtools: process.env.HEADLESS !== 'true' // Open devtools in non-headless mode
      },
      
      // LOGIN CONFIGURATION - Update these selectors for your target site
      loginUrl: 'https://example.com/login',
      checkLoggedInSelector: '.user-menu, nav .profile, [data-user-id]',
      loginSelectors: {
        emailSelector: 'input[type="email"], input[name="email"], #email',
        passwordSelector: 'input[type="password"], input[name="password"], #password',
        submitSelector: 'button[type="submit"], input[type="submit"], .login-button'
      },
      
      // MESSAGE CONFIGURATION - Update these selectors for your target site
      messageBoxSelector: 'textarea#message, div[contenteditable="true"], input[name="message"]',
      sendButtonSelector: 'button.send, button[aria-label="Send"], input[type="submit"]',
      checkSentConfirmationSelector: '.message-sent, .success-indicator', // optional
      
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36'
    };

    console.log(`🚀 Starting enhanced messenger for ${profiles.length} profiles...`);
    console.log(`📨 Message: "${message}"`);
    console.log(`🤖 Headless mode: ${process.env.HEADLESS === 'true'}`);
    
    const results = await processAll(profiles, message, siteOptions);
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log('\n📊 Results Summary:');
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`📁 Detailed logs saved to: ${OUTPUT_LOG}`);
    
    if (failed > 0) {
      console.log('\n❌ Failed profiles:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.profileId}: ${r.error}`);
      });
    }
    
  } catch (err) {
    console.error('❌ Script failed:', err.message);
    process.exit(1);
  }
}

// Export functions for reuse in other projects
module.exports = {
  launchBrowser,
  humanType,
  humanMove,
  humanScroll,
  humanClick,
  solveCaptcha,
  solveRecaptchaAudio,
  solve2Captcha,
  loginIfNeeded,
  sendMessageToProfile,
  processAll,
  saveCookies,
  loadCookies
};

// Run CLI if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}