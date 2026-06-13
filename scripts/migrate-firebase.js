#!/usr/bin/env node
'use strict';
/**
 * One-time migration: Firebase Realtime Database → MongoDB
 *
 * Usage:
 *   1. Go to Firebase Console → Project Settings → Service Accounts → Export JSON (or
 *      Realtime Database → three-dot menu → Export JSON)
 *   2. Save the export as e.g. firebase-export.json
 *   3. Run:  node scripts/migrate-firebase.js firebase-export.json
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const User     = require('../server/models/User');

async function migrate() {
  const exportPath = process.argv[2];
  if (!exportPath) {
    console.error('Usage: node scripts/migrate-firebase.js <firebase-export.json>');
    process.exit(1);
  }

  let raw;
  try { raw = fs.readFileSync(path.resolve(exportPath), 'utf8'); }
  catch (e) { console.error('Cannot read file:', e.message); process.exit(1); }

  let firebaseData;
  try { firebaseData = JSON.parse(raw); }
  catch (e) { console.error('Invalid JSON:', e.message); process.exit(1); }

  const players = firebaseData.players || firebaseData; // handle both root and /players key
  const entries = Object.entries(players).filter(([, v]) => v && typeof v === 'object');
  console.log(`Found ${entries.length} players in Firebase export.`);

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  console.log('MongoDB connected.\n');

  let created = 0, merged = 0, skipped = 0, failed = 0;

  for (const [googleId, data] of entries) {
    if (!googleId || !data.displayName) { skipped++; continue; }
    try {
      const existing = await User.findOne({ googleId }).lean();

      if (!existing) {
        // New user — import directly from Firebase
        await User.create({
          googleId,
          displayName:  data.displayName  || 'Unknown',
          photoURL:     data.photoURL     || '',
          rating:       typeof data.rating       === 'number' ? data.rating       : 1200,
          wins:         typeof data.wins         === 'number' ? data.wins         : 0,
          roundsPlayed: typeof data.roundsPlayed === 'number' ? data.roundsPlayed : 0,
        });
        console.log(`  Created: ${data.displayName} (${googleId})`);
        created++;
      } else {
        // Already exists — take the better stats (higher wins/rating wins)
        const update = {};
        if ((data.rating || 1200) > existing.rating) update.rating = data.rating;
        if ((data.wins   || 0)    > existing.wins)   update.wins   = data.wins;
        if ((data.roundsPlayed || 0) > existing.roundsPlayed) update.roundsPlayed = data.roundsPlayed;

        if (Object.keys(update).length) {
          await User.updateOne({ googleId }, { $set: update });
          console.log(`  Merged:  ${data.displayName} (${googleId}) — updated ${Object.keys(update).join(', ')}`);
          merged++;
        } else {
          console.log(`  Skipped: ${data.displayName} (${googleId}) — MongoDB data is newer`);
          skipped++;
        }
      }
    } catch (e) {
      console.error(`  FAILED:  ${googleId} — ${e.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Created: ${created}, Merged: ${merged}, Skipped: ${skipped}, Failed: ${failed}`);
  await mongoose.disconnect();
}

migrate().catch(err => { console.error(err); process.exit(1); });
