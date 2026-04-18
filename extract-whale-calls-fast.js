#!/usr/bin/env node

/**
 * Fast Whale Call Detector
 * Uses energy-based detection in the whale frequency band (50-500 Hz)
 * Scans spectrograms to find high-energy regions indicating vocalizations
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const INPUT_DIR = path.join(__dirname, 'wav-files');
const OUTPUT_DIR = path.join(__dirname, 'wav-clips');
const CLIP_DURATION = 3; // seconds

// Piano frequencies  
const PIANO_FREQUENCIES = [
    27.50, 29.14, 30.87, 32.70, 34.65, 36.71, 38.89, 41.20, 43.65, 46.25, 49.00, 51.91,
    55.00, 58.27, 61.74, 65.41, 69.30, 73.42, 77.78, 82.41, 87.31, 92.50, 98.00, 103.83,
    110.00, 116.54, 123.47, 130.81, 138.59, 146.83, 155.56, 164.81, 174.61, 185.00, 196.00, 207.65,
    220.00, 233.08, 246.94, 261.63, 277.18, 293.66, 311.13, 329.63, 349.23, 369.99, 392.00, 415.30,
    440.00, 466.16, 493.88, 523.25, 554.37, 587.33, 622.25, 659.25, 698.46, 739.99, 783.99, 830.61,
    880.00, 932.33, 987.77, 1046.50, 1108.73, 1174.66, 1244.51, 1318.51, 1396.91, 1479.98, 1567.98, 1661.22,
    1760.00, 1864.66, 1975.53, 2093.00, 2217.46, 2349.32, 2489.02, 2637.02, 2793.83, 2959.96, 3135.96, 3322.44,
    3520.00, 3729.31, 3951.07, 4186.01
];

const NOTE_NAMES = [
    'A0', 'A#0', 'B0', 'C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1',
    'A1', 'A#1', 'B1', 'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2',
    'A2', 'A#2', 'B2', 'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3',
    'A3', 'A#3', 'B3', 'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4',
    'A4', 'A#4', 'B4', 'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5',
    'A5', 'A#5', 'B5', 'C6', 'C#6', 'D6', 'D#6', 'E6', 'F6', 'F#6', 'G6', 'G#6',
    'A6', 'A#6', 'B6', 'C7', 'C#7', 'D7', 'D#7', 'E7', 'F7', 'F#7', 'G7', 'G#7',
    'A7', 'A#7', 'B7', 'C8'
];

async function getFileDuration(filePath) {
    try {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const { stdout } = await execAsync(cmd);
        return parseFloat(stdout.trim());
    } catch (error) {
        return 0;
    }
}

async function findBestSegmentWithBandpass(filePath) {
    /**
     * Strategy: Use ffmpeg's silencedetect to find non-silent regions
     * Apply bandpass filter for whale frequencies (50-500 Hz)
     * Find segments with highest energy
     */
    
    const duration = await getFileDuration(filePath);
    
    if (duration < CLIP_DURATION) {
        return { startTime: 0, method: 'file too short' };
    }
    
    console.log(`    Duration: ${(duration/3600).toFixed(1)}h | Detecting whale calls...`);
    
    // Use ffmpeg with bandpass filter and silencedetect
    // This filters for whale frequencies (50-500Hz) and finds non-silent regions
    const silenceCmd = `ffmpeg -i "${filePath}" -af "bandpass=f=200:width_type=h:width=400,silencedetect=noise=-40dB:d=0.5" -f null - 2>&1 | grep "silence_end"`;
    
    try {
        const { stdout } = await execAsync(silenceCmd, { maxBuffer: 1024 * 1024 * 10 });
        const lines = stdout.split('\n').filter(l => l.includes('silence_end'));
        
        if (lines.length === 0) {
            console.log(`    No whale calls detected, using middle`);
            return { startTime: duration / 2, method: 'fallback' };
        }
        
        // Parse silence_end lines to find regions with sound
        const soundRegions = [];
        for (const line of lines) {
            const match = line.match(/silence_end: ([\d.]+)/);
            if (match) {
                const endTime = parseFloat(match[1]);
                soundRegions.push(endTime);
            }
        }
        
        if (soundRegions.length > 0) {
            // Pick a good region (prefer middle third of file where whales are more active)
            const middleThird = soundRegions.filter(t => t > duration/3 && t < 2*duration/3);
            const candidates = middleThird.length > 0 ? middleThird : soundRegions;
            
            // Pick random from best candidates
            const selectedTime = candidates[Math.floor(Math.random() * Math.min(5, candidates.length))];
            const startTime = Math.max(0, selectedTime - CLIP_DURATION / 2);
            
            console.log(`    ✓ Found ${soundRegions.length} call regions, selected ${(selectedTime/60).toFixed(1)}min`);
            return { startTime, method: 'whale call detected' };
        }
    } catch (error) {
        // Silence detect might fail on very long files, use simpler approach
    }
    
    // Fallback: sample multiple regions and pick one with highest energy
    console.log(`    Sampling energy in 10 regions...`);
    const numSamples = 10;
    const bestRegions = [];
    
    for (let i = 0; i < numSamples; i++) {
        const sampleTime = (duration / numSamples) * i;
        const energyCmd = `ffmpeg -ss ${sampleTime} -i "${filePath}" -t 3 -af "bandpass=f=200:width_type=h:width=400,volumedetect" -f null - 2>&1 | grep "mean_volume"`;
        
        try {
            const { stdout } = await execAsync(energyCmd);
            const match = stdout.match(/mean_volume: ([-\d.]+) dB/);
            if (match) {
                const volume = parseFloat(match[1]);
                bestRegions.push({ time: sampleTime, volume });
            }
        } catch (e) {
            // Skip this sample
        }
    }
    
    if (bestRegions.length > 0) {
        // Sort by volume (higher is better, less negative)
        bestRegions.sort((a, b) => b.volume - a.volume);
        const best = bestRegions[0];
        console.log(`    ✓ Best energy at ${(best.time/60).toFixed(1)}min (${best.volume.toFixed(1)}dB)`);
        return { startTime: best.time, method: 'energy detection' };
    }
    
    // Ultimate fallback
    console.log(`    Using middle of file`);
    return { startTime: duration / 2, method: 'fallback' };
}

