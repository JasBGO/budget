# Budget

A private budgeting app for one person's iPhone. It installs from Safari to the home screen and runs fully on the phone.

## Privacy

- Everything is stored encrypted on the phone (AES-256-GCM). The key is locked with a 6-digit passcode (PBKDF2, 600,000 rounds) and, optionally, a Face ID passkey (WebAuthn PRF, iOS 18+).
- There is no server and no account. This repository holds only the app's code, never any data.
- Statements are read on the phone. Only when you ask Claude something does the app send a summary (totals by category and merchant, budgets, card balances, goals) to the Claude API, using your own API key.
- Encrypted backups can be saved to Files or iCloud Drive and restored with the passcode they were made with.

## Features

- Daily, weekly and monthly views of every transaction across accounts, with search
- Bank and credit card statement import (CSV, OFX, QFX), with automatic categories, duplicate skipping and card payments counted once
- Monthly budget by category, with "safe to spend today", alerts at 80% and suggestions from your own spending
- Card payoff planner (highest-APR first), card and bill due dates, reminders added to iPhone Calendar
- Subscription finder, small purchases that add up, top merchants, month-by-month spending
- Savings goals
- Claude built in: spending review, what to cut, and a budget you can apply with one tap

## Install

1. Open the GitHub Pages link in **Safari** on the iPhone.
2. Tap **Share**, then **Add to Home Screen**.
3. Open it from the home screen and set a passcode.

## Updating

Change the files, bump `VERSION` in `sw.js`, and push to `main`. The phone picks up the new version the next time the app is opened online.

`vendor/anthropic.js` is the official `@anthropic-ai/sdk` (1.3.0) bundled for the browser with esbuild.
