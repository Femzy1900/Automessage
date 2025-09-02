import puppeteer from "puppeteer";
import {Actor} from "apify";

await Actor.main(async () => {
    // Your code here, e.g.:
    console.log('Hello world!');

    // Get input from Apify (optional, for dynamic URLs etc.)
    const input = await Actor.getInput() || {};
    const url = input.url || 'https://example.com';

    // Launch Puppeteer with Apify proxy support
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
});