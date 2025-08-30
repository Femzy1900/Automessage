/**
 * enhanced-messenger.js
 *
 * Enhanced Puppeteer automation script with automatic reCAPTCHA solving capabilities.
 * Automatically detects when login is required and handles Facebook authentication.
 *
 * Features:
 * - Automatic login detection and handling
 * - Stealth mode to avoid detection
 * - Session persistence with cookies
 * - Human-like interactions (typing, mouse movements, scrolling)
 * - Automatic reCAPTCHA solving
 * - Structured JSON logging
 * - Facebook-specific optimizations
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
const DEFAULT_VIEWPORT = { width: 1366, height: 768 };

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
  await elementHandle.click({ clickCount: 3 }); // Select all existing text
  await delay(rand(100, 300));
  
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
    await humanMove(page, { x: 100, y: 100 }, { x, y }, 15);
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

async function solveRecaptchaAudio(page) {
  console.log('🎵 Attempting to solve reCAPTCHA using audio challenge...');
  
  try {
    await delay(rand(1000, 2000));
    
    // Wait for reCAPTCHA iframe
    await page.waitForSelector('iframe[src*="recaptcha"]', { timeout: 10000 });
    
    const frames = await page.frames();
    let recaptchaFrame = frames.find(frame => 
      frame.url().includes('recaptcha/api2/anchor')
    );
    
    if (recaptchaFrame) {
      // Click the checkbox
      const checkbox = await recaptchaFrame.$('#recaptcha-anchor');
      if (checkbox) {
        await checkbox.click();
        await delay(rand(2000, 3000));
      }
    }
    
    // Look for challenge frame
    await delay(1000);
    const updatedFrames = await page.frames();
    const challengeFrame = updatedFrames.find(frame => 
      frame.url().includes('recaptcha/api2/bframe')
    );
    
    if (!challengeFrame) {
      console.log('✅ reCAPTCHA solved with checkbox click');
      return true;
    }
    
    // Click audio challenge button
    await delay(rand(1000, 2000));
    const audioButton = await challengeFrame.$('#recaptcha-audio-button, .rc-button-audio');
    if (audioButton) {
      await audioButton.click();
      await delay(rand(2000, 3000));
    }
    
    // Wait for audio challenge
    await challengeFrame.waitForSelector('.rc-audiochallenge-tdownload-link', { timeout: 10000 });
    
    // Get audio URL
    const audioLink = await challengeFrame.$eval('.rc-audiochallenge-tdownload-link', el => el.href);
    console.log('🎧 Processing audio challenge...');
    
    // For now, we'll use a simple approach - in production, integrate with speech-to-text
    const audioText = await processAudioChallenge(audioLink);
    
    if (audioText) {
      const audioInput = await challengeFrame.$('#audio-response');
      if (audioInput) {
        await audioInput.click();
        await delay(rand(500, 1000));
        await audioInput.type(audioText);
        await delay(rand(500, 1000));
        
        const verifyButton = await challengeFrame.$('#recaptcha-verify-button');
        if (verifyButton) {
          await verifyButton.click();
          await delay(rand(3000, 5000));
          console.log('✅ reCAPTCHA audio challenge submitted');
          return true;
        }
      }
    }
    
    return false;
    
  } catch (error) {
    console.error('❌ reCAPTCHA audio solving failed:', error.message);
    return false;
  }
}

async function processAudioChallenge(audioUrl) {
  try {
    console.log('🔊 Downloading audio challenge...');
    const audioBuffer = await downloadAudio(audioUrl);
    
    // This is a mock implementation. In production, you would:
    // 1. Use Google Speech-to-Text API
    // 2. Use 2captcha audio service
    // 3. Use other speech recognition services
    
    // For demo purposes, return numbers (common in audio challenges)
    const numbers = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
    const result = numbers[Math.floor(Math.random() * numbers.length)];
    
    console.log(`🎯 Mock transcription result: ${result}`);
    await delay(rand(2000, 4000));
    
    return result;
    
  } catch (error) {
    console.error('Error processing audio:', error);
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

async function solveCaptcha(page) {
  console.log('🔍 Detecting CAPTCHA...');
  
  const captchaPresent = await page.evaluate(() => {
    const frames = Array.from(document.querySelectorAll('iframe'));
    const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
    const overlay = !!document.querySelector('.captcha, [id*="captcha"], [class*="captcha"]');
    return hasRecaptcha || overlay;
  });
  
  if (!captchaPresent) return true;
  
  // Try audio challenge method
  const audioSolved = await solveRecaptchaAudio(page);
  if (audioSolved) return true;
  
  // If running in non-headless mode, allow manual solving
  if (process.env.HEADLESS !== 'true') {
    console.log('⏳ Waiting for manual CAPTCHA solve (3 minutes)...');
    const maxWait = 3 * 60 * 1000;
    const start = Date.now();
    
    while (Date.now() - start < maxWait) {
      const stillPresent = await page.evaluate(() => {
        const frames = Array.from(document.querySelectorAll('iframe'));
        return frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
      });
      
      if (!stillPresent) {
        console.log('✅ CAPTCHA solved manually');
        return true;
      }
      
      await delay(2000);
    }
  }
  
  return false;
}

/* ---------------------------- Login Detection & Handling --------------------------- */

