// Règles de goût (src/lib/gout.ts) : npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DAY, decay, genreFactor, isBlocked, rotate, verdictScore, weightedSample } from '../src/lib/gout.ts';

const base = { decision: 'keep', heardS: 20, youtube: false, outcome: null, fullListens: 0 };

test('un titre rangé après deux écoutes vaut bien plus qu’un simple « je garde »', () => {
  const kept = verdictScore(base);
  const loved = verdictScore({ ...base, fullListens: 2, outcome: 'library' });
  assert.equal(kept, 1);
  assert.equal(loved, 3.5);
});

test('passer au bout de 3 s pèse plus lourd que passer après tout l’extrait', () => {
  const fast = verdictScore({ ...base, decision: 'reject', heardS: 3 });
  const slow = verdictScore({ ...base, decision: 'reject', heardS: 29 });
  assert.ok(fast < slow);
  assert.equal(fast, -1.5);
  assert.equal(slow, -0.5);
});

test('ouvrir sur YouTube adoucit un « non »', () => {
  assert.equal(verdictScore({ ...base, decision: 'reject', heardS: 10, youtube: true }), -0.5);
});

test('gardé mais jamais écouté puis supprimé : presque neutre', () => {
  assert.equal(verdictScore({ ...base, outcome: 'deleted' }), 0.5);
});

test('les anciens tris comptent moitié moins après la demi-vie', () => {
  const now = Date.now();
  assert.equal(decay(now, 45, now), 1);
  assert.ok(Math.abs(decay(now - 45 * DAY, 45, now) - 0.5) < 1e-9);
});

test('facteur de genre borné', () => {
  assert.equal(genreFactor(0, 0), 1);
  assert.equal(genreFactor(0, 50), 0.2);
  assert.equal(genreFactor(50, 0), 1.8);
});

test('artiste bloqué seulement s’il est nettement plus passé que gardé', () => {
  assert.equal(isBlocked(0, 1.5), false);
  assert.equal(isBlocked(0, 2), true);
  assert.equal(isBlocked(1, 2.5), false);
});

test('le tirage garde la tête et varie le reste', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({ id: i, w: 20 - i }));
  const seen = new Set<number>();
  for (let k = 0; k < 30; k++) {
    const out = rotate(items, (x) => x.w, 3, 8, 12);
    assert.equal(out.length, 8);
    assert.deepEqual(out.slice(0, 3).map((x) => x.id), [0, 1, 2]);
    assert.equal(new Set(out.map((x) => x.id)).size, 8);
    out.slice(3).forEach((x) => { assert.ok(x.id >= 3 && x.id < 15); seen.add(x.id); });
  }
  assert.ok(seen.size > 5, 'le reste doit tourner');
});

test('les gros poids sortent plus souvent', () => {
  const items = [{ id: 'fort', w: 10 }, { id: 'faible', w: 1 }];
  let fort = 0;
  for (let k = 0; k < 2000; k++) if (weightedSample(items, (x) => x.w, 1)[0].id === 'fort') fort++;
  assert.ok(fort > 1700);
});