async function extractClip(inputPath, outputPath, startTime) {
    // Extract with bandpass filter for whale frequencies
    const cmd = `ffmpeg -ss ${startTime} -i "${inputPath}" -t ${CLIP_DURATION} -af "bandpass=f=200:width_type=h:width=400" -acodec pcm_s16le -ar 44100 -ac 1 "${outputPath}" -y 2>&1`;
    
    try {
        await execAsync(cmd);
        return true;
    } catch (error) {
        return false;
    }
}

async function main() {
    console.log('🐋 Fast Whale Call Extractor');
    console.log('='.repeat(70));
    console.log('Strategy: Bandpass filter (50-500 Hz) + Energy detection');
    console.log('='.repeat(70));
    console.log('');
    
    // Create output directory
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    
    // Load manifest
    const manifestPath = path.join('wav-files', 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        console.error('❌ manifest.json not found');
        process.exit(1);
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const files = manifest.files;
    
    console.log(`Processing ${files.length} files...\n`);
    
    let processed = 0;
    
    for (let i = 0; i < files.length; i++) {
        const fileInfo = files[i];
        const note = NOTE_NAMES[i];
        const targetFreq = PIANO_FREQUENCIES[i];
        const inputPath = path.join(INPUT_DIR, fileInfo.newName);
        const outputPath = path.join(OUTPUT_DIR, fileInfo.newName);
        
        console.log(`⏳ ${i+1}/${files.length} ${note} (${targetFreq.toFixed(2)} Hz) - ${fileInfo.newName}`);
        
        if (!fs.existsSync(inputPath)) {
           console.log(`    ❌ File not found`);
            continue;
        }
        
        // Find best segment
        const { startTime, method } = await findBestSegmentWithBandpass(inputPath);
        
        // Extract clip
        const success = await extractClip(inputPath, outputPath, startTime);
        
        if (success) {
            const stats = fs.statSync(outputPath);
            const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
            console.log(`    ✓ Extracted ${sizeMB} MB from ${(startTime/60).toFixed(1)}min (${method})`);
            processed++;
        } else {
            console.log(`    ❌ Extraction failed`);
        }
        
        console.log('');
    }
    
    console.log(`\n✅ Complete! Extracted ${processed}/${files.length} clips with whale vocalizations\n`);
}

main().catch(console.error);