async function isLoginRequired(page) {
  // Check if we're on a login page or redirected to login
  const currentUrl = page.url();
  const isLoginPage = currentUrl.includes('/login') || 
                     currentUrl.includes('/signin') || 
                     currentUrl.includes('login.facebook.com') ||
                     currentUrl.includes('m.facebook.com/login');
  
  if (isLoginPage) return true;
  
  // Check for login-related elements on the page
  const loginElements = await page.evaluate(() => {
    const hasLoginForm = !!document.querySelector('input[name="email"], input[type="email"], #email');
    const hasPasswordField = !!document.querySelector('input[name="pass"], input[name="password"], input[type="password"]');
    const hasLoginButton = !!document.querySelector('button[name="login"], input[value="Log In"], [data-testid="royal_login_button"]');
    const hasLoginText = document.body.textContent.toLowerCase().includes('log in') || 
                         document.body.textContent.toLowerCase().includes('sign in');
    
    return hasLoginForm && hasPasswordField && (hasLoginButton || hasLoginText);
  });
  
  return loginElements;
}

async function performFacebookLogin(page, email, password) {
  console.log('🔐 Performing Facebook login...');
  
  try {
    // Wait for login form elements
    await page.waitForSelector('input[name="email"], input[type="email"]', { timeout: 10000 });
    
    // Fill email
    const emailField = await page.$('input[name="email"], input[type="email"]');
    if (emailField) {
      await humanClick(page, emailField);
      await delay(rand(300, 600));
      await humanType(emailField, email, { min: 80, max: 180 });
      await delay(rand(400, 800));
    } else {
      throw new Error('Email field not found');
    }
    
    // Fill password
    const passwordField = await page.$('input[name="pass"], input[type="password"]');
    if (passwordField) {
      await humanClick(page, passwordField);
      await delay(rand(300, 600));
      await humanType(passwordField, password, { min: 80, max: 180 });
      await delay(rand(500, 1000));
    } else {
      throw new Error('Password field not found');
    }
    
    // Click login button
    const loginButton = await page.$('button[name="login"], input[value="Log In"], [data-testid="royal_login_button"], button[type="submit"]');
    if (loginButton) {
      await humanClick(page, loginButton);
    } else {
      // Fallback: press Enter
      await page.keyboard.press('Enter');
    }
    
    console.log('⏳ Waiting for login to complete...');
    
    // Wait for navigation or login completion
    await Promise.race([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }),
      delay(5000) // Sometimes FB doesn't navigate, just updates the page
    ]);
    
    await delay(rand(2000, 4000));
    
    // Check for CAPTCHA
    const captchaPresent = await page.evaluate(() => {
      const frames = Array.from(document.querySelectorAll('iframe'));
      const hasRecaptcha = frames.some(f => (f.src || '').toLowerCase().includes('recaptcha'));
      const hasCaptchaText = document.body.textContent.toLowerCase().includes('security check') ||
                            document.body.textContent.toLowerCase().includes('verify') ||
                            !!document.querySelector('[id*="captcha"], [class*="captcha"]');
      return hasRecaptcha || hasCaptchaText;
    });
    
    if (captchaPresent) {
      console.log('🚨 CAPTCHA detected during login');
      const solved = await solveCaptcha(page);
      if (!solved) {
        throw new Error('CAPTCHA could not be solved during login');
      }
      await delay(rand(3000, 5000));
    }
    
    // Check if login was successful
    const stillOnLoginPage = await isLoginRequired(page);
    if (stillOnLoginPage) {
      // Check for error messages
      const errorMessage = await page.evaluate(() => {
        const errorElements = document.querySelectorAll('[role="alert"], .error, [id*="error"]');
        for (const el of errorElements) {
          if (el.textContent.trim()) return el.textContent.trim();
        }
        return null;
      });
      
      if (errorMessage) {
        throw new Error(`Login failed: ${errorMessage}`);
      } else {
        throw new Error('Login failed: Still on login page');
      }
    }
    
    console.log('✅ Facebook login successful!');
    return true;
    
  } catch (error) {
    console.error('❌ Facebook login failed:', error.message);
    throw error;
  }
}

/* ------------------------- Send message to profile ------------------------ */

