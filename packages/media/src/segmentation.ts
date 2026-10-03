import { frameToMs } from './timestamps.js';

export const SEGMENTATION_VERSION = 'scene-0.30-max10s-v1';
export interface PlannedSegment {
  index: number;
  startFrame: number;
  endFrame: number;
  startMs: number;
  endMs: number;
  representativeFrame: number;
  method: 'scene_change' | 'continuous_fallback' | 'long_shot_split';
  boundaryReason: string;
}

/** Scene boundaries are technical candidates. Long continuous shots are split
 * into bounded editorial intervals; no semantic scene claims are made. */
export function planSegments(frameCount: number, candidates: number[], maxFrames = 300): PlannedSegment[] {
  if (!Number.isSafeInteger(frameCount) || frameCount <= 0 || !Number.isSafeInteger(maxFrames) || maxFrames <= 0) throw new Error('Invalid segment inputs');
  const accepted: number[] = [];
  for (const value of [...new Set(candidates)].sort((a,b) => a-b)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value >= frameCount) continue;
    if (value - (accepted.at(-1) ?? 0) < 15 || frameCount - value < 15) continue;
    accepted.push(value);
  }
  const cuts = [0,...accepted,frameCount];
  const results: PlannedSegment[] = [];
  for (let i=0;i<cuts.length-1;i++) {
    const start=cuts[i]!; const end=cuts[i+1]!;
    for (let cursor=start;cursor<end;cursor+=maxFrames) {
      const finish=Math.min(cursor+maxFrames,end);
      const split=cursor>start;
      const method = split ? 'long_shot_split' : accepted.length ? 'scene_change' : 'continuous_fallback';
      results.push({index:results.length,startFrame:cursor,endFrame:finish,startMs:frameToMs(cursor),endMs:frameToMs(finish),
        representativeFrame:Math.floor((cursor+finish-1)/2),method,
        boundaryReason:split?'maximum interval length':cursor===0?'source start':'detected shot-change candidate'});
    }
  }
  if (results[0]?.startFrame !== 0 || results.at(-1)?.endFrame !== frameCount ||
      results.some((segment,index) => segment.endFrame <= segment.startFrame || (index>0 && results[index-1]!.endFrame !== segment.startFrame))) {
    throw new Error('Invalid segment coverage');
  }
  return results;
}
