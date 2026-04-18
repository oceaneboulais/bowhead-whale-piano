#!/usr/bin/env node

/**
 * Tonal Whale Call Extractor
 * Specifically selects for sustained, pitched whale calls (upsweeps, downsweeps, FM calls)
 * with clear tonal quality rather than brief clicks or pulses
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

const INPUT_DIR = path.join(__dirname, 'wav-files');
const OUTPUT_DIR = path.join(__dirname, 'wav-clips');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const CLIP_DURATION = 3; // seconds

async function getFileDuration(filePath) {
    try {
        const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
        const { stdout } = await execAsync(cmd);
        return parseFloat(stdout.trim());
    } catch (error) {
        return 0;
    }
}

async function analyzeTonalQuality(filePath, startTime, duration = 3) {
    /**
     * Analyze spectral characteristics to determine tonal quality:
     * - Spectral flatness (lower = more tonal)
     * - Energy concentration (higher = clearer signal)
     * - Pitch stability (more stable = better tonal quality)
     */
    
    try {
        // Extract a small segment and analyze its spectral properties
        const tempFile = `/tmp/analyze_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`;
        
        // Extract segment with bandpass filter
        const extractCmd = `ffmpeg -ss ${startTime} -i "${filePath}" -t ${duration} -af "bandpass=f=200:width_type=h:width=400" -acodec pcm_s16le -ar 44100 -ac 1 "${tempFile}" -y 2>&1`;
        await execAsync(extractCmd, { maxBuffer: 1024 * 1024 });
        
        // Calculate spectral flatness and energy
        const analysisCmd = `ffmpeg -i "${tempFile}" -af "aspectralstats=measure=flatness+mean+variance" -f null - 2>&1 | grep -E "flatness|mean|variance"`;
        const { stdout: spectralOutput } = await execAsync(analysisCmd);
        
        // Calculate RMS energy
        const energyCmd = `ffmpeg -i "${tempFile}" -af "astats=measure_overall=RMS_level" -f null - 2>&1 | grep "RMS level"`;
        const { stdout: energyOutput } = await execAsync(energyCmd);
        
        // Clean up
        try { fs.unlinkSync(tempFile); } catch (e) {}
        
        // Parse spectral flatness (lower = more tonal)
        const flatnessMatch = spectralOutput.match(/flatness:\s*([\d.]+)/);
        const flatness = flatnessMatch ? parseFloat(flatnessMatch[1]) : 1.0;
        
        // Parse RMS energy (higher = stronger signal)
        const rmsMatch = energyOutput.match(/RMS level dB:\s*([-\d.]+)/);
        const rmsDb = rmsMatch ? parseFloat(rmsMatch[1]) : -100;
        
        // Calculate tonal score (higher = better)
        // Good tonal calls: low flatness (<0.3), strong energy (>-40dB)
        const tonalScore = (1 - flatness) * 100 + Math.max(0, rmsDb + 60);
        
        return {
            flatness,
            rmsDb,
            tonalScore,
            isTonal: flatness < 0.4 && rmsDb > -50
        };
        
    } catch (error) {
        console.error(`      Analysis error: ${error.message}`);
        return { flatness: 1.0, rmsDb: -100, tonalScore: 0, isTonal: false };
    }
}