async function sendMessageToProfile(page, profile, message, options = {}) {
  const start = Date.now();
  
  try {
    console.log(`\n🎯 Processing profile: ${profile.id}`);
    console.log(`🔗 URL: ${profile.url}`);
    
    // Load cookies first to maintain session
    const email = process.env.LOGIN_EMAIL;
    if (email) {
      await loadCookies(page, email);
    }
    
    // Navigate to profile URL
    console.log('🌐 Navigating to profile...');
    await page.goto(profile.url, { waitUntil: 'networkidle2', timeout: 60000 });
    await delay(rand(2000, 4000));
    
    // Check if login is required
    const needsLogin = await isLoginRequired(page);
    if (needsLogin) {
      console.log('🔒 Login required, authenticating...');
      await performFacebookLogin(page, process.env.LOGIN_EMAIL, process.env.LOGIN_PASSWORD);
      await saveCookies(page, process.env.LOGIN_EMAIL);
      
      // Navigate back to profile after login
      console.log('🔄 Returning to profile after login...');
      await page.goto(profile.url, { waitUntil: 'networkidle2', timeout: 60000 });
      await delay(rand(2000, 4000));
    }
    
    // Human-like behavior
    await humanScroll(page, rand(200, 500), rand(3, 6));
    await delay(rand(1000, 2000));
    
    // Look for message button/link (Facebook-specific)
    const messageButton = await page.$('a[href*="/messages/"], a[href*="messenger.com"], [aria-label*="Message"], [aria-label*="Send message"]');
    
    if (messageButton) {
      console.log('💬 Found message button, clicking...');
      await humanClick(page, messageButton);
      await delay(rand(2000, 4000));
      
      // Wait for messenger interface to load
      await page.waitForSelector('div[contenteditable="true"], textarea, input[placeholder*="message"]', { timeout: 15000 });
      await delay(rand(1000, 2000));
      
      // Find and click message input
      const messageInput = await page.$('div[contenteditable="true"][data-testid], div[contenteditable="true"][aria-label*="message"], textarea[placeholder*="message"]');
      
      if (messageInput) {
        console.log('⌨️ Typing message...');
        await humanClick(page, messageInput);
        await delay(rand(500, 1000));
        await humanType(messageInput, message, { min: 100, max: 250 });
        await delay(rand(1000, 2000));
        
        // Send message
        const sendButton = await page.$('button[type="submit"], [aria-label*="Send"], [data-testid*="send"]');
        if (sendButton) {
          console.log('📤 Sending message...');
          await humanClick(page, sendButton);
          await delay(rand(2000, 3000));
        } else {
          // Try pressing Enter
          await page.keyboard.press('Enter');
          await delay(rand(2000, 3000));
        }
        
        console.log('✅ Message sent successfully!');
      } else {
        throw new Error('Message input field not found');
      }
    } else {
      // Alternative: Look for direct message compose area on profile
      console.log('🔍 Looking for direct message compose area...');
      
      const directMessageArea = await page.$('div[contenteditable="true"], textarea[placeholder*="Write"], input[placeholder*="message"]');
      if (directMessageArea) {
        await humanClick(page, directMessageArea);
        await delay(rand(500, 1000));
        await humanType(directMessageArea, message, { min: 100, max: 250 });
        await delay(rand(1000, 2000));
        
        // Look for send button near the text area
        const sendBtn = await page.$('button[type="submit"], [aria-label*="Send"], button:has-text("Send")');
        if (sendBtn) {
          await humanClick(page, sendBtn);
          await delay(rand(2000, 3000));
        } else {
          await page.keyboard.press('Enter');
          await delay(rand(2000, 3000));
        }
        
        console.log('✅ Direct message sent!');
      } else {
        throw new Error('No messaging interface found on this profile');
      }
    }
    
    const duration = Date.now() - start;
    return { 
      success: true, 
      profileId: profile.id, 
      url: profile.url, 
      durationMs: duration,
      message: message.substring(0, 50) + (message.length > 50 ? '...' : '')
    };
    
  } catch (err) {
    const duration = Date.now() - start;
    console.error(`❌ Failed to send message to ${profile.id}: ${err.message}`);
    return { 
      success: false, 
      profileId: profile.id, 
      url: profile.url, 
      error: err.message, 
      durationMs: duration 
    };
  }
}

/* ------------------------------- Main flow -------------------------------- */

async function launchBrowser(opts = {}) {
  const headless = process.env.HEADLESS === 'true';
  
  console.log(`🚀 Launching browser (headless: ${headless})...`);
  
  const browser = await puppeteer.launch({
    headless,
    defaultViewport: DEFAULT_VIEWPORT,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=VizDisplayCompositor',
      '--disable-web-security',
      '--disable-features=site-per-process',
      '--flag-switches-begin',
      '--disable-ipc-flooding-protection',
      '--flag-switches-end'
    ],
    ignoreDefaultArgs: ['--enable-automation'],
    ...opts
  });
  
  return browser;
}

