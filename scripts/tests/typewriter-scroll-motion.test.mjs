import test from 'node:test';
import assert from 'node:assert/strict';
import {stepScrollClip} from '../../src/features/typewriter/nocturne-core/lib/nocturne/components/scroll-clip-motion.ts';

const FRAME = 1 / 60;
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];

function settle(start, target, maxFrames = 60) {
  let body = {...start};
  const path = [body.position];
  let frames = 0;
  for (; frames < maxFrames; frames++) {
    body = stepScrollClip(body, target, FRAME);
    path.push(body.position);
    if (body.position === target && body.velocity === 0) return {body, path, frames: frames + 1};
  }
  return {body, path, frames};
}

test('100 far scroll jumps settle without overshoot within 400 ms', () => {
  let body = {position: 18, velocity: 0};
  const durations = [];
  for (let i = 0; i < 100; i++) {
    const target = i % 2 ? 18 : 518;
    const result = settle(body, target);
    assert.equal(result.body.position, target, `jump ${i + 1} reaches its target`);
    assert.ok(result.frames <= 24, `jump ${i + 1} settles in ${result.frames} frames`);
    const direction = Math.sign(target - body.position);
    for (const position of result.path) {
      assert.ok(direction >= 0 ? position <= target + 0.001 : position >= target - 0.001,
        `jump ${i + 1} does not overshoot`);
    }
    durations.push(result.frames * 1000 / 60);
    body = result.body;
  }
  assert.ok(percentile(durations, 0.95) <= 400);
});

test('rapid target changes continue from the current visual position', () => {
  let body = {position: 18, velocity: 0};
  const durations = [];
  for (let i = 0; i < 25; i++) {
    const firstTarget = i % 2 ? 18 : 518;
    for (let frame = 0; frame < 3; frame++) body = stepScrollClip(body, firstTarget, FRAME);
    const start = {...body};
    const target = firstTarget === 18 ? 518 : 18;
    const result = settle(body, target);
    assert.equal(result.path[0], start.position, 'retarget begins at the already-rendered position');
    assert.equal(result.body.position, target);
    assert.ok(result.frames <= 24, `rapid retarget settles in ${result.frames} frames`);
    const direction = Math.sign(target - start.position);
    for (const position of result.path) {
      assert.ok(direction >= 0 ? position <= target + 0.001 : position >= target - 0.001,
        'rapid retarget never crosses and rebounds past its target');
    }
    durations.push(result.frames * 1000 / 60);
    body = result.body;
  }
  assert.ok(percentile(durations, 0.95) <= 400);
});

test('100 alternating 1,000 px jumps stay under 1,800 px/s and settle within 800 ms', () => {
  let body = {position: 40, velocity: 0};
  const samples = {forward: {durations: [], peak: 0}, reverse: {durations: [], peak: 0}};
  for (let i = 0; i < 100; i++) {
    const target = i % 2 ? 40 : 1040;
    const direction = target > body.position ? 'forward' : 'reverse';
    const result = settle(body, target, 60);
    assert.equal(result.body.position, target, `jump ${i + 1} reaches its target`);
    assert.ok(result.frames <= 48, `jump ${i + 1} settles within 800 ms`);
    const sample = samples[direction];
    sample.durations.push(result.frames * 1000 / 60);
    for (let frame = 1; frame < result.path.length; frame++) {
      sample.peak = Math.max(sample.peak, Math.abs(result.path[frame] - result.path[frame - 1]) / FRAME);
    }
    const sign = Math.sign(target - result.path[0]);
    for (const position of result.path) {
      assert.ok(sign > 0 ? position <= target + 0.001 : position >= target - 0.001,
        `jump ${i + 1} never overshoots or rebounds`);
    }
    body = result.body;
  }
  const forwardDuration = percentile(samples.forward.durations, 0.95);
  const reverseDuration = percentile(samples.reverse.durations, 0.95);
  const durationDifference = Math.abs(forwardDuration - reverseDuration) / Math.max(forwardDuration, reverseDuration);
  const speedDifference = Math.abs(samples.forward.peak - samples.reverse.peak) / Math.max(samples.forward.peak, samples.reverse.peak);
  assert.ok(samples.forward.peak <= 1800 && samples.reverse.peak <= 1800, 'both directions respect the visible speed cap');
  assert.ok(durationDifference <= 0.1, `directional duration difference ${(durationDifference * 100).toFixed(1)}% <= 10%`);
  assert.ok(speedDifference <= 0.1, `directional peak speed difference ${(speedDifference * 100).toFixed(1)}% <= 10%`);
});