async function findBestTonalSegment(filePath) {
    const duration = await getFileDuration(filePath);
    
    if (duration < CLIP_DURATION) {
        return { startTime: 0, score: 0, method: 'file too short' };
    }
    
    console.log(`    Duration: ${(duration/3600).toFixed(1)}h | Scanning for tonal calls...`);
    
    // Step 1: Find regions with whale vocalizations using silence detection
    const silenceCmd = `ffmpeg -i "${filePath}" -af "bandpass=f=200:width_type=h:width=400,silencedetect=noise=-40dB:d=0.3" -f null - 2>&1 | grep "silence_end"`;
    
    let candidateRegions = [];
    
    try {
        const { stdout } = await execAsync(silenceCmd, { maxBuffer: 1024 * 1024 * 10 });
        const lines = stdout.split('\n').filter(l => l.includes('silence_end'));
        
        for (const line of lines) {
            const match = line.match(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/);
            if (match) {
                const endTime = parseFloat(match[1]);
                const silenceDuration = parseFloat(match[2]);
                
                // Start time is where silence ended, which is where sound begins
                const soundStart = endTime;
                
                // Only consider regions that can fit a 3-second clip
                if (soundStart + CLIP_DURATION < duration) {
                    candidateRegions.push({
                        time: soundStart,
                        silenceBefore: silenceDuration
                    });
                }
            }
        }
    } catch (error) {
        console.log(`      Silence detection failed, using sampling approach`);
    }
    
    // If we didn't find enough candidates, sample the entire file
    if (candidateRegions.length < 20) {
        console.log(`      Found ${candidateRegions.length} call regions, adding samples...`);
        const numSamples = 30;
        const skipStart = duration * 0.1; // Skip first 10%
        const skipEnd = duration * 0.9;   // Skip last 10%
        const searchDuration = skipEnd - skipStart;
        
        for (let i = 0; i < numSamples; i++) {
            const time = skipStart + (searchDuration / numSamples) * i;
            candidateRegions.push({ time, silenceBefore: 0 });
        }
    }
    
    console.log(`      Analyzing ${Math.min(candidateRegions.length, 50)} candidates for tonal quality...`);
    
    // Step 2: Analyze each candidate for tonal quality
    const analyzedRegions = [];
    const maxToAnalyze = Math.min(candidateRegions.length, 50); // Analyze top 50 to save time
    
    for (let i = 0; i < maxToAnalyze; i++) {
        const region = candidateRegions[i];
        const analysis = await analyzeTonalQuality(filePath, region.time);
        
        analyzedRegions.push({
            time: region.time,
            ...analysis
        });
        
        if ((i + 1) % 10 === 0) {
            console.log(`      Progress: ${i + 1}/${maxToAnalyze}`);
        }
    }
    
    // Step 3: Select best tonal segment
    analyzedRegions.sort((a, b) => b.tonalScore - a.tonalScore);
    
    const best = analyzedRegions[0];
    
    if (best && best.tonalScore > 0) {
        console.log(`      ✓ Best tonal call: ${(best.time/60).toFixed(1)}min | Score: ${best.tonalScore.toFixed(1)} | Flatness: ${best.flatness.toFixed(3)} | RMS: ${best.rmsDb.toFixed(1)}dB`);
        return {
            startTime: best.time,
            score: best.tonalScore,
            method: best.isTonal ? 'tonal call' : 'best available'
        };
    }
    
    // Fallback: use middle of file
    console.log(`      No clear tonal calls, using middle`);
    return { startTime: duration / 2, score: 0, method: 'fallback' };
}

async function extractClip(inputPath, outputPath, startTime) {
    // Extract with minimal filtering to preserve tonal quality
    // Use gentle bandpass and slight boost
    const cmd = `ffmpeg -ss ${startTime} -i "${inputPath}" -t ${CLIP_DURATION} -af "bandpass=f=200:width_type=h:width=400,volume=2.0" -acodec pcm_s16le -ar 44100 -ac 1 "${outputPath}" -y 2>&1`;
    
    try {
        await execAsync(cmd);
        return true;
    } catch (error) {
        console.error(`Error extracting clip: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🐋 Tonal Whale Call Extractor');
    console.log('================================\n');
    
    // Load manifest to get the same source files
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const files = manifest.files;
    
    console.log(`📋 Processing ${files.length} files for tonal whale calls\n`);
    
    let successCount = 0;
    const results = [];
    
    for (let i = 0; i < files.length; i++) {
        const fileInfo = files[i];
        const sourcePath = fileInfo.originalPath;
        const outputFileName = fileInfo.newName;
        const outputPath = path.join(OUTPUT_DIR, outputFileName);
        
        console.log(`[${i + 1}/${files.length}] ${outputFileName}`);
        console.log(`    Source: ${path.basename(sourcePath)}`);
        
        if (!fs.existsSync(sourcePath)) {
            console.log(`    ❌ Source file not found\n`);
            continue;
        }
        
        try {
            // Find best tonal segment
            const segment = await findBestTonalSegment(sourcePath);
            
            // Extract clip
            const success = await extractClip(sourcePath, outputPath, segment.startTime);
            
            if (success) {
                const stats = fs.statSync(outputPath);
                console.log(`    ✅ Extracted: ${(stats.size / 1024).toFixed(0)}KB | ${segment.method}\n`);
                successCount++;
                
                results.push({
                    file: outputFileName,
                    score: segment.score,
                    method: segment.method
                });
            } else {
                console.log(`    ❌ Extraction failed\n`);
            }
            
        } catch (error) {
            console.log(`    ❌ Error: ${error.message}\n`);
        }
    }
    
    console.log('\n================================');
    console.log(`✅ Complete! Extracted ${successCount}/${files.length} tonal clips`);
    
    // Show quality distribution
    const tonalCalls = results.filter(r => r.method === 'tonal call').length;
    const bestAvailable = results.filter(r => r.method === 'best available').length;
    const fallbacks = results.filter(r => r.method === 'fallback').length;
    
    console.log(`\nQuality Distribution:`);
    console.log(`  Tonal calls: ${tonalCalls}`);
    console.log(`  Best available: ${bestAvailable}`);
    console.log(`  Fallbacks: ${fallbacks}`);
    
    if (tonalCalls > 0) {
        const avgScore = results.filter(r => r.method === 'tonal call')
            .reduce((sum, r) => sum + r.score, 0) / tonalCalls;
        console.log(`  Average tonal score: ${avgScore.toFixed(1)}`);
    }
}

main().catch(console.error);
