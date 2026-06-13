#!/usr/bin/env node
'use strict';
/**
 * Fixes accounts imported from Firebase by updating their googleId from the
 * Firebase UID to the real Google sub claim, and merging any duplicate accounts
 * that were created when users signed in before this fix.
 *
 * Usage:
 *   1. Firebase Console → Authentication → Users → Download accounts → firebase-auth-export.json
 *   2. node scripts/fix-firebase-googleids.js firebase-auth-export.json [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const User     = require('../server/models/User');

const DRY_RUN = process.argv.includes('--dry-run');

async function run() {
  const exportPath = process.argv.find(a => a.endsWith('.json'));
  if (!exportPath) {
    console.error('Usage: node scripts/fix-firebase-googleids.js <firebase-auth-export.json> [--dry-run]');
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(path.resolve(exportPath), 'utf8'));
  const firebaseUsers = raw.users || [];
  console.log(`Loaded ${firebaseUsers.length} users from Firebase Auth export.\n`);
  if (DRY_RUN) console.log('--- DRY RUN — no changes will be written ---\n');

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('MongoDB connected.\n');

  let fixed = 0, merged = 0, skipped = 0, notFound = 0;

  for (const fbUser of firebaseUsers) {
    const firebaseUid = fbUser.localId;
    const email       = (fbUser.email || '').toLowerCase();

    // Find the Google sub from providerUserInfo
    const googleProvider = (fbUser.providerUserInfo || [])
      .find(p => p.providerId === 'google.com');
    const googleSub = googleProvider?.rawId;

    if (!googleSub) {
      console.log(`  SKIP (no Google provider): ${email || firebaseUid}`);
      skipped++;
      continue;
    }

    // Find the Firebase-imported account (wrong googleId = Firebase UID)
    const importedAccount = await User.findOne({ googleId: firebaseUid });

    // Find any duplicate account created by sign-in (correct googleId = Google sub)
    const signInAccount = await User.findOne({ googleId: googleSub });

    if (!importedAccount && !signInAccount) {
      console.log(`  NOT FOUND: ${email || firebaseUid}`);
      notFound++;
      continue;
    }

    if (!importedAccount && signInAccount) {
      // Already fixed (or was never imported) — just ensure email is set
      if (email && !signInAccount.email) {
        if (!DRY_RUN) { signInAccount.email = email; await signInAccount.save(); }
        console.log(`  EMAIL SET: ${email} (already on correct googleId)`);
      } else {
        console.log(`  OK: ${email || googleSub} already correct`);
      }
      skipped++;
      continue;
    }

    if (importedAccount && !signInAccount) {
      // Happy path: just update googleId and email
      console.log(`  FIX: ${email || firebaseUid} — updating googleId ${firebaseUid} → ${googleSub}`);
      if (!DRY_RUN) {
        importedAccount.googleId = googleSub;
        if (email) importedAccount.email = email;
        await importedAccount.save();
      }
      fixed++;
      continue;
    }

    // Both exist — merge: keep imported (has stats), delete sign-in duplicate
    const keep   = importedAccount;
    const remove = signInAccount;

    // Take the better stats from either account
    const bestRating       = Math.max(keep.rating       ?? 1200, remove.rating       ?? 1200);
    const bestWins         = Math.max(keep.wins         ?? 0,    remove.wins         ?? 0);
    const bestRoundsPlayed = Math.max(keep.roundsPlayed ?? 0,    remove.roundsPlayed ?? 0);
    const bestBestTimeMs   = [keep.practiceStats?.bestTimeMs, remove.practiceStats?.bestTimeMs]
      .filter(v => v != null).reduce((a, b) => Math.min(a, b), Infinity);
    const bestBestStreak   = Math.max(
      keep.practiceStats?.bestStreak   ?? 0,
      remove.practiceStats?.bestStreak ?? 0
    );

    console.log(`  MERGE: ${email} — keeping imported account, deleting sign-in duplicate`);
    if (!DRY_RUN) {
      // Delete the duplicate FIRST so its googleId is free before we update keep
      await User.deleteOne({ _id: remove._id });
      keep.googleId       = googleSub;
      keep.email          = email || keep.email;
      keep.rating         = bestRating;
      keep.wins           = bestWins;
      keep.roundsPlayed   = bestRoundsPlayed;
      keep.displayName    = fbUser.displayName || keep.displayName;
      keep.photoURL       = fbUser.photoUrl    || keep.photoURL;
      if (bestBestTimeMs !== Infinity) {
        keep.practiceStats = keep.practiceStats || {};
        keep.practiceStats.bestTimeMs = bestBestTimeMs;
        keep.practiceStats.bestStreak = bestBestStreak;
      }
      await keep.save();
    }
    merged++;
  }

  console.log(`\nDone. Fixed: ${fixed}, Merged: ${merged}, Skipped: ${skipped}, Not found: ${notFound}`);
  if (DRY_RUN) console.log('\n(Dry run — nothing was written)');
  await mongoose.disconnect();
}

run().catch(err => { console.error(err); process.exit(1); });
