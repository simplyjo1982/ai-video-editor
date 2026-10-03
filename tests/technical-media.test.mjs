import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createDatabasePool } from '../packages/db/dist/index.js';
import { TechnicalError, technicalConfig, probeSource, runTool, requirePositiveDuration,
  validateFrameTiming, frameToMs, decimalSecondsToMs, decimalSecondsToFrame,
  planSegments, prepareTechnical, cleanupTechnicalAttempt, fileDigest, resolveOriginal } from '../packages/media/dist/index.js';

// The database loader reads the ignored root .env without printing secrets.
const pool=createDatabasePool();
await pool.end();
const config=technicalConfig();
function code(expected){return error=>error instanceof TechnicalError&&error.code===expected;}
const parent=resolve('.local/technical-tests');
await mkdir(parent,{recursive:true});

test('integer timestamp conversions and half-open segment coverage',()=>{
  assert.equal(frameToMs(1),33);
  assert.equal(frameToMs(3),100);
  assert.equal(decimalSecondsToMs('1.2345'),1235);
  assert.equal(decimalSecondsToFrame('1.0166666667'),31);
  assert.throws(()=>requirePositiveDuration('0','0'),code('zero_duration'));
  assert.deepEqual(requirePositiveDuration('N/A','1.234'),{milliseconds:1234,derivation:'container'});
  assert.equal(validateFrameTiming(['0','512','1024']),'CFR');
  assert.equal(validateFrameTiming(['0','512','1000']),'VFR');
  assert.throws(()=>validateFrameTiming(['0','512','512']),code('inconsistent_timestamps'));
  assert.throws(()=>validateFrameTiming([]),code('inconsistent_timestamps'));
  const sparse=planSegments(915,[],300);
  assert.deepEqual(sparse.map(s=>[s.startFrame,s.endFrame]),[[0,300],[300,600],[600,900],[900,915]]);
  assert.ok(sparse.every(s=>s.representativeFrame>=s.startFrame&&s.representativeFrame<s.endFrame));
  const cut=planSegments(600,[120,120,121,480],300);
  assert.deepEqual(cut.map(s=>[s.startFrame,s.endFrame]),[[0,120],[120,420],[420,480],[480,600]]);
});

test('safe tool execution rejects missing tools, failure and timeout',async()=>{
  await assert.rejects(runTool(resolve(parent,'missing-ffprobe.exe'),[],'ffprobe',1000),code('tool_unavailable'));
  await assert.rejects(runTool(config.ffprobe,['-definitely-invalid-option'],'ffprobe',5000),code('tool_failed'));
  await assert.rejects(runTool(process.execPath,['-e','setInterval(()=>{},1000)'],'timer',200),code('tool_timeout'));
});

test('real ffprobe handles soundless H.264, corrupt media, unsupported stream and missing input',
  {timeout:30000},async()=>{
    const root=await mkdtemp(join(parent,'probe-'));
    try{
      const silent=join(root,'silent.mp4');
      await runTool(config.ffmpeg,['-v','error','-f','lavfi','-i','color=c=blue:s=160x90:r=30:d=2',
        '-c:v','libx264','-pix_fmt','yuv420p','-an','-y',silent],'fixture',15000);
      const source=await probeSource(silent,config);
      assert.equal(source.videoCodec,'h264');assert.equal(source.audioStreamCount,0);
      assert.equal(source.codedWidth,160);assert.equal(source.codedHeight,90);
      assert.equal(source.rateMode,'CFR');assert.equal(source.sourceDurationMs,2000);
      const bad=join(root,'corrupt.mp4');await writeFile(bad,Buffer.from('not a media file'));
      await assert.rejects(probeSource(bad,config),code('tool_failed'));
      await assert.rejects(probeSource(join(root,'absent.mp4'),config),code('tool_failed'));
      const unsupported=join(root,'unsupported.mp4');
      await runTool(config.ffmpeg,['-v','error','-f','lavfi','-i','color=c=red:s=160x90:r=30:d=1',
        '-c:v','mpeg4','-y',unsupported],'fixture',15000);
      await assert.rejects(probeSource(unsupported,config),code('unsupported_stream'));
      assert.equal((await stat(silent)).size>0,true);
    }finally{
      assert.ok(resolve(root).startsWith(parent+'\\')||resolve(root).startsWith(parent+'/'));
      await rm(root,{recursive:true,force:true});
    }
  });

test('representative frames use midpoint working frames and preserve original bytes',
  {timeout:30000},async()=>{
    const root=await mkdtemp(join(parent,'process-'));
    const projectId=randomUUID(),assetId=randomUUID(),jobId=randomUUID(),leaseToken=randomUUID();
    try{
      await mkdir(join(root,'originals',projectId),{recursive:true});
      const original=join(root,'originals',projectId,assetId+'.mp4');
      await runTool(config.ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=30:d=2',
        '-c:v','libx264','-pix_fmt','yuv420p','-an','-y',original],'fixture',15000);
      const before=await fileDigest(original);
      const source=await probeSource(original,config);
      await assert.rejects(prepareTechnical({root,projectId,assetId,jobId,leaseToken,
        cacheKey:'b'.repeat(64),original,source,config:{...config,ffmpeg:resolve(root,'missing-ffmpeg.exe')}}),
        code('tool_unavailable'));
      assert.deepEqual(await fileDigest(original),before);
      const prepared=await prepareTechnical({root,projectId,assetId,jobId,leaseToken,
        cacheKey:'a'.repeat(64),original,source,config:{...config,maxSegmentFrames:30}});
      try{
        assert.equal(prepared.segments.length,2);
        assert.equal(prepared.frames.length,2);
        assert.equal(prepared.workingFrameCount,60);
        for(const frame of prepared.frames){
          const segment=prepared.segments[frame.segmentIndex];
          assert.equal(frame.frameIndex,Math.floor((segment.startFrame+segment.endFrame-1)/2));
          assert.ok(frame.timestampMs>=segment.startMs&&frame.timestampMs<segment.endMs);
          const bytes=await readFile(frame.artifact.tempPath);
          assert.equal(bytes[0],0xff);assert.equal(bytes[1],0xd8);
          assert.equal(frame.width,160);assert.equal(frame.height,90);
        }
      }finally{await cleanupTechnicalAttempt(prepared);}
      assert.deepEqual(await fileDigest(original),before);
    }finally{
      assert.ok(resolve(root).startsWith(parent+'\\')||resolve(root).startsWith(parent+'/'));
      await rm(root,{recursive:true,force:true});
    }
  });

test('missing original is reported without touching originals',async()=>{
  const root=await mkdtemp(join(parent,'missing-'));
  const projectId=randomUUID(),assetId=randomUUID();
  try{
    await mkdir(join(root,'originals',projectId),{recursive:true});
    await assert.rejects(resolveOriginal(root,projectId,assetId,`${projectId}/${assetId}.mp4`),code('missing_original'));
  }finally{
    assert.ok(resolve(root).startsWith(parent+'\\')||resolve(root).startsWith(parent+'/'));
    await rm(root,{recursive:true,force:true});
  }
});
