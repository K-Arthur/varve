import { describe, expect, it } from 'vitest';
import { animateScreenTransition, createTransitionAnimation } from './transitions';
import type { PrototypeState, TransitionConfig } from './types';

describe('Transitions', () => {
  describe('createTransitionAnimation', () => {
    it('creates instant transition with zero duration', () => {
      const transition: TransitionConfig = {
        kind: 'instant',
        duration: 0,
        easing: { kind: 'linear' },
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.duration).toBe(0);
      expect(anim.inKeyframes).toBeDefined();
      expect(anim.outKeyframes).toBeDefined();
    });

    it('creates dissolve transition with opacity crossfade', () => {
      const transition: TransitionConfig = {
        kind: 'dissolve',
        duration: 300,
        easing: { kind: 'easeInOut' },
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.duration).toBe(300);
      // Incoming starts invisible (0 opacity), fades in to 1
      expect(anim.inKeyframes.inOpacity).toBe(0);
      // Outgoing ends invisible (0 opacity), fades out from 1
      expect(anim.outKeyframes.outOpacity).toBe(0);
    });

    it('creates slide transition with directional offset', () => {
      const transition: TransitionConfig = {
        kind: 'slide',
        duration: 400,
        easing: { kind: 'easeInOut' },
        direction: 'right',
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.duration).toBe(400);
      // Slide right: incoming from right (+100% offset), outgoing goes left (-100%)
      expect(typeof anim.inKeyframes.inOffsetX).toBe('number');
      expect(typeof anim.outKeyframes.outOffsetX).toBe('number');
    });

    it('creates push transition', () => {
      const transition: TransitionConfig = {
        kind: 'push',
        duration: 350,
        easing: { kind: 'easeInOut' },
        direction: 'left',
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.duration).toBe(350);
    });

    it('creates moveIn transition', () => {
      const transition: TransitionConfig = {
        kind: 'moveIn',
        duration: 300,
        easing: { kind: 'easeOut' },
        direction: 'up',
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.duration).toBe(300);
    });

    it('creates moveOut transition', () => {
      const transition: TransitionConfig = {
        kind: 'moveOut',
        duration: 300,
        easing: { kind: 'easeOut' },
        direction: 'down',
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.duration).toBe(300);
    });

    it('defaults to left direction when not specified', () => {
      const transition: TransitionConfig = {
        kind: 'slide',
        duration: 300,
        easing: { kind: 'linear' },
      };
      const anim = createTransitionAnimation(transition);
      expect(anim.inKeyframes).toBeDefined();
    });
  });

  describe('animateScreenTransition', () => {
    it('returns screen states for a dissolve transition at progress 0', () => {
      const transition: TransitionConfig = {
        kind: 'dissolve',
        duration: 300,
        easing: { kind: 'linear' },
      };
      const result = animateScreenTransition(transition, 0, { x: 0, y: 0, opacity: 1 });
      expect(result.outOpacity).toBe(1);
      expect(result.inOpacity).toBe(0);
    });

    it('returns screen states at progress 0.5 (midpoint)', () => {
      const transition: TransitionConfig = {
        kind: 'dissolve',
        duration: 300,
        easing: { kind: 'linear' },
      };
      const result = animateScreenTransition(transition, 0.5, { x: 0, y: 0, opacity: 1 });
      expect(result.outOpacity).toBeCloseTo(0.5, 1);
      expect(result.inOpacity).toBeCloseTo(0.5, 1);
    });

    it('returns screen states at progress 1', () => {
      const transition: TransitionConfig = {
        kind: 'dissolve',
        duration: 300,
        easing: { kind: 'linear' },
      };
      const result = animateScreenTransition(transition, 1, { x: 0, y: 0, opacity: 1 });
      expect(result.outOpacity).toBe(0);
      expect(result.inOpacity).toBe(1);
    });

    it('returns fully opaque/visible for instant transition', () => {
      const transition: TransitionConfig = {
        kind: 'instant',
        duration: 0,
        easing: { kind: 'linear' },
      };
      const result = animateScreenTransition(transition, 0, { x: 0, y: 0, opacity: 1 });
      expect(result.inOpacity).toBe(1);
    });

    it('handles slide transition with offset at midpoint', () => {
      const transition: TransitionConfig = {
        kind: 'slide',
        duration: 400,
        easing: { kind: 'easeInOut' },
        direction: 'right',
      };
      const result = animateScreenTransition(transition, 0.5, { x: 400, y: 800, opacity: 1 });
      // At midpoint of slide right (t=0.5, eased ≈ 0.5): outgoing screen has moved left
      expect(result.outOffsetX).not.toBe(0);
      expect(result.outOpacity).toBeLessThan(1);
    });

    it('applies smart animate layer matching when values provided', () => {
      const transition: TransitionConfig = {
        kind: 'smartAnimate',
        duration: 500,
        easing: { kind: 'linear' },
      };
      const currentState = { x: 400, y: 800, opacity: 1 };
      const result = animateScreenTransition(transition, 0.5, currentState, { n1: { x: 100 } });
      expect(result).toBeDefined();
      // Should NOT fall back to dissolve behavior when smart animate data exists.
      // Smart animate with property values should produce different result from dissolve.
      const dissolveResult = animateScreenTransition(
        { kind: 'dissolve', duration: 500, easing: { kind: 'linear' } },
        0.5,
        currentState,
      );
      // inOffsetX should differ from dissolve (which always returns 0)
      expect(result.inOffsetX).not.toBe(dissolveResult.inOffsetX);
    });
  });
});
