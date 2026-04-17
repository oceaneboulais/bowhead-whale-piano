#!/usr/bin/env node

/**
 * Frequency-Matched Whale Sound Clip Extractor
 * 
 * Analyzes whale sound files and extracts 3-second clips where the dominant
 * frequency best matches the target piano key frequency.
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const INPUT_DIR = path.join(__dirname, 'wav-files');
const OUTPUT_DIR = path.join(__dirname, 'wav-clips');
const CLIP_DURATION = 3; // seconds
const ANALYSIS_WINDOW = 3; // seconds - analyze in 3-second windows
const TEMP_DIR = path.join(__dirname, '.temp_analysis');

// Piano frequencies (A0 to C8 - 88 keys)
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
    'A0', 'A#0', 'B0',
    'C1', 'C#1', 'D1', 'D#1', 'E1', 'F1', 'F#1', 'G1', 'G#1',
    'A1', 'A#1', 'B1',
    'C2', 'C#2', 'D2', 'D#2', 'E2', 'F2', 'F#2', 'G2', 'G#2',
    'A2', 'A#2', 'B2',
    'C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3',
    'A3', 'A#3', 'B3',
    'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4',
    'A4', 'A#4', 'B4',
    'C5', 'C#5', 'D5', 'D#5', 'E5', 'F5', 'F#5', 'G5', 'G#5',
    'A5', 'A#5', 'B5',
    'C6', 'C#6', 'D6', 'D#6', 'E6', 'F6', 'F#6', 'G6', 'G#6',
    'A6', 'A#6', 'B6',
    'C7', 'C#7', 'D7', 'D#7', 'E7', 'F7', 'F#7', 'G7', 'G#7',
    'A7', 'A#7', 'B7',
    'C8'
];

async function checkFFmpeg() {
    try {
        await execAsync('ffmpeg -version');
        return true;
    } catch (error) {
        return false;
    }
}

async function getFileDuration(filePath) {
    try {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const { stdout } = await execAsync(cmd);
        return parseFloat(stdout.trim());
    } catch (error) {
        console.error(`Error getting duration:`, error.message);
        return 0;
    }
}

async function analyzeFrequencyInSegment(filePath, startTime, duration, targetFreq) {
    // Extract segment to temp mono PCM file for analysis
    const tempFile = path.join(TEMP_DIR, `analyze_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.raw`);
    
    try {
        // Extract raw PCM data: 16-bit signed integer, 44100 Hz, mono
        const extractCmd = `ffmpeg -i "${filePath}" -ss ${startTime} -t ${duration} -f s16le -acodec pcm_s16le -ar 44100 -ac 1 "${tempFile}" -y 2>&1`;
        await execAsync(extractCmd);
        
        // Read the raw audio data
        const buffer = fs.readFileSync(tempFile);
        const samples = new Int16Array(buffer.buffer, buffer.byteOffset, buffer.length / 2);
        
        // Cleanup temp file
        fs.unlinkSync(tempFile);
        
        // Perform autocorrelation to find dominant frequency
        const frequency = autoCorrelate(samples, 44100);
        
        if (frequency > 0) {
            // Calculate how well this matches the target frequency
            // Use semitone distance as the metric
            const semitoneDistance = 12 * Math.log2(frequency / targetFreq);
            const score = 1 / (1 + Math.abs(semitoneDistance)); // Higher score = closer match
            
            return {
                startTime,
                frequency,
                targetFreq,
                semitoneDistance: Math.abs(semitoneDistance),
                score,
                hasSignal: true
            };
        }
        
        return {
            startTime,
            frequency: -1,
            targetFreq,
            semitoneDistance: Infinity,
            score: 0,
            hasSignal: false
        };
    } catch (error) {
        // Cleanup on error
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        return {
            startTime,
            frequency: -1,
            targetFreq,
            semitoneDistance: Infinity,
            score: 0,
            hasSignal: false
        };
    }
}

function autoCorrelate(buffer, sampleRate) {
    // Autocorrelation-based pitch detection (same algorithm as in app.js)
    const SIZE = buffer.length;
    const MAX_SAMPLES = Math.floor(SIZE / 2);
    let best_offset = -1;
    let best_correlation = 0;
    let rms = 0;
    
    // Calculate RMS to check if there's enough signal
    for (let i = 0; i < SIZE; i++) {
        const val = buffer[i] / 32768.0; // Normalize to -1 to 1
        rms += val * val;
    }
    rms = Math.sqrt(rms / SIZE);
    
    // Not enough signal
    if (rms < 0.01) return -1;
    
    // Find the peak correlation
    let lastCorrelation = 1;
    for (let offset = 100; offset < MAX_SAMPLES; offset++) {
        let correlation = 0;
        
        for (let i = 0; i < MAX_SAMPLES; i++) {
            const val1 = buffer[i] / 32768.0;
            const val2 = buffer[i + offset] / 32768.0;
            correlation += Math.abs(val1 - val2);
        }
        
        correlation = 1 - (correlation / MAX_SAMPLES);
        
        if (correlation > 0.9 && correlation > lastCorrelation) {
            const foundGoodCorrelation = correlation > best_correlation;
            if (foundGoodCorrelation) {
                best_correlation = correlation;
                best_offset = offset;
            }
        }
        lastCorrelation = correlation;
    }
    
    if (best_offset === -1) return -1;
    
    const fundamental_frequency = sampleRate / best_offset;
    return fundamental_frequency;
}

async function findBestSegment(filePath, targetFreq, fileIndex) {
    const duration = await getFileDuration(filePath);
    
    if (duration < CLIP_DURATION) {
        console.log(`      File too short (${duration.toFixed(1)}s), using start`);
        return { startTime: 0, frequency: -1, score: 0 };
    }
    
    // Analyze segments throughout the file
    const numSegments = Math.min(20, Math.floor(duration / ANALYSIS_WINDOW)); // Analyze up to 20 segments
    const analyses = [];
    
    console.log(`      Analyzing ${numSegments} segments for best frequency match...`);
    
    for (let i = 0; i < numSegments; i++) {
        const startTime = (duration - CLIP_DURATION) * (i / (numSegments - 1));
        
        // Analyze this segment
        const analysis = await analyzeFrequencyInSegment(
            filePath,
            startTime,
            Math.min(CLIP_DURATION, duration - startTime),
            targetFreq
        );
        
        analyses.push(analysis);
        
        // Show progress for every 5th segment
        if ((i + 1) % 5 === 0 || i === numSegments - 1) {
            process.stdout.write(`\r      Analyzing segments: ${i + 1}/${numSegments}...`);
        }
    }
    
    console.log(''); // New line after analysis
    
    // Find the segment with the best match
    const validAnalyses = analyses.filter(a => a.hasSignal && a.frequency > 0);
    
    if (validAnalyses.length === 0) {
        console.log(`      ⚠ No clear pitch detected, using middle of file`);
        return { startTime: duration / 2, frequency: -1, score: 0 };
    }
    
    // Sort by score (best match first)
    validAnalyses.sort((a, b) => b.score - a.score);
    
    const best = validAnalyses[0];
    console.log(`      ✓ Best match: ${best.frequency.toFixed(2)} Hz at ${best.startTime.toFixed(1)}s (off by ${best.semitoneDistance.toFixed(2)} semitones)`);
    
    return best;
}

async function extractClip(inputPath, outputPath, startTime) {
    // Apply bandpass filter around the target frequency
    const cmd = `ffmpeg -i "${inputPath}" -ss ${startTime} -t ${CLIP_DURATION} -acodec pcm_s16le -ar 44100 -ac 1 "${outputPath}" -y 2>&1`;
    
    try {
        await execAsync(cmd);
        return true;
    } catch (error) {
        console.error(`Error extracting clip:`, error.message);
        return false;
    }
}

async function main() {
    console.log('🐋 Frequency-Matched Whale Sound Extractor\n');
    console.log('This extracts 3-second clips that best match each piano key frequency');
    console.log('='.repeat(70));
    console.log('');
    
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
    
    // Create directories
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(TEMP_DIR)) {
        fs.mkdirSync(TEMP_DIR, { recursive: true });
    }
    
    // Find all WAV files
    const files = fs.readdirSync(INPUT_DIR)
        .filter(f => f.toUpperCase().endsWith('.WAV'))
        .sort();
    
    if (files.length === 0) {
        console.error('❌ No WAV files found in wav-files directory');
        process.exit(1);
    }
    
    console.log(`Found ${files.length} files to process`);
    console.log(`Mapping to ${PIANO_FREQUENCIES.length} piano keys\n`);
    
    let processed = 0;
    let failed = 0;
    
    for (let i = 0; i < Math.min(files.length, PIANO_FREQUENCIES.length); i++) {
        const filename = files[i];
        const inputPath = path.join(INPUT_DIR, filename);
        const outputPath = path.join(OUTPUT_DIR, filename);
        const targetFreq = PIANO_FREQUENCIES[i];
        const noteName = NOTE_NAMES[i];
        
        // Skip if already exists
        if (fs.existsSync(outputPath)) {
            console.log(`⏭  ${i + 1}/${files.length} ${noteName} (${targetFreq.toFixed(2)} Hz) - ${filename} (exists)`);
            processed++;
            continue;
        }
        
        process.stdout.write(`⏳ ${i + 1}/${files.length} ${noteName} (${targetFreq.toFixed(2)} Hz) - ${filename}...\n`);
        
        try {
            // Find best matching segment with frequency analysis
            const analysis = await findBestSegment(inputPath, targetFreq, i);
            const startTime = analysis.startTime;
            
            // Extract clip
            const success = await extractClip(inputPath, outputPath, startTime);
            
            if (success && fs.existsSync(outputPath)) {
                const stats = fs.statSync(outputPath);
                const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
                const freqInfo = analysis.frequency > 0 ? ` detected: ${analysis.frequency.toFixed(2)} Hz` : '';
                console.log(`   ✓ Extracted ${sizeMB} MB from ${startTime.toFixed(1)}s${freqInfo}\n`);
                processed++;
            } else {
                console.log(`   ✗ Failed to extract clip\n`);
                failed++;
            }
        } catch (error) {
            console.log(`   ✗ Error: ${error.message}\n`);
            failed++;
        }
    }
    
    // Cleanup temp directory
    try {
        if (fs.existsSync(TEMP_DIR)) {
            const tempFiles = fs.readdirSync(TEMP_DIR);
            tempFiles.forEach(f => fs.unlinkSync(path.join(TEMP_DIR, f)));
            fs.rmdirSync(TEMP_DIR);
        }
    } catch (e) {
        // Ignore cleanup errors
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ Complete!`);
    console.log(`   Processed: ${processed}/${files.length}`);
    console.log(`   Failed: ${failed}`);
    console.log(`\nFrequency-matched clips saved to: ${OUTPUT_DIR}`);
    console.log(`\nEach clip was analyzed to find the 3-second segment where`);
    console.log(`the whale sound's dominant frequency best matches the target piano note.`);
    console.log(`\nYour frequency-matched whale piano is ready!`);
    console.log(`Reload the browser at http://localhost:8080/ to play.\n`);
}

main().catch(console.error);
