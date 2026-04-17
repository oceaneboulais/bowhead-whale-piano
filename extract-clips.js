#!/usr/bin/env node

/**
 * Extract 3-second clips from whale sound files
 * Creates smaller, browser-friendly versions of the WAV files
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const INPUT_DIR = path.join(__dirname, 'wav-files');
const OUTPUT_DIR = path.join(__dirname, 'wav-clips');
const CLIP_DURATION = 3; // seconds
const START_TIME = 0; // start from beginning

async function checkFFmpeg() {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch (error) {
        return false;
    }
}

async function extractClip(inputPath, outputPath) {
    const cmd = `ffmpeg -i "${inputPath}" -t ${CLIP_DURATION} -acodec pcm_s16le -ar 44100 -ac 1 "${outputPath}" -y`;
    
    try {
        await execAsync(cmd);
        return true;
    } catch (error) {
        console.error(`Error processing ${path.basename(inputPath)}:`, error.message);
        return false;
    }
}

async function main() {
    console.log('🐋 Whale Sound Clip Extractor\n');
    console.log('This will create 3-second clips from each whale sound file');
    console.log('for faster browser loading.\n');
    
    // Check for ffmpeg
    console.log('Checking for ffmpeg...');
    const hasFFmpeg = await checkFFmpeg();
    
    if (!hasFFmpeg) {
        console.error('❌ ffmpeg not found!');
        console.error('\nPlease install ffmpeg:');
        console.error('  brew install ffmpeg\n');
        process.exit(1);
    }
    
    console.log('✓ ffmpeg found\n');
    
    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        console.log(`✓ Created output directory: ${OUTPUT_DIR}\n`);
    }
    
    // Find all WAV files
    const files = fs.readdirSync(INPUT_DIR)
        .filter(f => f.toUpperCase().endsWith('.WAV'))
        .sort();
    
    if (files.length === 0) {
        console.error('❌ No WAV files found in wav-files directory');
        process.exit(1);
    }
    
    console.log(`Found ${files.length} files to process\n`);
    console.log('Extracting 3-second clips...\n');
    
    let processed = 0;
    let failed = 0;
    
    for (let i = 0; i < files.length; i++) {
        const filename = files[i];
        const inputPath = path.join(INPUT_DIR, filename);
        const outputPath = path.join(OUTPUT_DIR, filename);
        
        // Skip if already exists
        if (fs.existsSync(outputPath)) {
            console.log(`⏭  ${i + 1}/${files.length} ${filename} (already exists)`);
            processed++;
            continue;
        }
        
        process.stdout.write(`⏳ ${i + 1}/${files.length} ${filename}...`);
        
        const success = await extractClip(inputPath, outputPath);
        
        if (success) {
            const stats = fs.statSync(outputPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
            console.log(`\r✓ ${i + 1}/${files.length} ${filename} (${sizeMB} MB)`);
            processed++;
        } else {
            console.log(`\r✗ ${i + 1}/${files.length} ${filename} (failed)`);
            failed++;
        }
    }
    
    console.log(`\n${'='.repeat(50)}`);
    console.log(`✅ Complete!`);
    console.log(`   Processed: ${processed}/${files.length}`);
    console.log(`   Failed: ${failed}`);
    console.log(`\nClips saved to: ${OUTPUT_DIR}`);
    console.log(`\nNow update app.js to use 'wav-clips' instead of 'wav-files'\n`);
}

main().catch(console.error);
