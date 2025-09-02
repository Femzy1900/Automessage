import puppeteer from "puppeteer";
import {Actor} from "apify";

await Actor.init();

const browser = await puppeteer.launch({
    headless: process.env.HEADLESS === "true",
    args: [                         
        '--no-sandbox',
        '--disable-setuid-sandbox',
    ],
});
const page = await browser.newPage();
await page.goto('https://www.facebook.com/login', {waitUntil: 'networkidle2'});