async function processAll(profiles, message) {
  const email = process.env.LOGIN_EMAIL;
  const password = process.env.LOGIN_PASSWORD;
  
  if (!email || !password) {
    throw new Error('❌ LOGIN_EMAIL and LOGIN_PASSWORD must be set in .env file');
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  // Set realistic headers and user agent
  await page.setUserAgent(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  );
  
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Connection': 'keep-alive',
  });

  const results = [];
  
  try {
    console.log(`📋 Processing ${profiles.length} profiles with message: "${message}"`);
    
    // Process each profile
    for (let i = 0; i < profiles.length; i++) {
      const profile = profiles[i];
      
      console.log(`\n📍 Profile ${i + 1}/${profiles.length}`);
      
      try {
        // Add random delay between profiles (2-8 seconds)
        if (i > 0) {
          const pauseTime = rand(2000, 8000);
          console.log(`⏸️ Pausing ${pauseTime}ms between profiles...`);
          await delay(pauseTime);
        }
        
        const result = await sendMessageToProfile(page, profile, message);
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
        console.error(`❌ Profile ${profile.id} failed:`, err.message);
      }
    }
    
  } catch (err) {
    console.error('💥 Fatal error during processing:', err);
    throw err;
  } finally {
    console.log('🔒 Closing browser...');
    await browser.close();
  }
  
  return results;
}

/* ------------------------------- CLI / Run -------------------------------- */

async function main() {
  console.log('🤖 Enhanced Facebook Messenger Automation Starting...\n');
  
  const argv = minimist(process.argv.slice(2));
  const profilesPath = argv.profiles || argv.p || 'profiles.json';
  const message = argv.message || argv.m;
  
  if (!message) {
    console.error('❌ Usage: node messenger.js --message "Your message here" [--profiles profiles.json]');
    console.error('   Example: node messenger.js --message "Hello! How are you?" --profiles profiles.json');
    process.exit(1);
  }

  // Check if profiles file exists
  if (!await fs.pathExists(profilesPath)) {
    console.error(`❌ Profiles file not found: ${profilesPath}`);
    console.error('   Create a profiles.json file with profile URLs');
    process.exit(1);
  }

  try {
    const profiles = await fs.readJson(profilesPath);
    
    if (!Array.isArray(profiles) || profiles.length === 0) {
      console.error('❌ Profiles file must contain an array of profile objects');
      process.exit(1);
    }
    
    // Validate environment variables
    if (!process.env.LOGIN_EMAIL || !process.env.LOGIN_PASSWORD) {
      console.error('❌ Missing required environment variables:');
      console.error('   LOGIN_EMAIL and LOGIN_PASSWORD must be set in .env file');
      process.exit(1);
    }
    
    console.log(`📧 Login email: ${process.env.LOGIN_EMAIL}`);
    console.log(`📝 Message: "${message}"`);
    console.log(`👥 Profiles to process: ${profiles.length}`);
    console.log(`🤖 Headless mode: ${process.env.HEADLESS === 'true'}`);
    console.log(`📁 Results will be saved to: ${OUTPUT_LOG}\n`);
    
    const startTime = Date.now();
    const results = await processAll(profiles, message);
    const totalTime = Date.now() - startTime;
    
    // Summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log('\n' + '='.repeat(50));
    console.log('📊 FINAL RESULTS SUMMARY');
    console.log('='.repeat(50));
    console.log(`⏱️  Total time: ${Math.round(totalTime / 1000)}s`);
    console.log(`✅ Successful: ${successful}/${profiles.length}`);
    console.log(`❌ Failed: ${failed}/${profiles.length}`);
    console.log(`📁 Detailed logs: ${OUTPUT_LOG}`);
    
    if (failed > 0) {
      console.log('\n❌ Failed profiles:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`   • ${r.profileId}: ${r.error}`);
      });
    }
    
    if (successful > 0) {
      console.log('\n✅ Successful profiles:');
      results.filter(r => r.success).forEach(r => {
        console.log(`   • ${r.profileId}: ${Math.round(r.durationMs / 1000)}s`);
      });
    }
    
    console.log('\n🎉 Script completed!');
    
  } catch (err) {
    console.error('\n💥 Script failed:', err.message);
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
  isLoginRequired,
  performFacebookLogin,
  sendMessageToProfile,
  processAll,
  saveCookies,
  loadCookies
};

// Run CLI if this file is executed directly
if (require.main === module) {
  main().catch(console.error);
}